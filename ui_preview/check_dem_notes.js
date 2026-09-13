/* Small, offline content checks. Does not open a browser or read scientific data. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'logo_notes_addon.html'),'utf8');
const script=source.match(/<script id="nxn-script">([\s\S]*?)<\/script>/)[1];
function render(attrs={},extra={},selected='dem'){
  const data={site:'Test <site>',dem:'dem',grid:3,layers:{dem:{label:'Elevation',cell:24,attrs}},...extra};
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:id==='nxn-panel',textContent:'',innerHTML:'',style:{},events:{},
      appendChild(){},setAttribute(){},focus(){},addEventListener(e,f){this.events[e]=f;},
      getBoundingClientRect(){return {left:0,right:0,top:0,bottom:0};}});
    return nodes.get(id);
  };
  node('nxn-metadata').textContent=JSON.stringify(data);node('iPath').textContent=selected;
  vm.runInNewContext(script,{document:{getElementById:node},
    getComputedStyle:()=>({display:'block',visibility:'visible'}),
    MutationObserver:class{observe(){}}});
  node('nxn-trigger').events.click({stopPropagation(){}});
  return node('nxn-content').innerHTML;
}
const attrs={source_url:'https://example.org/file.tif?a=1&b=2',source_filename:'<file>.tif',
  source_native_resolution_m:3,resampling_method:'bilinear'};
const content=render(attrs);
assert(content.includes('href="https://example.org/file.tif?a=1&amp;b=2"'));
assert(content.includes('Test &lt;site&gt;'));
assert(content.includes('&lt;file&gt;.tif'));
assert(content.includes('Already 3 m at the source.'));
assert(!content.includes('undefined')&&!content.includes('NaN'));
for(const url of ['javascript:alert(1)','data:text/html,bad','https://x.org/" onclick="bad','//x.org/file']){
  assert(render({...attrs,source_url:url}).includes('No direct source URL is recorded'));
  assert(!render({...attrs,source_url:url}).includes('href="'+url+'"'));
}
assert(!render({resampling_method:'nearest'}).includes('z′ = Σ'));
assert(render({}).includes('native spacing is not recorded'));
assert(!render({}, {origin:null,shape:null}).includes('undefined'));
const one=render({...attrs,source_native_resolution_m:1});
assert(one.includes('1 m source DEM'));
assert(one.includes('For a 3 m source aligned to the same 3 m pixel centres'));
assert(one.includes('[1, 2, 3, 2, 1] / 9'));
const gm={...attrs,source_dataset:'SNEX_HRSI_SD_DEM_CO',
  source_filename:'SNEX_HRSI_SD_DEM_CO_GM_DTM_1m_V01.0.tif',source_native_resolution_m:1};
const oldNote='HRSI satellite photogrammetry DTM, not lidar. Resampled 1 m -> 3 m.';
assert(render({...gm,source_note:oldNote}).includes('Archived note (conflicts with provider'));
const corrected=render({...gm,source_note:'LiDAR-derived snow-off reference DTM from the HRSI collection.',
  source_note_previous:oldNote,source_note_correction:'Viewer correction <2026-09-12>; archive repair pending.'});
assert(!corrected.includes('Archived note (conflicts with provider'));
assert(!corrected.includes('the archived note calls this DTM'));
assert(corrected.includes('Previous source note')&&corrected.includes(oldNote.replace('>','&gt;')));
assert(corrected.includes('Viewer correction &lt;2026-09-12&gt;; archive repair pending.'));
const other=render({}, {dem:'another-dem'});
assert(other.includes('recorded metadata only'));
assert(!other.includes('One 3 m reference grid')&&!other.includes('z′ = Σ'));
for(const kind of ['slope','aspect']){
  const key='science/LIDAR/DERIVED/'+kind,demPath='science/LIDAR/DEM/grids/elevation';
  const derived={method:'horn_1981_3x3',derived_from:demPath,units:'degrees'};
  const layers={
    [key]:{label:kind,attrs:derived,cell:24},
    [demPath]:{label:'Elevation',cell:24,attrs:{...attrs,source_filename:'Site <DEM>.tif'}}
  };
  const notes=render({}, {layers,dem:demPath},key);
  assert(notes.includes('Site &lt;DEM&gt;.tif'));
  assert(notes.includes('Horn’s 3 × 3 neighbourhood'));
  assert(notes.includes('p = [(c + 2f + i) − (a + 2d + g)] / (8s)'));
  assert(notes.includes('q = [(a + 2b + c) − (g + 2h + i)] / (8s)'));
  assert(notes.includes('NaN in any of the eight neighbours'));
  assert(notes.includes('input processing stage is not established'));
  assert(!notes.includes('Recorded input: the cleaned DEM'));
  layers[key].attrs={...derived,derived_from_stage:'enriched_base_after_cleaning',derived_from_archive:'self',derivation_version:'1.0'};
  const stagedNotes=render({}, {layers,dem:demPath},key);
  assert(stagedNotes.includes('Recorded input: the cleaned DEM stored in the same enriched archive'));
  assert(!stagedNotes.includes('input processing stage is not established'));
  layers[key].attrs={...derived,derived_from_stage:'enriched_base_after_cleaning',derived_from_archive:'different-file'};
  assert(!render({}, {layers,dem:demPath},key).includes('Recorded input: the cleaned DEM'));
  layers[key].attrs=derived;
  if(kind==='aspect'){
    assert(notes.includes('aspect_sin = sin(θ)')&&notes.includes('aspect_cos = cos(θ)'));
    assert(notes.includes('Radians alone still jump'));
    assert(notes.includes('Direction convention needs review.'));
    assert(notes.includes('not a pixel-by-pixel audit'));
    assert(notes.includes('validity mask')&&notes.includes('ordinary block mean'));
    layers[key].aggregation={method:'circular_mean_degrees',resultant_tolerance:1e-12};
    const correctedNotes=render({}, {layers,dem:demPath},key);
    assert(correctedNotes.includes('circular mean')&&correctedNotes.includes('equal weight'));
    assert(correctedNotes.includes('1e-12')&&correctedNotes.includes('missing'));
    assert(!correctedNotes.includes('ordinary block mean'));
    assert(correctedNotes.includes('Direction convention needs review.'));
  }else{
    assert(notes.includes('β_deg = atan(√(p² + q²)) × 180/π'));
    assert(notes.includes('percent slope = 100 tan(β_rad)'));
    assert(!notes.includes('aspect_sin = sin(θ)'));
  }
  layers[key].attrs.method='unknown';
  assert(render({}, {layers,dem:demPath},key).includes('recorded metadata only'));
}
const incidenceKey='science/UAVSAR/fixture/GEOMETRY/local_incidence_angle';
function incidenceContent(a){
  return render({}, {layers:{[incidenceKey]:{label:'Local incidence angle',cell:24,attrs:a}}},incidenceKey);
}
const incidenceAttrs={incidence_ge_90_status:'computed',incidence_ge_90_fraction:2/3,
  incidence_ge_90_cell_count:2,incidence_valid_cell_count:3};
const incidence=incidenceContent(incidenceAttrs);
assert(incidence.includes('Incidence ≥ 90°')&&incidence.includes('66.67%'));
assert(incidence.includes('Share of finite incidence cells')&&incidence.includes('not a radar-shadow measurement'));
assert(incidence.includes('outside the radar swath'));
assert(!incidence.includes('Legacy share'));
assert(incidenceContent({...incidenceAttrs,incidence_ge_90_fraction:0}).includes('0.00%'));
const noIncidence=incidenceContent({incidence_ge_90_status:'no_valid_incidence',incidence_ge_90_fraction:'nan',radar_shadow_fraction:.5});
assert(noIncidence.includes('Unavailable: no finite incidence cells'));
assert(!noIncidence.includes('50.00%')&&!noIncidence.includes('0.00%'));
for(const value of [null,undefined,'nan',true]){
  const unavailable=incidenceContent({...incidenceAttrs,incidence_ge_90_fraction:value,radar_shadow_fraction:.5});
  assert(unavailable.includes('percentage is unavailable'));
  assert(!unavailable.includes('50.00%')&&!unavailable.includes('0.00%'));
}
const legacyIncidence=incidenceContent({radar_shadow_fraction:.25});
assert(legacyIncidence.includes('Legacy share of whole grid')&&legacyIncidence.includes('25.00%'));
assert(legacyIncidence.includes('historical denominator includes missing cells'));
assert(!legacyIncidence.includes('Share of finite incidence cells'));
assert(incidenceContent({}).includes('No incidence-threshold percentage is recorded'));
console.log('PASS: DEM/terrain notes and lineage; incidence finite-cell, legacy, missing and zero cases.');
