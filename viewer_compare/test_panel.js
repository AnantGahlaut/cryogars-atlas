const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('bridge inserts/removes only temporary layers and restores original selection',()=>{
  const {ctx,api}=bridgeHarness({withoutAngular:true}),P=ctx.P,original=P.arrays.dem;
  const choices=api.palettes('dem');assert.equal(choices[0].id,'terrain');
  choices[0].stops[0][1]='#ff0000';assert.equal(ctx.BUILTIN_STOPS.terrain[0][1],'#000000');
  assert.equal(api.context().current,'dem');
  api.show({id:'difference',label:'B minus A',unit:'m',grid:{w:2,h:2,dx:3,dy:-3,left:100,top:200},values:new Float32Array([1,NaN,-1,0]),lo:-1,hi:1,cmap:'diverging'});
  assert.equal(Object.keys(P.arrays).length,2);assert.equal(api.context().current,'dem');
  assert.deepEqual(Array.from(ctx.floats(ctx.primKey)),[1,NaN,-1,0]);
  assert.equal(typeof ctx.angularKind,'undefined');
  const oldKey=ctx.primKey;ctx.PREF.ranges={[oldKey]:[-.1,.1]};
  assert.equal(P.arrays.dem,original);api.clear();
  assert.deepEqual(Object.keys(P.arrays),['dem']);assert.equal(ctx.primKey,'dem');
  for(const values of Object.values(ctx.PREF))assert.equal(Object.keys(values).length,0);
  api.show({id:'difference',label:'New difference',grid:{w:2,h:2,dx:3,dy:-3,left:100,top:200},values:new Float32Array([100,NaN,-100,0]),lo:-100,hi:100});
  assert.notEqual(ctx.primKey,oldKey);assert.deepEqual(Array.from(ctx.PREF.ranges[ctx.primKey]),[-100,100]);
  const mainPreset={mode:'continuous',stops:[[0,'#000000'],[1,'#ffffff']]};ctx.PREF.customs={dem:mainPreset};
  api.show({id:'difference',label:'Styled difference',grid:{w:2,h:2,dx:3,dy:-3,left:100,top:200},values:new Float32Array([100,NaN,-100,0]),lo:-50,hi:100,
    style:{stops:[[0,'#ff0000'],[1,'#0000ff']],reverse:true}});
  const styledKey=ctx.primKey;
  assert.equal(ctx.PREF.palettes[styledKey],'__custom__');assert.equal(ctx.PREF.reverse[styledKey],true);
  assert.deepEqual(Array.from(ctx.PREF.ranges[styledKey]),[-50,100]);assert.equal(ctx.PREF.customs.dem,mainPreset);
  api.clear();assert.equal(ctx.PREF.customs.dem,mainPreset);assert.equal(ctx.PREF.customs[styledKey],undefined);
});

// Keep the original palette/range and tab functions in these integration checks.
const template=fs.readFileSync('explorer_template.html','utf8');
function templateFunction(name){
  const start=template.indexOf('function '+name+'('),next=template.indexOf('\nfunction ',start+1);
  return template.slice(start,next);
}
function bridgeHarness(options={}){
  const original={w:2,h:2,cell_m:3,label:'Elevation',leaf:'elevation',lo:1,hi:4,unit:'m',b64:'',bits:16};
  const stored={},P={site:'test',grid:{w:2,h:2,cell_m:3,origin:[100,200],pixel:[3,-3]},identification:{common_crs_epsg:32612},arrays:{dem:original},dem_path:'dem'};
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{value:'',style:{},classList:{toggle(){}}});return elements.get(id);};
  const ctx={P,G:P.grid,W:2,H:2,DEM:'dem',window:{},primKey:'dem',ovKey:null,active:'dem',glOn:true,infoOpen:false,
    floats:()=>new Float32Array([1,2,3,4]),cache:new Map(),tabs:[{id:'dem',kind:'layer',key:'dem',pin:true},{id:'timeline',kind:'timeline',pin:true},{id:'details',kind:'details',pin:true}],
    PREF:{palettes:{},customs:{},ranges:{},rangeModes:{},reverse:{},savedPalettes:{},typeActive:{}},
    BUILTIN_STOPS:{terrain:[[0,'#000000'],[1,'#ffffff']],viridis:[[0,'#440154'],[1,'#fde725']],diverging:[[0,'#b42d1d'],[.5,'#f6f5f0'],[1,'#1d5aa7']]},
    PALETTE_LABELS:{terrain:'Terrain',viridis:'Viridis',diverging:'Diverging'},
    Uint8Array,Float32Array,Map,Math,Number,btoa:s=>Buffer.from(s,'binary').toString('base64'),
    setPrimary(k){ctx.primKey=k;},closeLegendEditor(){},renderDetails(){},renderTimeline(){},
    setOverlay(k){ctx.ovKey=k;},$:element,renderTabs(){},nodeAt:()=>null,
    PREF_KEY:'preferences',PREF_WINDOW_PREFIX:'prefs:',localStorage:{setItem(k,v){stored[k]=v;}}};
  vm.createContext(ctx);
  vm.runInContext(template.slice(template.indexOf('function productKind('),template.indexOf('function customRampCss(')),ctx);
  vm.runInContext(template.slice(template.indexOf('function savePrefs('),template.indexOf('applyUiPrefs(false);')),ctx);
  vm.runInContext(templateFunction('activate')+templateFunction('openLayer')+templateFunction('closeTab').split('/* ================= tree')[0],ctx);
  if(options.withoutAngular)ctx.angularKind=undefined;
  vm.runInContext(fs.readFileSync('viewer_compare/bridge.js','utf8'),ctx);
  return {ctx,api:ctx.window.SnowCompareViewer,stored};
}
const comparison=(overrides={})=>({id:'difference',label:'Difference',unit:'m',grid:{w:2,h:2,dx:3,dy:-3,left:100,top:200},
  values:new Float32Array([-50,0,100,NaN]),lo:-10,hi:20,cmap:'diverging',
  style:{stops:[[0,'#ff0000'],[1,'#0000ff']],reverse:false},paletteName:'Saved · Red blue',rangeLabel:'Custom 25–75% stretch',...overrides});

test('selection observers follow actual layer and flat tab activation without discarding the comparison',()=>{
  const {ctx,api}=bridgeHarness(),events=[];
  assert.equal(typeof api.onSelection,'function');
  const stop=api.onSelection(s=>events.push({...s}));
  assert.deepEqual(events,[{key:'dem',tab:'dem',comparison:null,available:false}]);
  ctx.activate('dem');ctx.closeTab('dem');assert.equal(events.length,1);
  api.show(comparison());const key=ctx.primKey,tab=ctx.active;
  assert.equal(events.length,2);assert.deepEqual(events.at(-1),{key,tab,comparison:'difference',available:true});
  api.show(comparison({id:'a'}));
  assert.equal(events.length,3);assert.equal(events.at(-1).comparison,'a');
  ctx.P.arrays.vegetation={...ctx.P.arrays.dem,leaf:'veg_height'};ctx.openLayer('vegetation');
  assert.deepEqual(events.at(-1),{key:'vegetation',tab:ctx.active,comparison:null,available:true});
  for(const id of ['details','timeline']){
    ctx.activate(tab);ctx.activate(id);
    assert.equal(ctx.primKey,key);assert.deepEqual(events.at(-1),{key:null,tab:id,comparison:null,available:true});
    assert.equal(api.appearance('a'),null);
  }
  ctx.activate(tab);assert.equal(api.selection().comparison,'a');
  assert.equal(ctx.P.arrays[key].label,'Difference');
  const count=events.length;ctx.activate(tab);ctx.activate('missing');assert.equal(events.length,count);
  stop();ctx.openLayer('dem');assert.equal(events.length,count);
});

test('clearing after a new layer is selected preserves that layer and its overlay',()=>{
  for(const options of [undefined,{restore:false}]){
    const {ctx,api}=bridgeHarness();
    ctx.P.arrays.snow={...ctx.P.arrays.dem,leaf:'snow_depth'};ctx.P.arrays.vegetation={...ctx.P.arrays.dem,leaf:'veg_height'};
    ctx.openLayer('snow');ctx.setOverlay('snow');api.show(comparison());const key=ctx.primKey;
    ctx.openLayer('vegetation');ctx.setOverlay('vegetation');const tab=ctx.active;
    api.clear(options);
    assert.equal(ctx.primKey,'vegetation');assert.equal(ctx.active,tab);assert.equal(ctx.ovKey,'vegetation');
    assert.equal(ctx.P.arrays[key],undefined);assert.equal(ctx.tabs.some(t=>t.key===key),false);
    for(const field of ['palettes','customs','ranges','rangeModes','reverse'])assert.equal(ctx.PREF[field][key],undefined);
    assert.equal(api.selection().available,false);
  }
});

test('clearing on Details or Timeline does not reopen the old reference or overlay',()=>{
  for(const id of ['details','timeline']){
    const {ctx,api}=bridgeHarness();ctx.setOverlay('dem');api.show(comparison());
    ctx.activate(id);api.clear();
    assert.equal(ctx.active,id);assert.equal(ctx.glOn,false);assert.equal(ctx.ovKey,null);
    assert.equal(api.selection().key,null);assert.equal(api.selection().available,false);
  }
});

test('active comparison clear restores a reference whose original tab was closed and emits only final state',()=>{
  const {ctx,api}=bridgeHarness(),events=[];
  ctx.P.arrays.snow={...ctx.P.arrays.dem,leaf:'snow_depth'};ctx.openLayer('snow');ctx.setOverlay('snow');
  const sourceTab=ctx.active;api.show(comparison());ctx.closeTab(sourceTab);
  assert.equal(typeof api.onSelection,'function');
  api.onSelection(s=>events.push({...s}));api.clear();
  assert.equal(events.length,2);assert.equal(events.at(-1).key,'snow');assert.equal(events.at(-1).available,false);
  assert.equal(ctx.ovKey,'snow');assert.equal(ctx.tabs.some(t=>t.key==='snow'),true);
  assert.equal(Object.keys(ctx.P.arrays).filter(k=>k.startsWith('__temporary_comparison__/')).length,0);
});

test('closing active or inactive comparison tabs reports loss once and tolerates synchronous cleanup',()=>{
  for(const activeComparison of [true,false]){
    const {ctx,api}=bridgeHarness(),events=[];
    ctx.P.arrays.vegetation={...ctx.P.arrays.dem,leaf:'veg_height'};api.show(comparison());const tab=ctx.active,key=ctx.primKey;
    if(!activeComparison){ctx.openLayer('vegetation');ctx.setOverlay('vegetation');}
    assert.equal(typeof api.onSelection,'function');
    api.onSelection(s=>{events.push({...s});if(!s.available)api.clear({restore:false});});
    ctx.closeTab(tab);
    assert.equal(events.length,2);assert.equal(events.at(-1).available,false);assert.equal(events.at(-1).comparison,null);
    assert.equal(ctx.primKey,activeComparison?'dem':'vegetation');assert.equal(ctx.ovKey,activeComparison?null:'vegetation');
    assert.equal(ctx.P.arrays[key],undefined);assert.equal(api.appearance('difference'),null);
  }
});

test('switching comparison maps reuses one temporary tab and replaces its values',()=>{
  const {ctx,api}=bridgeHarness();api.show(comparison());const key=ctx.primKey;
  api.show(comparison({id:'a',label:'Reference A',values:new Float32Array([1,2,3,4])}));
  assert.equal(ctx.primKey,key);assert.equal(ctx.tabs.filter(t=>!t.pin).length,1);
  assert.equal(Object.keys(ctx.P.arrays).length,2);assert.deepEqual(Array.from(ctx.floats(key)),[1,2,3,4]);
  assert.equal(ctx.P.arrays[key].label,'Reference A');api.clear();
  assert.equal(ctx.primKey,'dem');assert.equal(ctx.tabs.filter(t=>!t.pin).length,0);
  api.show(comparison());assert.notEqual(ctx.primKey,key);
});

test('temporary payload retains full finite bounds while display keeps percentile limits',()=>{
  const {ctx,api}=bridgeHarness();api.show(comparison());const key=ctx.primKey,L=ctx.P.arrays[key];
  assert.deepEqual([L.lo,L.hi],[-50,100]);assert.deepEqual(Array.from(ctx.PREF.ranges[key]),[-10,20]);
  const decoded=require('./core').decode(L);assert.equal(decoded[0],-50);assert.equal(decoded[2],100);assert.ok(Number.isNaN(decoded[3]));
  delete ctx.PREF.ranges[key];ctx.PREF.rangeModes[key]='full';
  const shown=api.appearance('difference');assert.deepEqual([shown.lo,shown.hi],[-50,100]);assert.match(shown.rangeLabel,/Full/);
});

test('appearance readback preserves provenance and returns copies only for the active map',()=>{
  const {ctx,api}=bridgeHarness(),result=comparison();api.show(result);
  assert.equal(typeof api.appearance,'function');const shown=api.appearance('difference');
  assert.deepEqual([shown.lo,shown.hi],[-10,20]);assert.equal(shown.paletteName,'Saved · Red blue');
  assert.equal(shown.rangeLabel,'Custom 25–75% stretch');assert.equal(shown.style.reverse,false);
  shown.style.stops[0][1]='#ffffff';assert.equal(ctx.PREF.customs[ctx.primKey].stops[0][1],'#ff0000');
  result.style.stops[1][1]='#ffffff';assert.equal(api.appearance('difference').paletteName,'Saved · Red blue');
  assert.equal(api.appearance('a'),null);ctx.primKey='dem';assert.equal(api.appearance('difference'),null);
});

test('appearance follows original legend palette, reversal and range modes',()=>{
  const {ctx,api}=bridgeHarness();api.show(comparison());const key=ctx.primKey;
  ctx.PREF.palettes[key]='viridis';ctx.PREF.reverse[key]=true;ctx.PREF.ranges[key]=[-5,15];
  let shown=api.appearance('difference');assert.equal(shown.paletteName,'Viridis');assert.equal(shown.style.reverse,true);
  assert.equal(shown.style.builtin,'viridis');
  assert.equal(shown.style.stops[0][1],'#440154');assert.deepEqual([shown.lo,shown.hi],[-5,15]);assert.equal(shown.rangeLabel,'Custom value limits');
  for(const [mode,label]of [['robust','2–98%'],['detail','10–90%']]){
    ctx.PREF.rangeModes[key]=mode;const labelText=api.appearance('difference').rangeLabel;
    assert.ok(labelText.includes(label));assert.match(labelText,/3D legend.*Difference terrain samples \(sampled ranks\)/);
  }
  // The shader checks the scientific diverging flag, not the selected colour palette.
  ctx.P.arrays[key].cmap='diverging';ctx.PREF.rangeModes[key]='custom';
  shown=api.appearance('difference');assert.deepEqual([shown.lo,shown.hi],[-15,15]);
});

test('new renderer receives angular A and B quantities while signed differences stay scalar',()=>{
  const {ctx,api}=bridgeHarness();
  ctx.P.arrays.aspect={leaf:'aspect',unit:'deg'};ctx.P.arrays.phase={leaf:'int_phase',unit:'rad'};
  assert.equal(ctx.angularKind('aspect'),1);assert.equal(ctx.angularKind('phase'),2);assert.equal(ctx.angularKind('dem'),0);
  for(const [id,mode,expected]of [['a','degrees',1],['b','radians',2],['difference','degrees',0],['difference','radians',0],['a','linear',0]]){
    api.show(comparison({id,mode}));assert.equal(ctx.angularKind(ctx.primKey),expected);
  }
  assert.equal(ctx.angularKind('aspect'),1);assert.equal(ctx.angularKind('phase'),2);
});

test('captured terrain-sample range provenance survives restyling the same map',()=>{
  const {ctx,api}=bridgeHarness();api.show(comparison({id:'a'}));
  ctx.PREF.rangeModes[ctx.primKey]='robust';ctx.PREF.ranges[ctx.primKey]=[-5,15];
  const captured=api.appearance('a');assert.match(captured.rangeLabel,/A terrain samples \(sampled ranks\)/);
  api.show(comparison({id:'a',...captured}));assert.equal(api.appearance('a').rangeLabel,captured.rangeLabel);
});

test('palette choices distinguish native shader palettes from saved custom colours',()=>{
  const {ctx,api}=bridgeHarness();
  const preset={id:'mine',name:'Mine',type:'elevation',mode:'continuous',stops:[[0,'#ff0000'],[1,'#0000ff']]};
  ctx.PREF.savedPalettes.mine=preset;
  let choices=api.palettes('dem');
  assert.equal(choices.find(p=>p.id==='terrain').builtin,'terrain');
  assert.equal(choices.find(p=>p.id==='__source__').builtin,'terrain');
  assert.equal(Object.hasOwn(choices.find(p=>p.id==='saved:mine'),'builtin'),false);
  ctx.PREF.palettes.dem='__custom__';ctx.PREF.customs.dem=preset;
  choices=api.palettes('dem');assert.equal(Object.hasOwn(choices.find(p=>p.id==='__source__'),'builtin'),false);
});

test('native display round trips preserve shader selection and supplied palette provenance',()=>{
  const {ctx,api}=bridgeHarness();
  const result=comparison({paletteName:'Native selection',style:{stops:[[0,'#440154'],[1,'#fde725']],reverse:true,builtin:'viridis'}});
  api.show(result);const key=ctx.primKey;
  assert.equal(ctx.PREF.palettes[key],'viridis');assert.equal(ctx.PREF.customs[key],undefined);
  const shown=api.appearance('difference');
  assert.equal(shown.style.builtin,'viridis');assert.equal(shown.style.reverse,true);
  assert.equal(shown.paletteName,'Native selection');assert.deepEqual([shown.lo,shown.hi],[-10,20]);
  assert.equal(ctx.P.arrays[key].cmap,'viridis');
  api.show({...result,...shown});assert.equal(ctx.PREF.palettes[key],'viridis');
  api.show(comparison());assert.equal(Object.hasOwn(api.appearance('difference').style,'builtin'),false);
});

test('saving original preferences excludes temporary entries and restores active memory',()=>{
  const {ctx,api,stored}=bridgeHarness();api.show(comparison());const key=ctx.primKey;
  const preset={name:'Saved original',mode:'continuous',stops:[[0,'#000000'],[1,'#ffffff']]};
  ctx.PREF.savedPalettes.original=preset;ctx.PREF.customs.dem=preset;ctx.PREF.palettes.dem='__custom__';
  ctx.PREF.ranges.dem=[1,4];ctx.PREF.rangeModes.dem='full';ctx.PREF.reverse.dem=true;
  const activeStyle=ctx.PREF.customs[key],customMap=ctx.PREF.customs;
  ctx.savePrefs();const saved=JSON.parse(stored.preferences);
  for(const field of ['palettes','customs','ranges','rangeModes','reverse']){
    assert.equal(saved[field][key],undefined);assert.deepEqual(saved[field].dem,ctx.PREF[field].dem);
    assert.ok(Object.hasOwn(ctx.PREF[field],key));
  }
  assert.equal(ctx.PREF.customs,customMap);assert.equal(ctx.PREF.customs[key],activeStyle);
  assert.deepEqual(saved.savedPalettes.original,preset);assert.ok(ctx.PREF.savedAt>0);
  assert.doesNotMatch(ctx.window.name,/__temporary_comparison__/);
});
test('PNG colour mapping treats NaN as transparent and centers differences on zero',()=>{
  const E=require('./export.js');
  assert.deepEqual(E.rgb(NaN,-2,2,true),[0,0,0,0]);
  assert.deepEqual(E.rgb(0,-2,2,true),[246,245,240,255]);
  assert.deepEqual(E.rgb(-2,-2,2,true),[180,45,29,255]);
  assert.deepEqual(E.rgb(2,-2,2,true),[29,90,167,255]);
});
