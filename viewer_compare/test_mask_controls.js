const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {bridgeHarness}=require('./test_panel');
function controls(){
  const {ctx,api}=bridgeHarness(),nodes=new Map();
  class Element{
    constructor(){this.children=[];this.value='';this.dataset={};this.style={};this.events={};this.attrs={};this.hidden=false;}
    appendChild(n){this.children.push(n);return n;}replaceChildren(){this.children=[];this.value='';}
    addEventListener(k,f){this.events[k]=f;}setAttribute(k,v){this.attrs[k]=v;}
    setCustomValidity(v){this.error=v;}reportValidity(){this.reported=true;}
  }
  const node=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const buttons=['average','binary'].map(mode=>{const b=new Element();b.dataset.mode=mode;return b;});
  const group=new Element();group.querySelectorAll=()=>buttons;
  const document={getElementById:node,querySelector:()=>node('dock-body'),head:new Element(),
    createElement:tag=>tag==='section'?group:new Element()};
  for(const key of ['maskA','maskB']){
    ctx.P.arrays[key]={...ctx.P.arrays.dem,leaf:'coherence_mask',label:key};
    ctx.values[key]=new Float32Array([.2,.5,.8,NaN]);
  }
  assert.ok(fs.existsSync('viewer_compare/mask.js'),'mask controls script must exist');
  vm.runInNewContext(fs.readFileSync('viewer_compare/mask.js','utf8'),{document,window:{SnowCompareViewer:api},Number});
  return {ctx,api,node,buttons,group};
}

test('mask controls follow primary/overlay selection and restore per-layer choices',()=>{
  const {ctx,api,node,buttons,group}=controls();assert.equal(group.hidden,true);
  ctx.openLayer('maskA');assert.equal(group.hidden,false);
  assert.equal(buttons[0].attrs['aria-pressed'],'true');assert.equal(node('nxm-cutoff').disabled,true);
  buttons[1].onclick();assert.equal(api.maskOptions('maskA').mode,'binary');
  node('nxm-cutoff').value='.75';node('nxm-cutoff').onchange();
  assert.deepEqual(ctx.uploaded,[0,0,1,NaN]);assert.equal(Number(node('nxm-slider').value),.75);
  ctx.openLayer('maskB');assert.equal(buttons[0].attrs['aria-pressed'],'true');
  ctx.openLayer('maskA');assert.equal(Number(node('nxm-cutoff').value),.75);
  ctx.setOverlay('maskB');assert.equal(node('nxm-target').children.length,2);
  node('nxm-target').value='maskB';node('nxm-target').onchange();
  buttons[1].onclick();assert.equal(api.maskOptions('maskB').mode,'binary');
  ctx.activate('timeline');assert.equal(group.hidden,true);
  ctx.openLayer('dem');ctx.setOverlay(null);assert.equal(group.hidden,true);
});

test('invalid cutoff does not replace working classification and boundaries remain editable',()=>{
  const {ctx,api,node,buttons}=controls();ctx.openLayer('maskA');buttons[1].onclick();
  for(const input of ['', '-1', '2', 'invalid']){
    node('nxm-cutoff').value=input;node('nxm-cutoff').onchange();
    assert.equal(api.maskOptions('maskA').cutoff,.5);assert.ok(node('nxm-cutoff').error);
  }
  for(const [input,want] of [['0',[1,1,1,NaN]],['1',[0,0,0,NaN]]]){
    node('nxm-cutoff').value=input;node('nxm-cutoff').onchange();
    assert.equal(node('nxm-cutoff').error,'');assert.deepEqual(ctx.uploaded,want);
  }
  buttons[0].onclick();assert.equal(api.maskOptions('maskA').mode,'average');
  assert.deepEqual(Array.from(ctx.floats('maskA')),Array.from(ctx.values.maskA));
});
