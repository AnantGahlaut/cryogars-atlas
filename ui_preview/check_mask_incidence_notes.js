/* Real notes-script branches; fixtures carry no scientific arrays. */
const assert=require('node:assert/strict');
const {render}=require('./check_five_product_notes.js');
const group='science/UAVSAR/19990101_19990102/LINE';
const mask=group+'/HH/coherence_mask',cor=group+'/VH/cor';
const radar={acquisition_dates:['2021-03-21','2021-03-09'],flight_line:'Recorded <line>',
  source_product_id:'Recorded <package>',source_url:'https://example.org/recorded.zip?a=1&b=2',
  peg_latitude_deg:40.1,peg_longitude_deg:-106.2,peg_heading_deg:262,platform_altitude_m:12000,
  radar_look_direction:'Left'};
const checks=[];
const check=(name,fn)=>checks.push([name,fn]);
const rows=result=>Object.fromEntries([...result.html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map(m=>[m[1],m[2]]));

check('mask dispatch selects the recorded product and displays its threshold',()=>{
  for(const selected of [mask,'opaque exported array']){
    const result=render(selected,{leaf:'coherence_mask',source:mask,attrs:{coherence_threshold:.42}});
    assert(!/recorded metadata only/i.test(result.text));
    assert.equal(rows(result)['Archive coherence threshold'],'0.42');
  }
  assert(!/recorded metadata only/i.test(render(mask).text));
  assert(/recorded metadata only/i.test(render(mask+'_extra',{label:'Coherence mask'}).text));
});

check('missing threshold remains unknown, including zero and malformed values',()=>{
  assert.equal(rows(render(mask,{attrs:{coherence_threshold:0}}))['Archive coherence threshold'],'0');
  for(const threshold of [undefined,null,'0.30',false,-.1,1.1]){
    assert.match(rows(render(mask,{attrs:{coherence_threshold:threshold}}))['Archive coherence threshold'],/not recorded/i);
  }
});

check('mask source context comes from exact derived_from and is escaped',()=>{
  const result=render(mask,{attrs:{coherence_threshold:.42,derived_from:cor},radar,
    coherence:{source:cor,attrs:{source_member:'exact <VH>.cor.grd',swath_mask_status:'applied'}}});
  const metadata=rows(result);
  assert.equal(metadata['Input coherence dataset'],cor);
  assert.equal(metadata['Coherence source member'],'exact &lt;VH&gt;.cor.grd');
  assert.equal(metadata['Radar acquisition dates'],'2021-03-21 → 2021-03-09');
  assert.equal(metadata['Flight line'],'Recorded &lt;line&gt;');
  assert(result.html.includes('href="https://example.org/recorded.zip?a=1&amp;b=2"'));
  const mismatched=render(mask,{attrs:{derived_from:cor},
    coherence:{source:group+'/HH/cor',attrs:{source_member:'wrong.cor.grd'}}});
  assert(!mismatched.text.includes('wrong.cor.grd'));
});

check('incidence dispatch exposes selected acquisition and annotation scalars',()=>{
  for(const leaf of ['local_incidence_angle','incidence_angle_flat']){
    const source=group+'/GEOMETRY/'+leaf;
    for(const selected of [source,'opaque exported array']){
      const result=render(selected,{leaf,source,radar});
      assert(!/recorded metadata only/i.test(result.text));
      const metadata=rows(result);
      assert.equal(metadata['Radar acquisition dates'],'2021-03-21 → 2021-03-09');
      assert.equal(metadata['Flight line'],'Recorded &lt;line&gt;');
      assert.equal(metadata['Annotated peg heading'],'262°');
      assert.equal(metadata['Annotated platform altitude'],'12000 m');
      assert.equal(metadata['Annotated look direction'],'Left');
      assert(result.html.includes('href="https://example.org/recorded.zip?a=1&amp;b=2"'));
    }
  }
});

check('only the recorded incidence method exposes its calculation and exact DEM lineage',()=>{
  const dem='science/LIDAR/DEM/exact/elevation';
  for(const [leaf,method] of [['local_incidence_angle','peg_track_geometry_with_lidar_normals'],
    ['incidence_angle_flat','peg_track_geometry']]){
    const key=group+'/GEOMETRY/'+leaf;
    const layer={source:key,leaf,attrs:{method,derived_from:dem}};
    const result=render(key,layer,{layers:{[key]:{label:leaf,cell:96,...layer},
      [dem]:{attrs:{source_filename:'Exact <terrain>.tif',source_url:'https://example.org/dem.tif'}}}});
    assert.equal(rows(result)['DEM source file'],'Exact &lt;terrain&gt;.tif');
    assert(result.html.includes('<pre class="nxn-equation">'));
    assert(!render(key,{attrs:{method:'unknown'}}).html.includes('<pre class="nxn-equation">'));
  }
});

let failed=0;
for(const [name,fn] of checks){try{fn();console.log('PASS: '+name);}catch(error){failed++;console.error('FAIL: '+name+'\n  '+error.message);}}
if(failed)process.exitCode=1;
else console.log('PASS: all '+checks.length+' mask/incidence notes branch checks.');

// Optional full-site check from the existing metadata-only evidence snapshot.
if(!failed&&process.argv[2]){
  const {execFileSync}=require('node:child_process'),path=require('node:path');
  const pages=JSON.parse(execFileSync('python',['-c',
    'import json,sys; from explorer_addon import compact_metadata; '
    +'print(json.dumps([compact_metadata(p["payload_without_pixel_buffers"]) for p in json.load(open(sys.argv[1], encoding="utf-8"))]))',
    path.resolve(process.argv[2])],{cwd:path.join(__dirname,'..'),encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024}));
  const counts={coherence_mask:0,incidence_angle_flat:0,local_incidence_angle:0};
  for(const data of pages)for(const [key,layer] of Object.entries(data.layers)){
    if(!(layer.leaf in counts))continue;
    const result=render(key,layer,data),metadata=rows(result);
    assert(!/recorded metadata only/i.test(result.text),key+' must have an active explanation');
    assert(layer.radar?.acquisition_dates?.length===2,key+' must retain its two recorded dates');
    assert(layer.radar.flight_line,key+' must retain its flight line');
    if(layer.leaf==='coherence_mask'){
      assert.equal(layer.coherence.source,layer.attrs.derived_from,key+' must resolve exact coherence lineage');
      assert.equal(metadata['Coherence source member'],layer.coherence.attrs.source_member);
      assert.equal(metadata['Archive coherence threshold'],String(layer.attrs.coherence_threshold));
    }else{
      assert(result.text.includes('No look-side restriction is recorded'),key+' must retain its historical look-side status');
      assert(result.text.includes('No heading conversion is recorded'),key+' must retain its historical heading status');
    }
    counts[layer.leaf]++;
  }
  console.log('PASS: saved metadata coverage across '+pages.length+' sites: '+JSON.stringify(counts));
}
