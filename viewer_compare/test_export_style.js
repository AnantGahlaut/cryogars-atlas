const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('./export');
test('percentiles ignore nodata, interpolate true ranks, and do not mutate samples',()=>{
  const input=[0,10,20,30,NaN];const sorted=E.sortedValues([input]);
  assert.deepEqual(sorted,[0,10,20,30]);
  const r=E.stretch(sorted,10,90,false);
  assert.ok(Math.abs(r.lo-3)<1e-12);assert.ok(Math.abs(r.hi-27)<1e-12);
  assert.deepEqual(input,[0,10,20,30,NaN]);
});
test('zero-centred differences expand percentile bounds symmetrically and disclose it',()=>{
  const r=E.stretch([-20,0,10,40],0,100,true);
  assert.equal(r.lo,-40);assert.equal(r.hi,40);assert.equal(r.zeroCentered,true);
});
test('invalid percentiles reject, while constant-valued maps retain a usable range',()=>{
  for(const p of [[-1,90],[2,101],[90,10],[2,2],[NaN,90]])assert.throws(()=>E.stretch([1,2],...p,false),/percentile/i);
  const r=E.stretch([5,5,5],2,98,false);assert.ok(r.lo<5&&r.hi>5);
  assert.throws(()=>E.stretch([],0,100,false),/valid/i);
});
test('custom palette interpolation and reversal use copies, not saved-default mutation',()=>{
  const stops=[[0,'#ff0000'],[.5,'#00ff00'],[1,'#0000ff']];
  assert.deepEqual(E.mapper(stops,false)(.25),[128,128,0,255]);
  assert.deepEqual(E.mapper(stops,true)(0),[0,0,255,255]);
  assert.equal(stops[0][1],'#ff0000');
  assert.throws(()=>E.mapper([[0,'garbage'],[1,'#ffffff']],false),/colour/i);
});
test('selected palette reaches actual raster pixels, preserving transparent nodata',()=>{
  let written;const canvas={getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:im=>{written=im.data;}})};
  E.raster({createElement:()=>canvas},new Float32Array([0,10,NaN]),3,1,0,10,false,{stops:[[0,'#ff0000'],[1,'#0000ff']],reverse:false});
  assert.deepEqual(Array.from(written),[255,0,0,255,0,0,255,255,0,0,0,0]);
});

test('mask PNG legends contain only the displayed state colours and labels',()=>{
  const paints=[],texts=[],images=[];
  const document={createElement(){const context={fillStyle:'',createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
    putImageData(im){images.push(Array.from(im.data));},drawImage(){},strokeRect(){},
    fillRect(x,y,w,h){if(h===12)paints.push(this.fillStyle);},fillText(t){texts.push(t);}};
    return {getContext:()=>context};}};
  const result={grid:{w:3,h:1},values:[0,1,NaN],lo:0,hi:1,difference:false,lines:[],title:'Mask A',unit:'state',
    style:{stops:[[0,'#ff0000'],[.5,'#00ff00'],[1,'#0000ff']]},maskCategory:'binary'};
  E.figure(document,result);
  assert.deepEqual([...new Set(paints)],['rgb(255,0,0)','rgb(0,0,255)']);
  assert.deepEqual(images[0],[255,0,0,255,0,0,255,255,0,0,0,0]);
  assert.ok(!texts.includes('0.50000'));assert.ok(texts.includes('0.0000'));assert.ok(texts.includes('1.0000 state'));
  paints.length=0;texts.length=0;
  E.figure(document,{...result,values:[-1,0,1],lo:-1,maskCategory:'transition',difference:true});
  assert.deepEqual([...new Set(paints)],['rgb(255,0,0)','rgb(0,255,0)','rgb(0,0,255)']);
  assert.ok(texts.includes('-1.0000'));assert.ok(texts.includes('0.0000'));assert.ok(texts.includes('1.0000 state'));
});
test('coincident colour stops use the existing terrain shader boundary convention',()=>{
  const colour=E.mapper([[0,'#ff0000'],[.5,'#ff0000'],[.5,'#0000ff'],[1,'#0000ff']],false);
  assert.deepEqual(colour(.49),[255,0,0,255]);assert.deepEqual(colour(.5),[255,0,0,255]);
  assert.deepEqual(colour(.51),[0,0,255,255]);
  const edge=E.mapper([[0,'#ff0000'],[0,'#0000ff'],[1,'#0000ff']],false);
  assert.deepEqual(edge(0),[255,0,0,255]);
});
test('builtin PNG colours follow actual terrain formulas rather than UI swatch approximations',()=>{
  const viridis=E.colorMapper({builtin:'viridis',reverse:false});
  assert.deepEqual(viridis(.33),[33,111,140,255]);
  assert.deepEqual(E.colorMapper({builtin:'magma'})(.66),[230,90,97,255]);
  assert.deepEqual(E.colorMapper({builtin:'gray'})(.5),[126,129,130,255]);
  assert.deepEqual(E.colorMapper({builtin:'cyclic'})(0),[247,87,87,255]);
  assert.deepEqual(E.colorMapper({builtin:'viridis',reverse:true})(.67),[33,111,140,255]);
});
test('sub-micro-unit display ranges use the same minimum denominator as terrain',()=>{
  let written;const canvas={getContext:()=>({createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:im=>{written=im.data;}})};
  E.raster({createElement:()=>canvas},[1e-7],1,1,0,1e-7,false,{stops:[[0,'#000000'],[1,'#ffffff']]});
  assert.deepEqual(Array.from(written),[26,26,26,255]);
});
test('all builtin PNG mappings track the unlit formulas in the existing renderer',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const template=fs.readFileSync('explorer_template.html','utf8');
  const names={terrain:'terrain',blues:'blues',greens:'greens',diverging:'diverg',viridis:'viridis',magma:'magma',gray:'graymap',cividis:'cividis',cyclic:'cyclic',mask:'binaryMask'};
  // Evaluate only the renderer's scalar palette functions, not WebGL/browser code.
  const context={vec3:(...v)=>v,cos:Math.cos,R:(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*Math.max(0,Math.min(1,t)))};
  vm.createContext(context);
  for(const [name,shader] of Object.entries(names)){
    const source=template.match(new RegExp('vec3 '+shader+'\\(float t\\)\\{[^}]+\\}'))[0]
      .replace('vec3 '+shader+'(float t)','function '+shader+'(t)').replace(/\bfloat /g,'let ');
    vm.runInContext(source,context);const color=E.colorMapper({builtin:name});
    for(const t of [0,.01,.1,.3,.33,.49,.5,.51,.6,.66,.8,.85,1]){
      const actual=color(t),expected=context[shader](t).map(v=>Math.round(v*255));
      for(let i=0;i<3;i++)assert.ok(Math.abs(actual[i]-expected[i])<=1,`${name} at ${t}, channel ${i}`);
    }
  }
});
