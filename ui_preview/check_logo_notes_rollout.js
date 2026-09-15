/* All-site structural and add-on interaction checks; no browser rendering claim. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const [candidate,backup,metadataSnapshot]=process.argv.slice(2);if(!candidate||!backup||!metadataSnapshot)throw Error('Expected candidate, baseline, and compact-metadata snapshot paths');
const marker='\n<!-- SnowEx logo and notes addon v1 -->\n';
const compareMarker='\n<!-- SnowEx comparison addon v1 -->\n';
const split=s=>{
  const comparison=s.split(compareMarker);assert(comparison.length<=2,'At most one comparison suffix');
  const notes=comparison[0].split(marker);assert(notes.length<=2,'At most one notes add-on');
  assert(!comparison[1]?.includes(marker),'Notes must precede the comparison suffix');
  return {base:notes[0],notes:notes[1],comparison:comparison.length===2?compareMarker+comparison[1]:''};
};
const before=split(fs.readFileSync(backup,'utf8')),html=fs.readFileSync(candidate,'utf8'),after=split(html);
const root=path.resolve(__dirname,'..'),approved=fs.readFileSync(path.join(root,'ui_preview/banner_summit_logo_notes_preview.html'),'utf8');
assert.equal(html.split(marker).length,2,'Exactly one isolated add-on');
assert.equal(after.base,before.base,'Original renderer, styles, payload and embedded comparison bridge are byte-identical');
assert.equal(after.comparison,before.comparison,'Existing comparison UI, algorithms and libraries are byte-identical');
const body=(s,id)=>s.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)<\\/script>'))[1];
const css=s=>s.match(/<style id="nxn-style">([\s\S]*?)<\/style>/)[1];
assert.equal(css(html),css(approved),'Exact approved add-on style');
const controller=s=>body(s,'nxn-script').slice(body(s,'nxn-script').indexOf('  function close('));
assert(controller(approved).startsWith('  function close('));
assert.equal(controller(html),controller(approved),'Exact approved open/close/visibility/layout controller');
const template=fs.readFileSync(path.join(root,'ui_preview/logo_notes_addon.html'),'utf8');
assert.equal(body(html,'nxn-script'),body(template,'nxn-script'),'Current product notes template');
assert.equal(after.notes,template.replace('__NXN_METADATA__',body(html,'nxn-metadata'))
  .replace('__NXN_LOGO__',fs.readFileSync(path.join(root,'assets/cryogars-logo.jpg')).toString('base64')),
  'Only the current approved notes template and its bound metadata/logo may replace the notes segment');
// Extra styling must remain scoped to content inside the existing drawer.
const demCSS=html.match(/<style id="nxn-dem-style">([\s\S]*?)<\/style>/)[1];
for(const selector of demCSS.matchAll(/([^{}]+)\{/g))assert(selector[1].trim().startsWith('#nxn-content .nxn-'));
assert(!html.includes('<base href="../viewer/">'),'No preview-only navigation base');
for(const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g))if(!m[1].includes('application/json'))new Function(m[2]);
for(const id of ['nxn-logo','nxn-trigger','nxn-panel','nxn-style','nxn-script'])assert.equal(html.split('id="'+id+'"').length,2,id+' occurs once');
const payload=JSON.parse(body(html,'payload')),data=JSON.parse(body(html,'nxn-metadata'));
const expected=JSON.parse(fs.readFileSync(metadataSnapshot,'utf8'))[path.basename(candidate)];
assert(expected,'Site must have an entry in the staged compact-metadata snapshot');
assert.deepEqual(data,expected,'Complete current compact-metadata contract, including optional lineage and radar context');
assert.equal(data.site,payload.identification.site_name||payload.site);
assert.equal(data.dem,payload.dem_path);assert.equal(data.grid,payload.grid.res_m);
assert.equal(data.epsg,payload.identification.common_crs_epsg);
assert.deepEqual(data.origin,payload.grid.origin);assert.deepEqual(data.shape,payload.grid.full);
assert.deepEqual(Object.keys(data.layers),Object.keys(payload.arrays));
const tree=new Map(payload.tree.map(n=>[n.path,n]));
for(const [key,layer] of Object.entries(data.layers)){
  const raw=payload.arrays[key],attrs=tree.get(raw.source||key)?.attrs||{};
  for(const [field,value] of Object.entries(layer.attrs))assert.deepEqual(value,attrs[field],key+' · exact recorded '+field);
  assert.equal(layer.source,raw.source||key);assert.equal(layer.leaf,raw.leaf||key.split('/').pop());
  assert.equal(layer.cell,raw.cell_m??data.grid);assert.equal(layer.label,raw.label||key.split('/').pop());
  if('aggregation' in raw)assert.deepEqual(layer.aggregation,raw.aggregation);
}
const nodes=new Map(),observers=[];
function node(id){if(!nodes.has(id))nodes.set(id,{id,hidden:id==='nxn-panel',style:{},attrs:{},events:{},children:[],textContent:'',innerHTML:'',
  appendChild(c){this.children.push(c);},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,f){this.events[k]=f;},focus(){scope.focused=id;},
  getBoundingClientRect(){return id==='nxn-logo'?{left:900,right:988,top:700,bottom:736}:{left:0,right:200,top:0,bottom:200};}});return nodes.get(id);}
node('nxn-metadata').textContent=JSON.stringify(data);node('iPath').textContent=data.dem;
class Observer{constructor(callback){this.callback=callback;observers.push(this);}observe(target){this.target=target;}}
const scope=vm.createContext({document:{getElementById:node},MutationObserver:Observer,ResizeObserver:Observer,focused:null,
  getComputedStyle:n=>({display:n.style.display||'block',visibility:n.style.visibility||'visible'})});
vm.runInContext(body(html,'nxn-script'),scope);
const event=key=>({key,stopped:false,prevented:false,stopPropagation(){this.stopped=true;},preventDefault(){this.prevented=true;}});
assert(node('nxn-panel').hidden);
assert.equal(node('info').children.length,1,'One additive Info footer row');
assert.equal(node('info').children[0].id,'nxn-trigger');
const e=event();node('nxn-trigger').events.click(e);assert(e.stopped);assert(!node('nxn-panel').hidden);
assert.equal(node('nxn-title').textContent,'Elevation');assert(node('nxn-site').textContent.startsWith(data.site));
const demHTML=node('nxn-content').innerHTML,dem=data.layers[data.dem].attrs;
assert(demHTML.includes('href="'+dem.source_url+'"'),'Original recorded GeoTIFF URL');
assert(demHTML.includes('Same row. Same column. Same mapped location.'));
assert(demHTML.includes('x(r, c) = L + 3(c + ½)'));
assert(demHTML.includes('y(r, c) = T − 3(r + ½)'));
assert(demHTML.includes('z′ = Σᵢⱼ(mᵢⱼ wᵢⱼ zᵢⱼ) / Σᵢⱼ(mᵢⱼ wᵢⱼ)'));
assert(demHTML.includes(data.origin.join(', ')+' m'));
assert(demHTML.includes(data.shape.join(' × ')));
assert(demHTML.includes('Nodata normalization')&&demHTML.includes('archive cleaning'));
if(dem.source_native_resolution_m===3)assert(demHTML.includes('Already 3 m at the source.'));
else {assert.equal(dem.source_native_resolution_m,1);assert(demHTML.includes('1 m source DEM'));assert(demHTML.includes('[1, 2, 3, 2, 1] / 9'));}
if(payload.site==='grand_mesa'){
  assert(demHTML.includes('LiDAR-derived snow-off'));
  assert.equal(demHTML.includes('Provenance correction:'),/satellite photogrammetry/i.test(dem.source_note||''),
    'Grand Mesa warning follows the current recorded note, not an already-corrected historical note');
}
if(payload.site==='reynolds_creek')assert(demHTML.includes('EPSG:26911'));
for(const link of demHTML.matchAll(/<a href="([^"]+)"([^>]*)>/g)){
  assert(link[1].startsWith('https://'));assert(link[2].includes('rel="noopener noreferrer"'));
}
for(const k of Object.keys(data.layers)){
  node('iPath').textContent=k;observers.find(o=>o.target.id==='iPath').callback();
  assert.equal(node('nxn-title').textContent,k===data.dem?'Elevation':data.layers[k].label);
  assert(!/>\s*undefined\s*</.test(node('nxn-content').innerHTML));
  if(/^science\/LIDAR\/DERIVED\/(slope|aspect)$/.test(k)){
    const notes=node('nxn-content').innerHTML;
    assert(['horn_1981_3x3','horn_1981_3x3_downhill_grid_bearing'].includes(data.layers[k].attrs.method));
    assert(notes.includes('Horn’s 3 × 3 neighbourhood'));
    assert(notes.includes(dem.source_filename));
    assert(notes.includes('href="'+dem.source_url+'"'));
    if(k.endsWith('/aspect')){
      assert(notes.includes('aspect_sin = sin(θ)')&&notes.includes('aspect_cos = cos(θ)'));
      assert(notes.includes('θ = A × π / 180'));
      if(data.layers[k].attrs.aspect_convention==='downhill_clockwise_from_grid_north')assert(notes.includes('Downhill grid bearing.'));
      else assert(notes.includes('Direction convention needs review.'));
      if(data.layers[k].aggregation?.method==='circular_mean_degrees')assert(notes.includes('This export uses a circular mean'));
      else assert(notes.includes('ordinary block mean')&&notes.includes('does not recalculate'));
      assert(notes.includes('validity mask'));
    }else{
      assert(notes.includes('β_deg = atan(√(p² + q²)) × 180/π'));
      assert(notes.includes('β_rad = β_deg × π / 180'));
    }
  }
  const layer=data.layers[k],leaf=layer.leaf,notes=node('nxn-content').innerHTML;
  const heading=leaf==='veg_height'?'Vegetation height':leaf.startsWith('forest_cover_fraction_')?'Canopy fraction':
    leaf==='cor'?'Coherence':leaf==='int ∠phase'?'Wrapped phase':leaf==='unw'?'Unwrapped phase':null;
  if(heading){
    assert(notes.includes('<h3>'+heading+'</h3>'),k+' has its approved product explanation');
    assert(!notes.includes('recorded metadata only'),k+' does not fall through to generic notes');
    assert(notes.includes(String(layer.cell))&&notes.includes('archive grid'),k+' separates display and archive grids');
  }
  if(leaf.startsWith('forest_cover_fraction_')&&layer.attrs.derived_from_stage!=='enriched_base_after_cleaning')
    assert(notes.includes('input processing stage is not established'),'Legacy canopy is not presented as a verified corrected derivative');
  if(leaf==='unw'&&!layer.attrs.unw_zero_mask_status)
    assert(notes.includes('Application to this individual layer is not established'),'Legacy group counters do not verify per-layer zero removal');
  if(leaf==='local_incidence_angle'&&layer.attrs.incidence_ge_90_status===undefined&&typeof layer.attrs.radar_shadow_fraction==='number')
    assert(notes.includes('Legacy share of whole grid')&&notes.includes('not the corrected finite-cell percentage'));
}
const escape=event('Escape');node('nxn-panel').events.keydown(escape);
assert(escape.stopped&&escape.prevented&&node('nxn-panel').hidden);assert.equal(scope.focused,'nxn-trigger');
node('nxn-trigger').events.click(event());node('info').style.display='none';observers.find(o=>o.target.id==='info').callback();
assert(node('nxn-panel').hidden,'Closing Info closes notes');
node('info').style.display='';observers.find(o=>o.target.id==='info').callback();
assert(node('nxn-panel').hidden,'Reopening Info does not force the notes open');
node('nxn-trigger').events.click(event());node('info').style.visibility='hidden';observers.find(o=>o.target.id==='info').callback();
assert(node('nxn-panel').hidden&&node('nxn-logo').hidden);
console.log('PASS: '+payload.site+' · '+Object.keys(data.layers).length+' layers · renderer/layout/data/Compare unchanged; current approved notes, complete metadata binding, legacy gates and Info events checked with DOM stubs.');
