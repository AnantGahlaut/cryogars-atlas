/* Offline acceptance checks for the four newly approved product-note branches.
 * Reuses the shipped-script render harness and its five-product regression checks.
 * No browser, scientific payload reads, renderer changes or package writes.
 */
const assert=require('node:assert/strict');
const {render}=require('./check_five_product_notes.js');
const radarPath='science/UAVSAR/19990101_19990102/TESTLINE/HH/';
const snowPath='science/LIDAR/SD/19990101/snow_depth';
const cases=[
  {key:radarPath+'amp1',leaf:'amp1',heading:'Amplitude 1'},
  {key:radarPath+'amp2',leaf:'amp2',heading:'Amplitude 2'},
  {key:radarPath+'int |magnitude|',leaf:'int |magnitude|',source:radarPath+'int',heading:'Interferogram magnitude'},
  {key:snowPath,leaf:'snow_depth',heading:'Snow depth'}
];
const fallback=/recorded metadata only/i;
const checks=[];
const check=(name,fn)=>checks.push([name,fn]);
const active=(result,heading)=>{
  assert(result.html.includes('<h3>'+heading+'</h3>'),'missing active heading: '+heading);
  assert(!fallback.test(result.text),heading+' must have its approved explanation');
};
const ampUrl='https://example.org/AMPLITUDE_GRD/amp.zip?a=1&b=2';
const intUrl='https://example.org/INTERFEROMETRY_GRD/int.zip?a=1&b=2';
const radar={acquisition_dates:['2021-03-21','2021-03-09'],flight_line:'Recorded <flight>',
  source_product_id:'Recorded <amplitude>',source_url:ampUrl};
const amplitude=(leaf='amp1',extra={})=>render(radarPath+leaf,{leaf,pol:'HV',radar,
  attrs:{source_dataset:'ASF UAVSAR AMPLITUDE_GRD'},...extra});
const magnitude=(extra={})=>render(radarPath+'int |magnitude|',{leaf:'int |magnitude|',source:radarPath+'int',pol:'VH',
  radar:{...radar,source_product_id:'Recorded <interferometry>',source_url:intUrl},
  attrs:{source_dataset:'ASF UAVSAR INTERFEROMETRY_GRD'},...extra});
const snow=(attrs={},extra={})=>render(snowPath,{leaf:'snow_depth',unit:'m',attrs,...extra});
const qsi={source_dataset:'SNEX20_QSI_SD_3m',source_filename:'SNEX20_QSI_SD_3M_USIDBS_20200218_20200219.tif'};
const aso={source_dataset:'ASO_3M_SD',source_filename:'ASO_3M_SD_USCOGM_20170208.tif'};
const gm={source_dataset:'SNEX20_GM_Lidar',source_filename:'SNEX20_GM_Lidar_SD_20200201_20200202_v01.0.tif',
  acquisition_date:'2020-02-01',acquisition_date_end:'2020-02-01',source_native_resolution_m:3};

check('four branches dispatch from exact compact leaves, source paths and legacy keys',()=>{
  for(const c of cases){
    active(render(c.key,{leaf:c.leaf,source:c.source||c.key}),c.heading);
    active(render(c.key),c.heading);
    active(render('opaque exported array',{leaf:c.leaf,source:c.source||c.key}),c.heading);
    if(c.leaf!=='int |magnitude|')active(render('opaque exported array',{source:c.key}),c.heading);
  }
  active(render(radarPath+'int |magnitude|',{source:radarPath+'int'}),'Interferogram magnitude');
  active(render(snowPath,{leaf:'amp2',source:radarPath+'amp2'}),'Amplitude 2');
});

check('bare complex source and lookalike labels retain fallback',()=>{
  for(const key of [radarPath+'int',radarPath+'amp12',radarPath+'amp2_extra',
    'science/LIDAR/SD/20200201/snow_depth_extra','science/other/magnitude','science/unknown']){
    assert(fallback.test(render(key,{label:'Amplitude 1 / Amplitude 2 / Interferogram magnitude / Snow depth'}).text),key);
  }
});

check('amplitude pass roles use actual recorded dates without sorting or label inference',()=>{
  for(const [leaf,pass,date] of [['amp1',1,'2021-03-21'],['amp2',2,'2021-03-09']]){
    const result=amplitude(leaf,{label:'Pass '+(3-pass)+' on 1999-01-01',date:'19990101_19990102'});
    const dateRow=[...result.html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)]
      .find(([,label])=>/pass/i.test(label)&&/date/i.test(label));
    assert(dateRow,'selected pass date must be identified in its metadata row');
    assert(dateRow[1].includes(String(pass))||result.text.includes('pass '+pass),'recorded pass role missing');
    assert(dateRow[2].includes(date),'selected date must follow pass role, not sort order or misleading name');
    assert(!dateRow[2].includes('1999'),'label/path dates must not override recorded dates');
    assert(result.text.includes('HV'),'recorded polarisation missing');
  }
  for(const dates of [undefined,null,[],['2021-03-21']]){
    const text=amplitude('amp2',{radar:{...radar,acquisition_dates:dates},date:'19990101_19990102'}).text;
    assert(/pass.{0,100}(?:not recorded|unknown|unavailable)|(?:not recorded|unknown|unavailable).{0,100}pass/i.test(text),
      'missing second-pass date must remain unknown');
  }
});

check('radar branches link the selected source family and keep safe URL escaping',()=>{
  for(const [result,url,wrong] of [[amplitude('amp1'),ampUrl,intUrl],[amplitude('amp2'),ampUrl,intUrl],
    [magnitude(),intUrl,ampUrl]]){
    assert(result.html.includes('href="'+url.replace('&','&amp;')+'"'),'selected radar source link missing');
    assert(!result.html.includes('href="'+wrong.replace('&','&amp;')+'"'),'wrong source family linked');
  }
  assert(amplitude().html.includes('Recorded &lt;amplitude&gt;'),'amplitude identity must be escaped');
  assert(magnitude().html.includes('Recorded &lt;interferometry&gt;'),'interferometry identity must be escaped');
});

check('a missing selected date remains explicit when its companion pass is recorded',()=>{
  for(const [leaf,dates] of [['amp1',[null,'2021-03-09']],['amp2',['2021-03-21',null]],
    ['amp2',['2021-03-21','']],['amp2',['2021-03-21','   ']]]){
    const html=amplitude(leaf,{radar:{...radar,acquisition_dates:dates}}).html;
    const dateRow=[...html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)]
      .find(([,label])=>/pass/i.test(label)&&/date/i.test(label));
    assert(dateRow,'missing selected date must not silently remove its row');
    assert(/not recorded|unknown|unavailable/i.test(dateRow[2]),'absent selected date must be explicitly unknown');
  }
});

check('amplitude explains linear imported samples and independent comparison scales',()=>{
  for(const leaf of ['amp1','amp2']){
    const text=amplitude(leaf).text;
    assert(/linear amplitude/i.test(text),'linear amplitude units missing');
    assert(/(?:no|not|without|does not).{0,80}(?:dB|decibel)|(?:dB|decibel).{0,80}(?:not|no)/i.test(text),'no dB conversion must be explicit');
    assert(/import|provider supplies/i.test(text),'upstream amplitude must be distinguished from local processing');
    assert(/averag|nanmean|arithmetic mean|mean of non-NaN/i.test(text),'display average of amplitude values missing');
    assert(/independent.{0,70}(?:stretch|scale)|(?:stretch|scale).{0,70}independent/i.test(text),'independent stretches must be disclosed');
    assert(/(?:equal|same).{0,50}brightness.{0,100}(?:not|need not)|brightness.{0,100}(?:different|unequal)/i.test(text),'equal brightness does not establish equal values');
  }
  assert(/(?:separate|second).{0,80}observation/i.test(amplitude('amp2').text),'pass 2 is a separate observation');
});

check('magnitude explains mean of absolute values rather than absolute complex mean',()=>{
  const text=magnitude().text;
  assert(/mean\s*\(\s*(?:abs\(I\)|\|I\|)|mean of.{0,35}(?:pixel )?magnitudes|averag.{0,60}(?:absolute values|pixel magnitudes)/i.test(text),'mean(abs(I)) must be explained');
  assert(/not.{0,70}magnitude of.{0,30}(?:the )?complex mean|not.{0,50}abs\(mean\(I\)\)/i.test(text),'abs(mean(I)) must be excluded');
  assert(/cross.product/i.test(text)&&/strength/i.test(text),'magnitude meaning missing');
  assert(/(?:annotation|provider).{0,130}linear power|linear power.{0,130}(?:annotation|provider)/i.test(text),'linear power must be attributed to source annotations');
});

check('radar percentile clipping is irreversible display compression',()=>{
  for(const result of [amplitude('amp1'),amplitude('amp2'),magnitude()]){
    const text=result.text;
    assert(/2(?:nd)?/.test(text)&&/98(?:th)?/.test(text)&&/percentile/i.test(text),'2nd/98th percentile limits missing');
    assert(/(?:tie|coincid|equal).{0,120}(?:min|max)|(?:min|max).{0,120}(?:tie|coincid|equal)/i.test(text),'equal percentile limits need min/max fallback');
    assert(/clip/i.test(text)&&/cannot recover|irreversible|lost|cannot restore/i.test(text),'palette changes cannot recover clipped extremes');
    assert(!/\b96\s*%\s*(?:measurement\s*)?confidence/i.test(text),'percentile range is not confidence');
  }
});

check('snow depth shows survey bounds and separates colour, missing values and terrain height',()=>{
  const result=snow({...qsi,acquisition_date:'2020-02-18 <start>',acquisition_date_end:'2020-02-19 <end>',
    source_url:'https://example.org/snow.tif?a=1&b=2'});
  for(const value of ['2020-02-18 &lt;start&gt;','2020-02-19 &lt;end&gt;',qsi.source_filename])assert(result.html.includes(value),value);
  assert(result.html.includes('href="https://example.org/snow.tif?a=1&amp;b=2"'),'snow source link missing');
  const text=result.text;
  assert(result.html.includes('<dt>Display units</dt><dd>m</dd>'),'recorded snow depth units missing');
  assert(/(?:not|does not).{0,90}(?:rais|elevat)|(?:surface|terrain).{0,90}(?:not raised|unchanged)/i.test(text),'colour must not imply terrain is raised by depth');
  assert(/finite zero.{0,80}retained estimate/i.test(text)&&/missing cells.{0,80}no retained estimate/i.test(text),'finite zero and missing must be distinguished');
  assert(/(?:clip|negative)/i.test(text)&&/zero/i.test(text),'negative clipping can create zero');
  assert(/lidar/i.test(text)&&/provider/i.test(text)&&/align|import/i.test(text),'LiDAR provider and local processing missing');
  assert(/survey.{0,100}(?:not recorded|unknown)|(?:not recorded|unknown).{0,100}survey/i.test(snow().text),'unknown survey interval must remain unknown');
});

check('QSI and ASO source identities select gridded provider methods',()=>{
  const qsiText=snow(qsi).text,asoText=snow(aso).text;
  for(const text of [qsiText,asoText]){
    assert(/snow.covered|snow.on/i.test(text),'snow-on provider surface missing');
    assert(/snow.free|snow.off/i.test(text),'snow-free provider reference missing');
    assert(/subtract|differenc/i.test(text),'provider gridded differencing missing');
    assert(!/M3C2/.test(text),'gridded products must not acquire the M3C2 method');
  }
  assert(/0\.5\s*m/.test(qsiText)&&/nearest/i.test(qsiText)&&/bilinear/i.test(qsiText),'QSI provider resampling and local alignment must be separate');
  assert(/(?:error.{0,90}(?:not assessed|unassessed)|(?:not assessed|has not assessed).{0,90}error)/i.test(qsiText),'QSI 3 m error assessment gap missing');
  assert(/reference.{0,100}(?:not established|not recorded|unknown)|(?:not established|not recorded|unknown).{0,100}reference/i.test(asoText),'ASO exact snow-free reference must remain unknown');
});

check('unknown or inconsistent snow provider metadata cannot borrow a method',()=>{
  for(const attrs of [{},{source_dataset:'QSI',source_filename:qsi.source_filename},
    {...qsi,source_dataset:'ASO_3M_SD'},{...aso,source_filename:qsi.source_filename},
    {source_dataset:gm.source_dataset,source_filename:'other.tif'},
    {source_dataset:'other',source_filename:gm.source_filename}]){
    const text=snow(attrs,{label:'QSI / ASO / M3C2 snow depth'}).text;
    assert(/provider.{0,130}(?:not established|not recorded|unknown|unverified)|(?:not established|not recorded|unknown|unverified).{0,130}provider/i.test(text),
      'exact collection and file must establish the provider method');
    assert(!/<h3>[^<]*M3C2|documented M3C2|uses M3C2/i.test(snow(attrs).html),'unknown source must not inherit M3C2 method');
  }
});

check('Grand Mesa exact file discloses M3C2 spacing and end-date conflicts',()=>{
  const text=snow(gm).text;
  assert(/M3C2/.test(text)&&/point.cloud/i.test(text)&&/normal/i.test(text),'GM local-normal point-cloud method missing');
  assert(/provider.{0,100}1\s*m|1\s*m.{0,100}provider/i.test(text),'documented provider 1 m spacing missing');
  assert(/(?:stored|archive|metadata).{0,100}3\s*m|3\s*m.{0,100}(?:stored|archive|metadata)/i.test(text),'stored 3 m native spacing conflict missing');
  assert(/conflict|disagree|discrepanc|mismatch/i.test(text),'GM inconsistency must be explicit');
  assert(/2020-02-02|2 February|February 2|1[–-]2 February/i.test(text),'filename February 2 end must be disclosed');
  assert(/2020-02-01|1 February|February 1/.test(text),'recorded February 1 end must be retained');
  for(const attrs of [{...gm,source_dataset:'ASO_3M_SD'},{...gm,source_filename:'other.tif'}]){
    const other=snow(attrs).text;
    assert(!/M3C2/.test(other),'exact GM warning must not apply to a different collection or file');
    assert(!/provider.{0,100}1\s*m/i.test(other),'exact GM provider spacing must not leak to other files');
  }
});

check('withdrawn ASO Grand Mesa quality flags are limited to the five documented files',()=>{
  for(const date of ['20170208','20170216','20170220','20170221','20170225']){
    const text=snow({...aso,source_filename:'ASO_3M_SD_USCOGM_'+date+'.tif'}).text;
    assert(/quality.flag/i.test(text)&&/removed|withdrawn|incorrect.*geolocat/i.test(text),'documented ASO quality-flag withdrawal missing: '+date);
  }
  for(const attrs of [qsi,gm,{...aso,source_filename:'ASO_3M_SD_USCOGM_20170301.tif'},
    {...aso,source_filename:'ASO_3M_SD_USCOTR_20170208.tif'},{...aso,source_dataset:'other'}]){
    assert(!/quality.flag.{0,150}(?:removed|withdrawn)|(?:removed|withdrawn).{0,150}quality.flag/i.test(snow(attrs).text),
      'withdrawal must not generalize to other dates/sites/collections');
  }
});

check('processing records follow supplied metadata without fabricating historical counts',()=>{
  for(const c of cases){
    const unknown=render(c.key,{leaf:c.leaf,source:c.source||c.key,attrs:{}}).html;
    assert(!unknown.includes('<dt>Recorded swath-mask status</dt>'),'unknown swath status must remain absent');
    assert(!unknown.includes('<dt>Recorded import resampling</dt>'),'unknown resampling must remain absent');
    const known=render(c.key,{leaf:c.leaf,source:c.source||c.key,attrs:{
      resampling_method:'nearest',swath_mask_status:'skipped_fixture',negatives_clipped_to_zero:17}}).html;
    if(c.leaf==='snow_depth'){
      assert(known.includes('<dt>Recorded negative-to-zero events</dt><dd>17</dd>'));
      assert(unknown.includes('<dt>Recorded negative-to-zero events</dt><dd>Not recorded</dd>'));
    }else{
      assert(known.includes('<dt>Recorded swath-mask status</dt><dd>skipped_fixture</dd>'));
      assert(known.includes('<dt>Recorded import resampling</dt><dd>nearest</dd>'));
    }
  }
});

check('four branches escape arbitrary metadata and reject unsafe source links',()=>{
  for(const c of cases){
    const attrs={source_filename:'<img src=x onerror="bad">',source_note:'<script>bad</script>',source_url:'https://example.org/safe?a=1&b=2'};
    const result=render(c.key,{leaf:c.leaf,source:c.source||c.key,label:'<img src=x onerror="bad">',attrs,
      radar:{...radar,source_product_id:'<img src=x onerror="bad">',source_url:attrs.source_url}});
    assert(!/<(?:img|script)\b/i.test(result.html),'metadata must not inject HTML');
    assert(result.html.includes('&lt;img src=x onerror=&quot;bad&quot;&gt;'),'escaped file identity must remain visible');
    assert(result.html.includes('&lt;script&gt;bad&lt;/script&gt;'),'source note must be escaped');
    for(const url of ['javascript:alert(1)','data:text/html,bad','https://x.org/" onclick="bad','//x.org/file']){
      const html=render(c.key,{leaf:c.leaf,source:c.source||c.key,attrs:{source_url:url},radar:{source_url:url}}).html;
      assert(!/href="(?:javascript:|data:|\/\/)/i.test(html),'unsupported URL must not be linked');
      assert(!/" onclick="/.test(html),'source URL must not inject attributes');
      assert(!html.includes('href="'+url.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"'),'broken URL must not become a link');
    }
  }
});

let failed=0;
for(const [name,fn] of checks){try{fn();console.log('PASS: '+name);}catch(error){failed++;console.error('FAIL: '+name+'\n  '+error.message);}}
if(failed)process.exitCode=1;
else console.log('PASS: all '+checks.length+' four-product notes acceptance checks.');
