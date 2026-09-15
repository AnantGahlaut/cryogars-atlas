/* Offline acceptance checks for the five approved active product-note branches.
 * Runs the shipped notes script with tiny DOM stubs; no browser, HDF5 or writes.
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'logo_notes_addon.html'),'utf8');
const script=source.match(/<script id="nxn-script">([\s\S]*?)<\/script>/)[1];
function render(selected,layer={},extra={}){
  const data={site:'Test <site>',dem:'dem',grid:3,layers:{[selected]:{label:'Arbitrary product label',cell:24,attrs:{},...layer}},...extra};
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:id==='nxn-panel',textContent:'',innerHTML:'',style:{},events:{},
      appendChild(){},setAttribute(){},focus(){},addEventListener(e,f){this.events[e]=f;},
      getBoundingClientRect(){return {left:0,right:0,top:0,bottom:0};}});
    return nodes.get(id);
  };
  node('nxn-metadata').textContent=JSON.stringify(data);node('iPath').textContent=selected;
  vm.runInNewContext(script,{document:{getElementById:node},
    getComputedStyle:()=>({display:'block',visibility:'visible'}),MutationObserver:class{observe(){}}});
  node('nxn-trigger').events.click({stopPropagation(){}});
  const html=node('nxn-content').innerHTML;
  const text=(node('nxn-title').textContent+' '+html.replace(/<[^>]*>/g,' '))
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ');
  assert(!/<dd>\s*(?:undefined|NaN)\s*<\/dd>/.test(html),'metadata rows must not leak undefined or NaN');
  return {html,text};
}
const vh='science/LIDAR/2020-02-03/veg_height',fcf='science/LIDAR/DERIVED/forest_cover_fraction_2020-02-03';
const radar='science/UAVSAR/2020-02-03_2020-02-10/HH/';
const cases=[
  {key:vh,leaf:'veg_height',heading:'Vegetation height'},
  {key:fcf,leaf:'forest_cover_fraction_2020-02-03',heading:'Canopy fraction'},
  {key:radar+'cor',leaf:'cor',heading:'Coherence'},
  {key:radar+'int ∠phase',source:radar+'int',leaf:'int ∠phase',heading:'Wrapped phase'},
  {key:radar+'unw',leaf:'unw',heading:'Unwrapped phase'}
];
const fallback=/recorded metadata only/i;
const checkNotes=(result,heading)=>{
  assert(result.text.includes(heading),'missing product heading: '+heading);
  assert(!fallback.test(result.text),heading+' must have its own active explanation');
};
const checks=[];
const check=(name,fn)=>checks.push([name,fn]);

check('five products dispatch from compact leaf/source and legacy exact paths',()=>{
  for(const c of cases){
    checkNotes(render(c.key,{leaf:c.leaf,source:c.source||c.key}),c.heading);
    checkNotes(render(c.key),c.heading);
    checkNotes(render('opaque exported array',{leaf:c.leaf,source:c.source||c.key}),c.heading);
    if(c.leaf!=='int ∠phase')checkNotes(render('opaque exported array',{source:c.key}),c.heading);
  }
  checkNotes(render(vh,{leaf:'cor',source:radar+'cor'}),'Coherence');
  checkNotes(render(radar+'int ∠phase',{source:radar+'int'}),'Wrapped phase');
});

check('unrelated products and misleading labels retain metadata fallback',()=>{
  for(const key of ['science/other/vegetation_height_extra',
    'science/other/uncorrelated','science/other/unwrapped_phase_extra','science/unknown']){
    assert(fallback.test(render(key,{label:'Vegetation height / Canopy fraction / Coherence / Wrapped phase / Unwrapped phase'}).text),key);
  }
});

check('vegetation notes show recorded survey bounds and units without assuming unknown facts',()=>{
  const known=render(vh,{leaf:'veg_height',attrs:{acquisition_date:'2020-02-03 <start>',
    acquisition_date_end:'2020-02-05 <end>',units:'m <height>',source_filename:'Survey <vegetation>.tif'}});
  for(const expected of ['2020-02-03 &lt;start&gt;','2020-02-05 &lt;end&gt;','m &lt;height&gt;','Survey &lt;vegetation&gt;.tif'])assert(known.html.includes(expected),expected);
  assert(/height/i.test(known.text)&&/ground|terrain/i.test(known.text),'vegetation height must be explained relative to terrain');
  const unknown=render(vh).text;
  assert(/(?:survey|acquisition|date).{0,100}(?:not recorded|unknown|unavailable)|(?:not recorded|unknown|unavailable).{0,100}(?:survey|acquisition|date)/i.test(unknown),'missing survey must remain unknown');
});

const canopyAttrs={derived_from:vh,method:'finite_canopy_fraction_centered_box',canopy_height_threshold_m:2,
  window_m:30,window_cells:11,window_effective_m:33,units:'fraction, 0-1'};
const canopy=(attrs=canopyAttrs,extra={})=>render(fcf,{leaf:'forest_cover_fraction_2020-02-03',attrs},extra);
check('canopy uses recorded threshold and actual odd window, not nominal length',()=>{
  const text=canopy().text;
  assert(/2\s*m/.test(text),'recorded 2 m canopy threshold missing');
  assert(/33\s*(?:[×x]\s*33\s*)?m/.test(text),'11 cells at 3 m must disclose 33 m actual window');
  assert(/11/.test(text)&&/30\s*m/.test(text),'nominal and actual window must be distinguishable');
  assert(/finite/i.test(text)&&/denominator|valid.*count|count.*valid/i.test(text),'denominator excludes missing vegetation samples');
  assert(/edge|boundary/i.test(text),'truncated raster edges must be disclosed');
  assert(/missing cent(?:er|re)|cent(?:er|re).{0,80}(?:missing|invalid)/i.test(text),'missing center may receive a fraction');
  const alternate=canopy({...canopyAttrs,canopy_height_threshold_m:4.5,window_m:20,window_cells:5,window_effective_m:25},{grid:5}).text;
  assert(/4\.5\s*m/.test(alternate)&&/25\s*(?:[×x]\s*25\s*)?m/.test(alternate),'alternate threshold/grid/window metadata must control notes');
  assert(!/\b33\s*m/.test(alternate),'3 m / 33 m example must not be asserted for another grid');
});

check('canopy missing or invalid metadata cannot silently become 2 m / 33 m / zero',()=>{
  for(const value of [undefined,null,true,'unknown']){
    const attrs={derived_from:vh,canopy_height_threshold_m:value,window_m:value,window_cells:value,window_effective_m:value};
    const text=canopy(attrs).text;
    assert(/threshold.{0,100}(?:not recorded|unknown|unavailable)|(?:not recorded|unknown|unavailable).{0,100}threshold/i.test(text),'unknown canopy threshold must be explicit');
    assert(/window.{0,100}(?:not recorded|unknown|unavailable)|(?:not recorded|unknown|unavailable).{0,100}window/i.test(text),'unknown canopy window must be explicit');
    assert(!/\b33\s*m|(?:threshold|at least|≥)\s*(?:is\s*)?0\s*m/i.test(text),'missing values must not fabricate a window or zero cutoff');
  }
  const derivedWindow=canopy({...canopyAttrs,window_effective_m:undefined}).text;
  assert(/33\s*(?:[×x]\s*33\s*)?m/.test(derivedWindow),'recorded 11 cells and 3 m spacing establish 33 m');
  for(const invalidWidth of [0,-1]){
    const html=canopy({...canopyAttrs,window_effective_m:invalidWidth}).html;
    const widthRow=html.match(/<dt>Actual window width<\/dt><dd>(.*?)<\/dd>/)?.[1]||'';
    assert(/33\s*m/.test(widthRow),'invalid effective width falls back to recorded 11 cells × 3 m');
    assert(/from|derived|computed|calculat/i.test(widthRow)&&/cells|spacing|grid/i.test(widthRow),'fallback width must be identified as derived from cells and grid');
    assert(!/\(recorded\)/i.test(widthRow),'a derived width must not be relabelled as a directly recorded width');
  }
});

check('canopy source survey follows derived_from and cleaned lineage needs both recorded fields',()=>{
  const input={label:'Vegetation <source>',leaf:'veg_height',cell:24,attrs:{acquisition_date:'2014-08-01 <start>',
    acquisition_date_end:'2014-08-03 <end>',source_filename:'Input <survey>.tif',source_url:'https://example.org/vh.tif?a=1&b=2'}};
  const withInput=attrs=>canopy(attrs,{layers:{[vh]:input,[fcf]:{label:'FCF',leaf:'forest_cover_fraction_2020-02-03',cell:24,attrs}}});
  const legacy=withInput(canopyAttrs);
  for(const s of ['2014-08-01 &lt;start&gt;','2014-08-03 &lt;end&gt;','Input &lt;survey&gt;.tif'])assert(legacy.html.includes(s),s);
  assert(/(?:input|processing|stage).{0,130}(?:not established|not recorded|unrecorded|unknown|unverified)/i.test(legacy.text),'shared path alone does not establish cleaned input');
  const cleaned=withInput({...canopyAttrs,derived_from_stage:'enriched_base_after_cleaning',derived_from_archive:'self'}).text;
  assert(/recorded input.{0,80}cleaned|cleaned.{0,80}(?:same|this).{0,40}archive/i.test(cleaned),'confirmed cleaned input must be stated');
  const other=withInput({...canopyAttrs,derived_from_stage:'enriched_base_after_cleaning',derived_from_archive:'other-file'}).text;
  assert(!/recorded input.{0,60}cleaned/i.test(other),'cleaned stage in another archive must not imply this archive’s shown input');
});

check('coherence explains imported 0–1 correspondence',()=>{
  const text=render(radar+'cor',{leaf:'cor',attrs:{units:'dimensionless'}}).text;
  assert(/0\s*(?:[–−-]|to)\s*1/.test(text),'coherence range missing');
  assert(/import|upstream|supplied/i.test(text),'coherence is imported');
  assert(/correspondence|correlation|similarity/i.test(text),'coherence meaning missing');
});

check('wrapped phase explains complex averaging before angle and cancellation at the radians wrap',()=>{
  const text=render(radar+'int ∠phase',{leaf:'int ∠phase',source:radar+'int',unit:'rad'}).text;
  assert(/complex.{0,90}(?:mean|averag)|(?:mean|averag).{0,90}complex/i.test(text),'display must average complex samples');
  assert(/then.{0,70}(?:angle|atan2|phase)|angle.{0,90}(?:mean|averag)|atan2/i.test(text),'angle follows complex averaging');
  assert(/radians?/i.test(text)&&/π/.test(text),'radian branch boundary missing');
  assert(/cancel|zero resultant|zero complex|complex.{0,30}zero/i.test(text),'complex cancellation qualification missing');
  assert(/undefined|no.{0,40}(?:phase|direction)|meaningless|not.{0,40}(?:phase|direction)/i.test(text),'zero vector must not imply a meaningful phase');
});

check('unwrapped phase is imported and zero removal is only confirmed by layer metadata',()=>{
  const legacy=render(radar+'unw',{leaf:'unw',unit:'rad'}).text;
  assert(/import|upstream|supplied/i.test(legacy),'unwrapped phase is imported');
  assert(/(?:does not|not|no).{0,65}unwrap|unwrap.{0,65}(?:upstream|before import)/i.test(legacy),'local unwrapping must not be implied');
  assert(/historical|earlier|legacy/i.test(legacy)&&/zero/i.test(legacy),'historical zero rule should be disclosed');
  assert(/not recorded|unrecorded|unverified|not established|does not establish/i.test(legacy),'historical rule is unverified for this layer');
  const applied=render(radar+'unw',{leaf:'unw',attrs:{unw_zero_mask_status:'applied',unw_zero_fill_masked:7,
    unw_zero_note:'Finite exact-zero values converted to missing; true zero phase may also be removed.'}}).text;
  assert(/7/.test(applied)&&/zero/i.test(applied),'recorded zero-removal count missing');
  assert(/true zero|valid zero|physical zero/i.test(applied),'zero heuristic can remove true zeros');
  const skipped=render(radar+'unw',{leaf:'unw',attrs:{unw_zero_mask_status:'skipped_swath_mask_unavailable'}}).text;
  assert(/skipped|not applied|not run/i.test(skipped),'recorded skipped rule must not be described as applied');
});

check('arbitrary metadata is escaped and source links reject executable or broken URLs',()=>{
  for(const c of cases){
    const result=render(c.key,{leaf:c.leaf,source:c.source||c.key,label:'<img src=x onerror="bad">',attrs:{source_filename:'<img src=x onerror="bad">',
      source_note:'<script>alert("bad")</script>',source_url:'https://example.org/file?a=1&b=2'}});
    assert(!/<(?:img|script)\b/i.test(result.html),'metadata must not inject HTML');
    assert(result.html.includes('&lt;img src=x onerror=&quot;bad&quot;&gt;'),'arbitrary source filenames must remain visible and escaped');
    assert(result.html.includes('&lt;script&gt;'),'arbitrary source notes must be escaped');
    for(const url of ['javascript:alert(1)','data:text/html,bad','https://x.org/" onclick="bad','//x.org/file']){
      const unsafe=render(c.key,{leaf:c.leaf,source:c.source||c.key,attrs:{source_url:url}}).html;
      assert(!/href="(?:javascript:|data:|\/\/)/i.test(unsafe),'unsupported URL must not be linked');
      assert(!/" onclick="/.test(unsafe),'URL must not inject attributes');
    }
  }
  const safe=render(vh,{leaf:'veg_height',attrs:{source_url:'https://example.org/file?a=1&b=2'}}).html;
  assert(safe.includes('href="https://example.org/file?a=1&amp;b=2"'),'valid vegetation source URL should be escaped and usable');
});

let failed=0;
for(const [name,fn] of checks){try{fn();console.log('PASS: '+name);}catch(error){failed++;console.error('FAIL: '+name+'\n  '+error.message);}}
if(failed)process.exitCode=1;
else console.log('PASS: all '+checks.length+' five-product notes acceptance checks.');
module.exports={render};
