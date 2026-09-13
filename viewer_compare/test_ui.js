/* Exercise actual panel handlers with a small DOM/canvas harness, not a browser. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('./core'),T=require('./tiff'),E=require('./export');
function harness(options={}){
  const downloads=[],blobCallbacks=[],cleanupTasks=[],revoked=[],texts=[],rasters=[];
  class Element{
    constructor(){this.children=[];this.value='';this.hidden=false;this.checked=false;this.listeners={};this.style={};this.dataset={};this.attrs={};this.classList={add(){},remove(){}};}
    appendChild(n){this.children.push(n);if(!this.value&&n.value)this.value=n.value;return n;}
    replaceChildren(...n){this.children=[];this.value='';for(const x of n)this.appendChild(x);}
    addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
    setAttribute(k,v){this.attrs[k]=v;}
    async fire(type,event={}){if(this['on'+type])await this['on'+type](event);for(const fn of this.listeners[type]||[])await fn(event);}
    focus(){} showModal(){this.open=true;this.modal=true;}show(){this.open=true;this.modal=false;}close(){this.open=false;}remove(){}click(){if(this.download)downloads.push(this.download);}
    toBlob(fn,type){assert.equal(type,'image/png');if(options.encodeError)throw Error('Canvas encoding unavailable');blobCallbacks.push(fn);}
    getContext(){return {createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(im){rasters.push(im.data);},drawImage(){},fillRect(){},strokeRect(){},fillText(text){texts.push(text);},measureText:s=>({width:s.length*7})};}
  }
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const buttons=['a','b','difference'].map(view=>{const b=new Element();b.dataset.nxcView=view;return b;});
  const terrainButtons=['a','b','difference'].map(view=>{const b=new Element();b.dataset.nxcView=view;return b;});
  const presets=['0,100','2,98','10,90'].map(range=>{const b=new Element();b.dataset.nxcRange=range;return b;});
  el('nxc-panel').querySelectorAll=selector=>selector==='[data-nxc-range]'?presets:buttons;
  el('nxc-terrain').querySelectorAll=()=>terrainButtons;
  for(const [id,val]of Object.entries({source:'file',method:'nearest',scale:'1',offset:'0',band:'0'}))el('nxc-'+id).value=val;
  const document={getElementById:el,createElement:()=>new Element(),body:new Element()};
  const layer=(key,lo,hi,bytes)=>({key,label:key,leaf:'snow_depth',kind:'snow_depth',unit:'m',date:'2020-02-01',w:2,h:2,bits:8,lo,hi,b64:Buffer.from(bytes).toString('base64'),cell_m:3});
  const layers=[layer('depth_A',0,2,[1,128,255,0]),layer('depth_B',1,3,[1,128,255,255]),
    {...layer('veg_A',4,8,[1,128,255,0]),leaf:'veg_height',kind:'veg_height'},
    {...layer('veg_B',5,9,[1,128,255,255]),leaf:'veg_height',kind:'veg_height'}];
  const payload={site:'example',identification:{site_name:'Example',common_crs_epsg:32612},grid:{origin:[100,200],pixel:[3,-3]},layers,current:'depth_A'};
  const shown=[];
  const paletteChoices=[{id:'diverging',name:'Diverging',stops:[[0,'#b42d1d'],[.5,'#f6f5f0'],[1,'#1d5aa7']]},
    {id:'__source__',name:'Current reference',stops:[[0,'#000000'],[1,'#ffffff']]},
    {id:'saved:mine',name:'Saved · Test',stops:[[0,'#ff0000'],[1,'#0000ff']]}];
  let appearance=null;
  let selection={key:'depth_A',tab:'depth_A',comparison:null,available:false};
  const selectionListeners=new Set();
  const emitSelection=s=>{selection=s;for(const fn of selectionListeners)fn(s);};
  const navigate=(key,tab=key)=>{if(key)payload.current=key;emitSelection({key,tab,comparison:null,available:selection.available});};
  const api={context:()=>payload,
    selection:()=>selection,onSelection(fn){selectionListeners.add(fn);fn(selection);return()=>selectionListeners.delete(fn);},
    clear({restore=true}={}){const key=restore&&selection.comparison!==null?payload.current:selection.key;emitSelection({key,tab:key||selection.tab,comparison:null,available:false});},
    show:r=>{shown.push(r);appearance=null;emitSelection({key:'temporary',tab:'temporary',comparison:r.id,available:true});},
    palettes:()=>paletteChoices,appearance:()=>appearance};
  const image={getWidth:()=>2,getHeight:()=>2,getSamplesPerPixel:()=>1,getFileDirectory:()=>({BitsPerSample:[32],SampleFormat:[3],ModelPixelScale:[3,3,0],ModelTiepoint:[0,0,0,100,200,0]}),getGeoKeys:()=>({ProjectedCSTypeGeoKey:32612}),getGDALNoData:()=>null,
    readRasters:options.readRasters|| (async()=>new Float32Array([1,2,3,4]))};
  const context={document,window:{SnowCompareViewer:api,SnowCompareCore:C,SnowCompareTiff:T,SnowCompareExport:E,GeoTIFF:{fromBlob:options.fromBlob|| (async()=>({getImage:async()=>image}))}},AbortController,console,
    setTimeout:fn=>cleanupTasks.push(fn),URL:{createObjectURL:()=> 'blob:comparison',revokeObjectURL:url=>revoked.push(url)},Float32Array};
  vm.createContext(context);vm.runInContext(fs.readFileSync('viewer_compare/panel.js','utf8'),context);
  return {el,shown,buttons,terrainButtons,presets,downloads,blobCallbacks,cleanupTasks,revoked,texts,image,rasters,setAppearance:a=>{appearance=a;},navigate,emitSelection,selection:()=>selection};
}
test('open is isolated from legend click; same-product compare, switch views, 3D and clear work',async()=>{
  const {el,shown,buttons}=harness();let stopped=false;
  await el('nxc-open').fire('click',{stopPropagation(){stopped=true;}});
  assert.ok(stopped);assert.equal(el('nxc-panel').open,true);
  assert.match(el('nxc-grid').textContent,/2 × 2 @ 3 m/);
  el('nxc-source').value='layer';await el('nxc-source').fire('change');
  await el('nxc-run').fire('click');
  assert.match(el('nxc-status').textContent,/Comparison ready/);
  assert.match(el('nxc-summary').textContent,/3 shared cells/);
  assert.match(el('nxc-summary').textContent,/RMSE 1\.000/);
  assert.equal(el('nxc-result').hidden,false);
  await buttons[1].fire('click');assert.equal(buttons[1].attrs['aria-pressed'],'true');
  await el('nxc-show').fire('click');assert.equal(shown.at(-1).id,'b');assert.equal(el('nxc-panel').open,false);
  await el('nxc-clear').fire('click');assert.equal(el('nxc-result').hidden,true);
});
test('external TIFF requires explicit confirmation, then computes valid intersection',async()=>{
  const {el}=harness();await el('nxc-open').fire('click',{stopPropagation(){}});
  el('nxc-file').files=[{name:'prediction.tif',size:128}];await el('nxc-file').fire('change');
  assert.match(el('nxc-file-info').textContent,/prediction.tif/);
  await el('nxc-run').fire('click');assert.match(el('nxc-status').textContent,/Confirm/);
  el('nxc-confirm').checked=true;await el('nxc-run').fire('click');
  assert.match(el('nxc-status').textContent,/Comparison ready/);assert.equal(el('nxc-run').disabled,false);
});

async function compareLayers(h){
  await h.el('nxc-open').fire('click',{stopPropagation(){}});
  h.el('nxc-source').value='layer';await h.el('nxc-source').fire('change');
  await h.el('nxc-run').fire('click');
}
test('delayed PNG export retains the requested map name when another view is selected',async()=>{
  const h=harness();await compareLayers(h);
  await h.el('nxc-export').fire('click');
  await h.buttons[0].fire('click');
  h.blobCallbacks[0]({});
  assert.deepEqual(h.downloads,['example_difference_comparison.png']);
  assert.ok(h.texts.includes('CryoGARS · Difference B − A'));
  for(const cleanup of h.cleanupTasks)cleanup();assert.deepEqual(h.revoked,['blob:comparison']);
});
test('clearing a result cancels its pending PNG download',async()=>{
  const h=harness();await compareLayers(h);await h.el('nxc-export').fire('click');
  await h.el('nxc-clear').fire('click');h.blobCallbacks[0]({});
  assert.deepEqual(h.downloads,[]);assert.match(h.el('nxc-status').textContent,/cleared/);
});
test('PNG encoding exceptions are surfaced without breaking panel actions',async()=>{
  const h=harness({encodeError:true});await compareLayers(h);
  await h.el('nxc-export').fire('click');
  assert.match(h.el('nxc-status').textContent,/PNG.*failed/i);
  assert.equal(h.el('nxc-export').disabled,false);
  await h.el('nxc-clear').fire('click');assert.equal(h.el('nxc-result').hidden,true);
});
test('empty file selection does not clear the current TIFF or leave a loading message',async()=>{
  const h=harness();await h.el('nxc-open').fire('click',{stopPropagation(){}});
  h.el('nxc-file').files=[{name:'prediction.tif',size:128}];await h.el('nxc-file').fire('change');
  h.el('nxc-file').files=[];await h.el('nxc-file').fire('change');
  assert.match(h.el('nxc-file-info').textContent,/prediction.tif/);
  h.el('nxc-confirm').checked=true;await h.el('nxc-run').fire('click');
  assert.match(h.el('nxc-status').textContent,/Comparison ready/);
});
test('closing during TIFF metadata loading clears busy state and ignores the late response',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  const h=harness({fromBlob:()=>pending});await h.el('nxc-open').fire('click',{stopPropagation(){}});
  h.el('nxc-file').files=[{name:'slow.tif',size:128}];const loading=h.el('nxc-file').fire('change');
  await h.el('nxc-close').fire('click');
  assert.doesNotMatch(h.el('nxc-file-info').textContent,/Reading/);
  finish({getImage:async()=>h.image});await loading;
  assert.doesNotMatch(h.el('nxc-file-info').textContent,/slow.tif/);
  assert.equal(h.el('nxc-run').disabled,false);
});
test('saved palette, reversal and percentile controls reach preview and PNG without altering statistics',async()=>{
  const h=harness();await compareLayers(h);const summary=h.el('nxc-summary').textContent;
  h.el('nxc-palette').value='saved:mine';await h.el('nxc-palette').fire('change');
  h.el('nxc-reverse').checked=true;await h.el('nxc-reverse').fire('change');
  h.el('nxc-percent-low').value='25';h.el('nxc-percent-high').value='75';await h.el('nxc-percent-low').fire('change');
  assert.deepEqual(Array.from(h.rasters.at(-1).slice(0,4)),[255,0,0,255]);
  assert.equal(h.el('nxc-summary').textContent,summary);
  await h.el('nxc-export').fire('click');
  assert.ok(h.texts.some(t=>t.includes('Palette: Saved · Test')&&t.includes('reversed')));
  assert.ok(h.texts.some(t=>t.includes('25–75%')));
  assert.deepEqual(Array.from(h.rasters.at(-1).slice(0,4)),[255,0,0,255]);
});
test('range presets select their accent state and invalid bounds block export',async()=>{
  const h=harness();await compareLayers(h);await h.presets[1].fire('click');
  assert.equal(h.el('nxc-percent-low').value,'2');assert.equal(h.el('nxc-percent-high').value,'98');
  assert.equal(h.presets[1].attrs['aria-pressed'],'true');
  h.el('nxc-percent-low').value='99';await h.el('nxc-percent-low').fire('change');
  assert.equal(h.el('nxc-export').disabled,true);assert.match(h.el('nxc-status').textContent,/Percentile/);
  await h.presets[0].fire('click');assert.equal(h.el('nxc-export').disabled,false);
});
test('comparison opens on terrain and the compact controls switch and export without a dialog',async()=>{
  const h=harness();await compareLayers(h);
  assert.equal(h.el('nxc-panel').open,false);
  assert.equal(h.el('nxc-terrain').hidden,false);
  assert.equal(h.shown.at(-1).id,'difference');
  await h.terrainButtons[1].fire('click');
  assert.equal(h.shown.at(-1).id,'b');assert.equal(h.el('nxc-panel').open,false);
  assert.equal(h.terrainButtons[1].attrs['aria-pressed'],'true');
  await h.el('nxc-terrain-export').fire('click');h.blobCallbacks[0]({});
  assert.deepEqual(h.downloads,['example_b_comparison.png']);
  await h.el('nxc-terrain-clear').fire('click');
  assert.equal(h.el('nxc-terrain').hidden,true);assert.equal(h.el('nxc-result').hidden,true);
});
test('colour inspector stays modeless and updates the terrain with the PNG style',async()=>{
  const h=harness();await compareLayers(h);
  await h.el('nxc-terrain-style').fire('click');
  assert.equal(h.el('nxc-panel').open,true);assert.equal(h.el('nxc-panel').modal,false);
  h.el('nxc-palette').value='saved:mine';await h.el('nxc-palette').fire('change');
  await h.presets[1].fire('click');
  assert.equal(h.shown.at(-1).style.stops[0][1],'#ff0000');
  assert.match(h.shown.at(-1).rangeLabel,/2–98%/);
  h.el('nxc-percent-low').value='99';await h.el('nxc-percent-low').fire('change');
  assert.equal(h.el('nxc-terrain-export').disabled,true);
  await h.presets[0].fire('click');assert.equal(h.el('nxc-terrain-export').disabled,false);
});
test('PNG and colour inspector read original legend edits and keep them when switching A/B',async()=>{
  const h=harness();await compareLayers(h);await h.terrainButtons[0].fire('click');
  h.setAppearance({lo:0,hi:4,style:{stops:[[0,'#00ff00'],[1,'#ffffff']],reverse:false},paletteName:'Edited terrain palette',rangeLabel:'Custom value limits'});
  await h.el('nxc-terrain-export').fire('click');
  assert.ok(h.texts.some(t=>t.includes('Palette: Edited terrain palette')));
  assert.deepEqual(Array.from(h.rasters.at(-1).slice(0,4)),[0,255,0,255]);
  h.blobCallbacks[0]({});
  await h.terrainButtons[1].fire('click');
  assert.equal(h.shown.at(-1).lo,0);assert.equal(h.shown.at(-1).hi,4);
  assert.equal(h.shown.at(-1).style.stops[0][1],'#00ff00');
  await h.el('nxc-terrain-style').fire('click');
  assert.equal(h.el('nxc-percent-low').value,'');
  h.el('nxc-palette').value='saved:mine';await h.el('nxc-palette').fire('change');
  assert.equal(h.shown.at(-1).hi,4);assert.equal(h.shown.at(-1).style.stops[0][1],'#ff0000');
  await h.presets[1].fire('click');assert.match(h.shown.at(-1).rangeLabel,/Robust 2–98%/);
});
test('a legend-edited palette survives switching maps after choosing a percentile preset',async()=>{
  const h=harness();await compareLayers(h);
  h.setAppearance({lo:-4,hi:4,style:{stops:[[0,'#00ff00'],[1,'#ffffff']],reverse:true},paletteName:'Edited terrain palette',rangeLabel:'Custom value limits'});
  await h.el('nxc-terrain-style').fire('click');await h.presets[1].fire('click');
  await h.terrainButtons[0].fire('click');await h.terrainButtons[2].fire('click');
  assert.equal(h.shown.at(-1).style.stops[0][1],'#00ff00');assert.equal(h.shown.at(-1).style.reverse,true);
  assert.match(h.shown.at(-1).rangeLabel,/Robust 2–98%/);
});
test('palette changes preserve legend limits edited after opening the modeless inspector',async()=>{
  const h=harness();await compareLayers(h);await h.el('nxc-terrain-style').fire('click');
  h.setAppearance({lo:-40,hi:40,style:{stops:[[0,'#00ff00'],[1,'#ffffff']],reverse:false},paletteName:'Edited legend',rangeLabel:'Custom value limits'});
  h.el('nxc-palette').value='saved:mine';await h.el('nxc-palette').fire('change');
  assert.equal(h.shown.at(-1).lo,-40);assert.equal(h.shown.at(-1).hi,40);
  assert.equal(h.shown.at(-1).style.stops[0][1],'#ff0000');
});
test('snow comparison controls cannot act on vegetation; only its own tab can resume it',async()=>{
  const h=harness();await compareLayers(h);await h.el('nxc-terrain-style').fire('click');
  const comparisonSelection=h.selection(),count=h.shown.length;
  h.navigate('veg_A');
  assert.equal(h.el('nxc-panel').open,false);assert.equal(h.el('nxc-terrain').hidden,true);
  assert.equal(h.el('nxc-open').hidden,false);assert.equal(h.selection().key,'veg_A');
  await h.terrainButtons[2].fire('click');await h.el('nxc-show').fire('click');
  await h.el('nxc-terrain-style').fire('click');await h.el('nxc-terrain-export').fire('click');
  assert.equal(h.shown.length,count);assert.equal(h.blobCallbacks.length,0);assert.equal(h.el('nxc-panel').open,false);
  h.emitSelection(comparisonSelection);assert.equal(h.el('nxc-terrain').hidden,false);
  await h.terrainButtons[1].fire('click');assert.equal(h.shown.at(-1).id,'b');
});
test('starting Compare on vegetation uses fresh vegetation inputs rather than old snow results',async()=>{
  const h=harness();await compareLayers(h);h.navigate('veg_A');
  await h.el('nxc-open').fire('click',{stopPropagation(){}});
  assert.equal(h.el('nxc-reference').value,'veg_A');assert.match(h.el('nxc-grid').textContent,/veg height/);
  assert.equal(h.el('nxc-result').hidden,true);assert.equal(h.el('nxc-confirm').checked,false);
  assert.equal(h.selection().key,'veg_A');
  assert.deepEqual(h.el('nxc-layer').children.map(o=>o.value),['veg_B']);
  h.el('nxc-source').value='layer';await h.el('nxc-source').fire('change');await h.el('nxc-run').fire('click');
  assert.equal(h.shown.at(-1).id,'difference');
  await h.terrainButtons[0].fire('click');assert.equal(h.shown.at(-1).values[0],4);
});
test('leaving during a TIFF read or PNG export invalidates late callbacks without changing the new layer',async()=>{
  const h=harness();await compareLayers(h);await h.el('nxc-export').fire('click');
  h.navigate('veg_A');h.blobCallbacks[0]({});assert.deepEqual(h.downloads,[]);assert.equal(h.selection().key,'veg_A');
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  const f=harness({fromBlob:()=>pending});await f.el('nxc-open').fire('click',{stopPropagation(){}});
  f.el('nxc-file').files=[{name:'snow.tif',size:128}];const loading=f.el('nxc-file').fire('change');
  f.navigate('veg_A');finish({getImage:async()=>f.image});await loading;
  await f.el('nxc-open').fire('click',{stopPropagation(){}});
  assert.equal(f.el('nxc-reference').value,'veg_A');assert.doesNotMatch(f.el('nxc-file-info').textContent,/snow.tif/);
  await f.el('nxc-run').fire('click');assert.match(f.el('nxc-status').textContent,/Choose a GeoTIFF/);
});
test('flat tabs suspend comparison controls and closing its tab clears the stale session',async()=>{
  const h=harness();await compareLayers(h);
  h.navigate(null,'timeline');assert.equal(h.el('nxc-terrain').hidden,true);
  h.navigate(null,'details');assert.equal(h.el('nxc-panel').open,false);
  h.emitSelection({key:'veg_A',tab:'veg_A',comparison:null,available:false});
  assert.equal(h.el('nxc-result').hidden,true);assert.equal(h.selection().key,'veg_A');
});
test('switching layers during raster alignment cannot publish a late snow result onto vegetation',async()=>{
  let release,started;const readStarted=new Promise(resolve=>{started=resolve;}),pending=new Promise(resolve=>{release=resolve;});
  const h=harness({readRasters:()=>{started();return pending;}});
  await h.el('nxc-open').fire('click',{stopPropagation(){}});
  h.el('nxc-file').files=[{name:'snow.tif',size:128}];await h.el('nxc-file').fire('change');h.el('nxc-confirm').checked=true;
  const running=h.el('nxc-run').fire('click');await readStarted;
  h.navigate('veg_A');release(new Float32Array([1,2,3,4]));await running;
  assert.equal(h.shown.length,0);assert.equal(h.selection().key,'veg_A');assert.equal(h.el('nxc-panel').open,false);
  await h.el('nxc-open').fire('click',{stopPropagation(){}});
  assert.equal(h.el('nxc-reference').value,'veg_A');assert.equal(h.el('nxc-confirm').checked,false);
});
test('a different layer of the same product also starts with its own reference',async()=>{
  const h=harness();await compareLayers(h);h.navigate('depth_B');
  assert.equal(h.el('nxc-terrain').hidden,true);
  await h.el('nxc-open').fire('click',{stopPropagation(){}});
  assert.equal(h.el('nxc-reference').value,'depth_B');assert.equal(h.el('nxc-result').hidden,true);
  assert.deepEqual(h.el('nxc-layer').children.map(o=>o.value),['depth_A']);
});
