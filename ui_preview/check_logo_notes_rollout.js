/* All-site structural and add-on interaction checks; no browser rendering claim. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const [candidate,backup]=process.argv.slice(2);if(!candidate||!backup)throw Error('Expected candidate and baseline paths');
const marker='\n<!-- SnowEx logo and notes addon v1 -->\n';
const before=fs.readFileSync(backup,'utf8').split(marker)[0],html=fs.readFileSync(candidate,'utf8');
const root=path.resolve(__dirname,'..'),approved=fs.readFileSync(path.join(root,'ui_preview/banner_summit_logo_notes_preview.html'),'utf8');
assert.equal(html.split(marker).length,2,'Exactly one isolated add-on');
assert.equal(html.split(marker)[0],before,'Original page byte-for-byte intact');
const body=(s,id)=>s.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)<\\/script>'))[1];
const css=s=>s.match(/<style id="nxn-style">([\s\S]*?)<\/style>/)[1];
assert.equal(css(html),css(approved),'Exact approved add-on style');
const controller=s=>body(s,'nxn-script').slice(body(s,'nxn-script').indexOf('  function close('));
assert(controller(approved).startsWith('  function close('));
assert.equal(controller(html),controller(approved),'Exact approved open/close/visibility/layout controller');
const template=fs.readFileSync(path.join(root,'ui_preview/logo_notes_addon.html'),'utf8');
assert.equal(body(html,'nxn-script'),body(template,'nxn-script'),'Current product notes template');
// Extra styling must remain scoped to content inside the existing drawer.
const demCSS=html.match(/<style id="nxn-dem-style">([\s\S]*?)<\/style>/)[1];
for(const selector of demCSS.matchAll(/([^{}]+)\{/g))assert(selector[1].trim().startsWith('#nxn-content .nxn-'));
assert(!html.includes('<base href="../viewer/">'),'No preview-only navigation base');
for(const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g))if(!m[1].includes('application/json'))new Function(m[2]);
for(const id of ['nxn-logo','nxn-trigger','nxn-panel','nxn-style','nxn-script'])assert.equal(html.split('id="'+id+'"').length,2,id+' occurs once');
const payload=JSON.parse(body(html,'payload')),data=JSON.parse(body(html,'nxn-metadata'));
assert.equal(data.site,payload.identification.site_name||payload.site);
assert.equal(data.dem,payload.dem_path);assert.equal(data.grid,payload.grid.res_m);
assert.equal(data.epsg,payload.identification.common_crs_epsg);
assert.deepEqual(data.origin,payload.grid.origin);assert.deepEqual(data.shape,payload.grid.full);
assert.deepEqual(Object.keys(data.layers),Object.keys(payload.arrays));
const fields=['source_dataset','source_filename','source_url','acquisition_date','acquisition_date_end','source_native_resolution_m','resampling_method','source_note','units','derived_from','method','canopy_height_threshold_m','window_m','coherence_threshold'];
const tree=new Map(payload.tree.map(n=>[n.path,n]));
for(const [key,layer] of Object.entries(data.layers)){
  const raw=payload.arrays[key],attrs=tree.get(raw.source||key)?.attrs||{};
  assert.deepEqual(layer.attrs,Object.fromEntries(fields.filter(k=>k in attrs).map(k=>[k,attrs[k]])));
  assert.equal(layer.cell,raw.cell_m);assert.equal(layer.label,raw.label||key.split('/').pop());
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
assert(demHTML.includes('not the entire processing chain'));
if(dem.source_native_resolution_m===3)assert(demHTML.includes('Already 3 m at the source.'));
else {assert.equal(dem.source_native_resolution_m,1);assert(demHTML.includes('1 m source DEM'));assert(demHTML.includes('[1, 2, 3, 2, 1] / 9'));}
if(payload.site==='grand_mesa')assert(demHTML.includes('LiDAR-derived snow-off')&&demHTML.includes('Provenance correction:'));
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
    assert.equal(data.layers[k].attrs.method,'horn_1981_3x3');
    assert(notes.includes('Horn’s 3 × 3 neighbourhood'));
    assert(notes.includes(dem.source_filename));
    assert(notes.includes('href="'+dem.source_url+'"'));
    if(k.endsWith('/aspect')){
      assert(notes.includes('aspect_sin = sin(θ)')&&notes.includes('aspect_cos = cos(θ)'));
      assert(notes.includes('θ = A × π / 180'));
      assert(notes.includes('Direction convention needs review.'));
      assert(notes.includes('ordinary block mean'));
      assert(notes.includes('validity mask'));
    }else{
      assert(notes.includes('β_deg = atan(√(p² + q²)) × 180/π'));
      assert(notes.includes('not a full-circle feature'));
    }
  }
}
const escape=event('Escape');node('nxn-panel').events.keydown(escape);
assert(escape.stopped&&escape.prevented&&node('nxn-panel').hidden);assert.equal(scope.focused,'nxn-trigger');
node('nxn-trigger').events.click(event());node('info').style.visibility='hidden';observers.find(o=>o.target.id==='info').callback();
assert(node('nxn-panel').hidden&&node('nxn-logo').hidden);
console.log('PASS: '+payload.site+' · '+Object.keys(data.layers).length+' layers · original renderer/layout/data and approved controller intact; DEM sources/math and metadata/events checked with DOM stubs.');
