/* Compatibility checks for the inactive legacy product_guide.js helper.
 * Metadata fixtures come from existing exports. This is not an active-template
 * test or validation of current scientific calculations; use check_workspace,
 * check_dem_notes and the scientific/renderer suites for those contracts.
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),dir=path.resolve(process.argv[2]||path.join(root,'viewer'));
const scope=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,'product_guide.js'),'utf8'),scope);
const counts={},siteContexts=new Set();let total=0;
for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('_explorer.html'))){
  const html=fs.readFileSync(path.join(dir,file),'utf8');
  const P=JSON.parse(html.match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  scope.P=P;
  for(const [key,L] of Object.entries(P.arrays)){
    scope.key=key;const g=vm.runInContext('productGuide(P,key)',scope);total++;
    assert.equal(g.site,P.identification.site_name||P.site);
    assert(g.summary&&g.meaning.length&&g.method.length&&g.cautions.length);
    assert(g.calculation&&g.calculation.equations.length&&g.calculation.variables.length&&g.calculation.source);
    assert(g.displayMath.some(s=>s.includes('Q = 0')));
    assert(g.displayMath.some(s=>s.includes('clipped extremes cannot be recovered')));
    assert(g.calculation.variables.every(([k,v])=>typeof k==='string'&&typeof v==='string'));
    assert(g.context.some(([k,v])=>k==='Layer'&&v===key));
    assert(g.context.some(([k,v])=>k==='Common archive grid'&&v.includes(`${P.grid.res_m} m`)));
    assert(g.context.every(([k,v])=>typeof k==='string'&&typeof v==='string'));
    assert(g.references.every(r=>r.url.startsWith('https://')));
    counts[g.kind]=(counts[g.kind]||0)+1;
    const attrs=P.tree.find(n=>n.path===(L.source||key))?.attrs||{};
    if(g.kind==='coherence_mask'){
      assert(g.meaning.join(' ').includes(`≥ ${attrs.coherence_threshold}`));
      assert(g.context.some(([k])=>k==='Radar date pair'));
      assert(g.calculation.variables.some(([k,v])=>k==='τ'&&v.includes(String(attrs.coherence_threshold))));
    }
    if(g.kind==='forest_cover_fraction'){
      assert(g.context.some(([k,v])=>k==='Derived from'&&v===attrs.derived_from));
      assert(g.context.some(([k,v])=>k==='Nominal window'&&v===`${attrs.window_m} m`));
      assert(g.cautions.some(c=>c.includes('33 m')));
      assert(g.calculation.variables.some(([k,v])=>k==='hc'&&v.includes(String(attrs.canopy_height_threshold_m))));
    }
    if(g.kind==='local_incidence_angle'){
      assert(g.context.some(([k])=>k==='Track heading'));
      const restricted=['projected_peg_track_half_plane_v1','projected_peg_track_half_plane_v2'].includes(attrs.look_side_mask_method);
      assert(g.cautions.some(c=>c.includes(restricted?'retain the declared look side':'No look-side restriction is recorded')));
    }
    if(g.kind==='cor')assert(g.calculation.label.includes('upstream'));
    if(g.kind==='slope'){
      const sourceNote=g.context.find(([k])=>k==='Terrain note')?.[1]||'';
      siteContexts.add(JSON.stringify(g.context.filter(([k])=>k.startsWith('Terrain'))));
      const recorded=P.tree.find(n=>n.path===P.dem_path)?.attrs.source_note||'';
      assert.equal(sourceNote,recorded,'legacy helper must preserve the supplied DEM provenance');
      if(P.site==='grand_mesa')assert(/LiDAR-derived snow-off reference DTM/i.test(sourceNote),
        'Grand Mesa uses the provider-corrected LiDAR DTM provenance');
    }
  }
}
assert(siteContexts.size>1,'Site provenance must not be a generic shared paragraph');
for(const kind of ['slope','aspect','forest_cover_fraction','coherence_mask','local_incidence_angle','incidence_angle_flat','magnitude','wrapped_phase'])assert(counts[kind]>0,`Missing ${kind}`);
// Missing thresholds must remain unknown, never become zero by numeric coercion.
scope.P={site:'test',identification:{site_name:'Test'},grid:{res_m:3},dem_path:'dem',tree:[],arrays:{mask:{source:'coherence_mask',w:1,h:1,cell_m:3}}};scope.key='mask';
assert(vm.runInContext('productGuide(P,key).meaning[0]',scope).includes('No numeric cutoff'));
assert(vm.runInContext('productGuide(P,key).calculation.variables[1][1]',scope).includes('Not recorded'));
console.log(`PASS: ${total} inactive legacy guide results; site metadata, corrected DEM provenance and threshold semantics (not current scientific/UI validation). ${JSON.stringify(counts)}`);
