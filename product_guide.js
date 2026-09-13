/* Plain-data scientific explanations. Embedded in each standalone explorer.
 * Source metadata is read from that page's payload; no remote lookup at runtime.
 * Keep these functions independent of the DOM for offline regression tests.
 */
const GUIDE_SOURCES={
  terrain:{label:"GDAL terrain definitions",url:"https://gdal.org/en/stable/programs/gdaldem.html"},
  radar:{label:"JPL repeat-pass InSAR products",url:"https://uavsar.jpl.nasa.gov/science/documents/rpi-format.html"},
  coherence:{label:"JPL interferometric quality metrics",url:"https://uavsar.jpl.nasa.gov/science/documents/rpi-qa.html"},
  geometry:{label:"JPL incidence-angle definitions",url:"https://uavsar.jpl.nasa.gov/science/documents/polsar-format.html"},
  snow:{label:"UAVSAR snow retrieval: Hoppinen et al. (2024)",url:"https://tc.copernicus.org/articles/18/575/2024/"},
  canopy:{label:"Forest cover and SWE: Bonnell et al. (2024)",url:"https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2024GL111708"},
  qsi:{label:"NSIDC QSI DEM, snow-depth & vegetation-height guide",url:"https://nsidc.org/data/documentation/snowex20-21-qsi-lidar-3m-utm-grid-dem-snow-depth-and-vegetation-height-version-1-user-guide"},
  angle:{label:"NumPy complex-angle convention",url:"https://numpy.org/doc/stable/reference/generated/numpy.angle.html"}
};
const GUIDE_INDEX=new WeakMap();
const GUIDE_LABELS={slope:"Terrain slope",aspect:"Terrain aspect",forest_cover_fraction:"Forest cover fraction",
  coherence_mask:"Coherence mask",local_incidence_angle:"Local incidence angle",incidence_angle_flat:"Flat incidence angle",
  magnitude:"Interferogram magnitude",wrapped_phase:"Wrapped interferometric phase",cor:"Coherence",unw:"Unwrapped phase",
  amp:"Radar amplitude",amp1:"Radar amplitude · pass 1",amp2:"Radar amplitude · pass 2",elevation:"Elevation",hgt:"Radar elevation",
  snow_depth:"Snow depth",veg_height:"Vegetation height"};
function guideKind(key,L){
  if(key.includes("∠phase"))return "wrapped_phase";
  if(key.includes("|magnitude|"))return "magnitude";
  const leaf=(L.source||key).split("/").pop();
  if(leaf.startsWith("forest_cover_fraction"))return "forest_cover_fraction";
  return leaf;
}
function productGuide(P,key){
  const L=P.arrays[key];if(!L)return null;
  if(!GUIDE_INDEX.has(P))GUIDE_INDEX.set(P,new Map(P.tree.map(n=>[n.path,n])));
  const nodes=GUIDE_INDEX.get(P),get=p=>nodes.get(p)?.attrs||{};
  const source=L.source||key,a=get(source),synthetic=get(key);
  const kind=guideKind(key,L),dem=get(P.dem_path),from=a.derived_from||synthetic.derived_from;
  const upstream=from?get(from):a;
  const site=P.identification.site_name||P.site;
  const g={kind,title:GUIDE_LABELS[kind]||L.label||L.short||kind,site,summary:"",meaning:[],method:[],cautions:[],context:[],references:[]};
  const present=v=>v!==undefined&&v!==null&&v!=="";
  const value=v=>Array.isArray(v)?v.join(" → "):typeof v==="object"?JSON.stringify(v):String(v);
  const row=(label,v)=>{if(present(v))g.context.push([label,value(v)]);};
  const number=v=>present(v)&&Number.isFinite(Number(v))?Number(v):null;
  const refs=(...names)=>g.references=names.map(n=>GUIDE_SOURCES[n]);
  const sourceRows=(attrs,label="Source")=>{
    row(label+" dataset",attrs.source_dataset);row(label+" file",attrs.source_filename);
    const dates=attrs.acquisition_date_end&&attrs.acquisition_date_end!==attrs.acquisition_date?
      [attrs.acquisition_date,attrs.acquisition_date_end]:attrs.acquisition_date;
    row(label+" survey",dates);row(label+" native spacing",present(attrs.source_native_resolution_m)?attrs.source_native_resolution_m+" m":null);
    row(label+" resampling",attrs.resampling_method);row(label+" note",attrs.source_note);
  };
  row("Site",site);row("Layer",key);row("Acquisition",L.date);row("Polarisation",L.pol);
  row("Source stored units",a.units||"Not recorded");row("Displayed quantity units",L.unit||(kind==="magnitude"?"Magnitude of source complex units":"Not specified in display export"));
  row("Common archive grid",P.grid.res_m+" m (not native resolution of every instrument)");
  row("Site CRS",P.identification.common_crs_epsg?"EPSG:"+P.identification.common_crs_epsg:"Not recorded");
  if(P.grid.origin)row("Grid origin (E, N)",P.grid.origin.join(", ")+" m; upper-left outer corner");
  row("Exported colour grid",`${L.w} × ${L.h} at ${L.cell_m} m`);
  row("Recorded method",a.method);row("Derived from",from);
  switch(kind){
    case "slope":
      g.summary="Terrain steepness estimated from changes in this site's elevation grid.";
      g.meaning=["0° is horizontal; larger angles are steeper. Slope is not snow depth or radar viewing angle."];
      g.method=["The enrichment generator uses Horn's weighted 3×3 elevation gradients: slope = atan(sqrt(dzdx² + dzdy²)), converted to degrees."];
      g.cautions=["Missing elevation affects the derivative and its neighbouring cells. Terrain detail depends on the source DEM and grid spacing.","The generator reads its input DEM before writing the cleaned enriched elevation copy; do not assume a derivative was recomputed after that cleaning."];
      sourceRows(dem,"Terrain");refs("terrain");break;
    case "aspect":
      g.summary="A circular terrain-orientation angle computed from this site's elevation gradients.";
      g.meaning=["Aspect normally describes the direction a slope faces. Its scale wraps at 360°/0°; use circular methods such as sin/cos for modelling.","The current generator stores missing values where gradient magnitude is below 10⁻⁹, treating near-flat terrain as undefined."];
      g.method=["Uses the Horn 3×3 gradients. Current code applies (90° − atan2(dzdy, −dzdx)) mod 360°."];
      g.cautions=["Confirmed implementation issue: with north-positive dzdy, the current formula reflects north/south relative to downhill aspect. A north-rising plane produces 0° here, although its downhill direction is 180°. Do not treat stored values as validated downhill bearings.","This help does not correct stored angles. The export also averages aspect arithmetically: 359° and 1° average to 180°, not north. Use circular aggregation for quantitative analysis."];
      sourceRows(dem,"Terrain");refs("terrain");break;
    case "forest_cover_fraction":{
      const threshold=number(a.canopy_height_threshold_m),nominal=number(a.window_m),res=number(P.grid.res_m);
      g.summary="A local canopy-cover proxy calculated from this site's dated vegetation-height survey.";
      g.meaning=["0 means none of the valid cells in the neighbourhood meet the canopy-height threshold; 1 means all do. Multiply by 100 for percent cover.","It is a height-threshold proxy, not tree count, tree species, mean canopy height or an independent land-cover survey."];
      g.method=[threshold!==null?`Counts valid vegetation-height cells at or above ${threshold} m and divides by the number of valid cells in the local square neighbourhood.`:"Threshold and neighbourhood must be checked in the source metadata; no threshold is inferred when absent."];
      if(nominal!==null&&res>0){
        const win=Math.max(1,Math.round(nominal/res)),side=2*Math.floor(win/2)+1;
        row("Nominal window",nominal+" m");row("Current generator footprint",`${side} × ${side} cells (${side*res} m across)`);
        if(side*res!==nominal)g.cautions.push(`Window audit: metadata specifies ${nominal} m, but the current inclusive box-window implementation uses ${side} × ${side} cells (${side*res} m at this site's ${res} m grid). Verify processing provenance before treating the nominal size as exact.`);
      }
      row("Canopy threshold",threshold!==null?threshold+" m, inclusive (≥)":"Not recorded");sourceRows(upstream,"Vegetation");
      g.cautions.push("A neighbourhood with no valid input stays missing. A missing centre cell can still receive a value from valid neighbours; coverage can therefore extend beyond the measured vegetation footprint.","Use the actual source survey dates below when combining this layer with radar. A later canopy survey is not a contemporaneous measurement for an earlier snow season.");
      g.cautions.push("The calculation reads the original vegetation array, before the cleaned enriched copy. Finite means numerically finite, not independently validated. Neighbourhoods are clipped at grid edges; this paper supports the canopy-cover concept, not proof of this implementation's exact parameters.");
      refs("canopy");break;}
    case "coherence_mask":{
      const threshold=number(a.coherence_threshold);
      g.summary="A binary screening layer derived from the coherence of this particular radar pair and polarisation.";
      g.meaning=[threshold!==null?`1 = coherence ≥ ${threshold}; 0 = coherence < ${threshold}. Missing source coherence is stored as ${a.nodata_value??255} and excluded from the viewer.`:"1/0 encode the pipeline's coherence classification. No numeric cutoff is inferred when threshold metadata is absent."];
      g.method=["Compares coherence after the pipeline's swath and range cleaning to the stored threshold. This is a classification, not a new radar measurement."];
      g.cautions=["Passing this screen does not prove that phase can be unwrapped, that valid phase exists, or that a snow retrieval is accurate. Terrain geometry and other quality checks still matter.","The export averages finite mask cells in display blocks; the default mask palette shows two states, while continuous palettes can show intermediate fractions. Use archive mask cells for quantitative screening. Archive nodata 255 is distinct from browser packing code 0 (missing); browser code 255 can be valid."];
      row("Coherence threshold",a.coherence_threshold);row("Missing-data code",a.nodata_value);refs("coherence","snow");break;}
    case "local_incidence_angle":
      g.summary="The angle between an estimated ground-to-aircraft line of sight and this site's DEM-derived surface normal.";
      g.meaning=["0° means the sensor direction aligns with the terrain normal. Larger angles are more oblique. Terrain tilt makes this differ from the flat-surface incidence angle.","The incidence ≥ 90° condition includes perpendicular and back-facing terrain in this approximation; it is not a terrain-occlusion test or a radar-shadow measurement."];
      g.method=["The generator approximates the aircraft as a straight track through the annotation peg point at fixed reported altitude, then compares the ground-to-track vector with DEM-derived normals."];
      g.cautions=["Approximate geometry: detailed aircraft navigation, squint and terrain occlusion are not modelled. The current routine receives a look-direction label but does not apply that argument to its calculation.","Missing DEM cells are temporarily replaced by the whole-site finite mean to estimate normals; missing centres are masked again afterward. Neighbouring normals can still be affected by that fill.","The implementation assumes an unrotated, square metric grid; it uses east spacing for both gradients, applies heading directly to projected axes, and performs no vertical-datum conversion or meridian-convergence correction.","Finite geometry cells can extend outside the radar swath. An incidence-threshold percentage is not observed radar coverage."];
      if(a.incidence_ge_90_status==='no_valid_incidence'){
        row("Incidence ≥ 90° · finite-cell share","Unavailable: no finite incidence cells");
      }else if(a.incidence_ge_90_status==='computed'&&typeof a.incidence_ge_90_fraction==='number'&&Number.isFinite(a.incidence_ge_90_fraction)){
        row("Incidence ≥ 90° · finite-cell share",(a.incidence_ge_90_fraction*100).toFixed(2)+"%");
        row("Finite incidence cells",a.incidence_valid_cell_count);
      }else if(a.incidence_ge_90_status!==undefined||a.incidence_ge_90_fraction!==undefined){
        row("Incidence ≥ 90° · finite-cell share","Unavailable in recorded metadata");
      }else if(typeof a.radar_shadow_fraction==='number'&&Number.isFinite(a.radar_shadow_fraction)){
        row("Legacy incidence ≥ 90° · whole-grid share",(a.radar_shadow_fraction*100).toFixed(2)+"%");
        g.cautions.push("The legacy radar_shadow_fraction denominator includes missing cells; it is not the corrected finite-cell percentage.");
      }
      sourceRows(dem,"Terrain");refs("geometry","snow");break;
    case "incidence_angle_flat":
      g.summary="The estimated radar viewing angle from vertical, without the local surface tilt.";
      g.meaning=["Compare this with local incidence angle to inspect the effect of terrain orientation. Both are stored in degrees here."];
      g.method=["Uses the same straight peg-track / fixed-altitude approximation as local incidence, but compares the viewing vector with the upward vertical direction. DEM ground elevation still enters the ground-to-platform height."];
      g.cautions=["This is not a flat-elevation Earth model or a direct aircraft navigation solution. It ignores terrain tilt, not the site's elevation; it shares the approximate track geometry limitations."];
      g.cautions.push("The look-direction argument is not applied. Heading is used directly in projected axes without convergence correction, and no vertical-datum reconciliation is performed. Missing DEM centres remain missing.");
      sourceRows(dem,"Terrain");refs("geometry");break;
    case "magnitude":
      g.summary="The magnitude of the complex interferogram, derived for display from this radar pair.";
      g.meaning=["Larger magnitude values indicate a stronger combined interferometric signal. Magnitude is not normalized coherence and is not either acquisition's individual amplitude."];
      g.method=["The viewer export takes abs(complex interferogram), averages that magnitude within display blocks, then applies its 2–98 percentile packing stretch."];
      g.cautions=["This is a display-derived view, not a separate observation or snow-depth retrieval. Export packing clips extreme display values; use the complex HDF5 source for quantitative analysis."];
      refs("radar");break;
    case "wrapped_phase":
      g.summary="The angular component of the complex radar interferogram, displayed within one phase cycle.";
      g.meaning=["Values wrap across −π and +π radians. Adjacent colours across that boundary can represent nearby phases, not an abrupt change on the ground."];
      g.method=["For each exported display block, the generator averages complex interferogram values and then takes their angle. It does not average wrapped angles directly or perform unwrapping."];
      g.cautions=["Phase is not snow depth or SWE. Retrieval needs a physical model, reference, geometry and corrections; acquisition order also affects phase sign.","Weak coherence, wet snow, vegetation and atmospheric effects can complicate interpretation."];
      g.cautions.push("The phase of a near-zero complex block mean is unstable and at zero has no physical direction, although NumPy may return a finite angle convention.");
      refs("radar","snow","angle");break;
    case "cor":
      g.summary="Interferometric coherence: how consistently the radar signals correspond between this pair of acquisitions.";
      g.meaning=["Values near 1 indicate stronger correspondence; values near 0 indicate weaker correspondence. This is a dimensionless radar metric, not a snow-depth confidence score."];
      g.method=["This layer comes from the source UAVSAR product and is resampled into the site archive; the enrichment mask applies a separate threshold to it."];
      g.cautions=["Low coherence can reflect multiple causes, including vegetation, snow change and acquisition geometry. High coherence alone does not validate a snow retrieval."];
      refs("coherence","snow");break;
    case "unw":
      g.summary="Unwrapped interferometric phase from the source radar product.";
      g.meaning=["Phase cycles are resolved by adding multiples of 2π, allowing values beyond one wrapped cycle. Check stored units and referencing before interpreting signs or differences."];
      g.method=["The archive carries the source unwrapped phase; this viewer does not perform phase unwrapping."];
      g.cautions=["Unwrapping errors and missing regions can remain, especially at low coherence. Phase is not absolute snow depth or SWE without the retrieval model and appropriate corrections."];
      g.cautions.push("The pipeline's swath-cleaning branch removes zero-valued phase. That is a processing rule, not a universal scientific claim that zero phase cannot be valid.");
      refs("radar","snow");break;
    case "amp":case "amp1":case "amp2":
      g.summary="Radar-return amplitude for the selected acquisition and polarisation.";
      g.meaning=[kind==="amp1"?"Pass 1 is the first acquisition of the radar pair.":kind==="amp2"?"Pass 2 is the second acquisition of the radar pair.":"Larger amplitudes indicate stronger radar returns.","JPL repeat-pass amplitude products use linear amplitude, not power or decibels; check this source's metadata before quantitative comparison."];
      g.method=["Imported into the shared grid and averaged for browser display. The amplitude display export uses a percentile stretch to keep strong outliers from dominating the colour range."];
      g.cautions=["Amplitude responds to terrain, surface and vegetation properties as well as acquisition geometry. Brightness is not a direct snow-depth measurement."];
      refs("radar");break;
    case "elevation":case "hgt":
      g.summary="Elevation values providing terrain context for this site.";
      g.meaning=["Heights are not snow thickness. Source technique, vertical datum and survey date matter when comparing DEMs."];
      g.method=["The source elevation is placed on the archive's common grid. The browser terrain is sampled more coarsely and its vertical exaggeration is a display setting."];
      g.cautions=["Being stored under the LIDAR branch does not guarantee a LiDAR source: inspect the source dataset and note below. Resampling to a finer grid does not add measured detail."];
      sourceRows(a,"Elevation");refs("terrain");break;
    case "snow_depth":
      g.summary="The selected snow-depth survey stored for this site and date.";
      g.meaning=["Depth describes snow thickness, not snow density or snow water equivalent. Confirm the source survey and units below."];
      g.method=["The archive aligns the survey to the common site grid. Any recorded cleaning and negative-value treatment are shown in the source context."];
      g.cautions=["A radar pair may not coincide with this survey date. A date match alone does not establish an unchanged snowpack or valid evaluation label."];
      sourceRows(a,"Snow survey");row("Negative-value handling",a.negative_handling);refs("snow");break;
    case "veg_height":
      g.summary="The selected vegetation-height survey for this site and date.";
      g.meaning=["Height describes vertical vegetation structure; it is not forest-cover fraction. The separate fraction product thresholds and aggregates this height information."];
      g.method=["The source vegetation-height product is aligned to the common site grid; its date and provenance remain important when combining it with radar."];
      g.cautions=["A vegetation survey from another year is a temporal proxy, not a measurement of canopy conditions at every radar acquisition."];
      sourceRows(a,"Vegetation");refs("canopy");break;
    default:
      g.summary="A stored archive layer. Use the recorded metadata below to identify its quantity and processing.";
      g.meaning=["No product-specific scientific interpretation has been assigned to this quantity yet."];
      g.method=[a.description||"No detailed method is recorded for this layer."];
      g.cautions=["Do not infer physical meaning or units solely from its palette or location in the tree."];sourceRows(upstream);
  }
  if(source.startsWith("science/UAVSAR/")){
    const parts=source.split("/");let acq={};
    for(let i=parts.length-1;i>=3;i--){const candidate=get(parts.slice(0,i).join("/"));
      if(candidate.acquisition_date_pair||present(candidate.peg_heading_deg)){acq=candidate;break;}}
    row("Radar date pair",acq.acquisition_date_pair);row("Flight line",acq.flight_line);
    if(kind.includes("incidence")){
      row("Peg latitude",acq.peg_latitude_deg);row("Peg longitude",acq.peg_longitude_deg);
      row("Track heading",present(acq.peg_heading_deg)?acq.peg_heading_deg+"°":null);
      row("Platform altitude",present(acq.platform_altitude_m)?acq.platform_altitude_m+" m":null);
      row("Reported look direction",acq.radar_look_direction);
      row("Radar wavelength",present(acq.radar_wavelength_cm)?acq.radar_wavelength_cm+" cm":null);
    }
    row("Radar source",acq.source_filename||acq.source_dataset);
  }
  row("Enrichment version",P.identification.enrichment_version);
  if(/QSI/i.test(String(upstream.source_dataset||a.source_dataset||""))){
    g.references.push(GUIDE_SOURCES.qsi);
    if(kind==="veg_height")g.cautions.push("The QSI guide notes that 2020 snow-on vegetation heights omit vegetation buried beneath the snow.");
  }
  g.calculation=guideCalculation(kind,P,L,a);
  g.displayMath=guideDisplayMath(L);
  g.cautions.push("These notes describe the archive and its current generator; they do not replace validation of the underlying measurements. Missing provenance is not filled in with assumptions.");
  return g;
}

/* Equations transcribed from the named local functions, not from a generic
 * textbook replacement. Historical exports do not record a source-code hash.
 */
function guideCalculation(kind,P,L,a){
  const calc=(equations,variables,source,label="Exact math · current implementation")=>({equations,variables,source,label});
  const horn=["North-up 3 × 3 neighbourhood:","a  b  c","d  z  f","g  h  i","gx = ((c + 2f + i) − (a + 2d + g)) / (8r)","gy = ((a + 2b + c) − (g + 2h + i)) / (8r)"];
  const gradientVars=[["z, a…i","Elevation samples in metres; row above is north."],["r",`Square-grid spacing: ${P.grid.res_m} m here. Edge padding repeats boundary cells.`],["gx, gy","East-positive and north-positive elevation gradients (m/m)."],["deg(x)","x × 180/π; atan2 and acos below take/return radians."]];
  if(kind==="slope"||kind==="aspect")return calc([...horn,kind==="slope"?"slope = deg(atan(√(gx² + gy²)))":"aspect = (90 − deg(atan2(gy, −gx))) mod 360",...(kind==="aspect"?["aspect = NaN if √(gx² + gy²) < 10⁻⁹"]:[]),"Missing centre elevation → missing output."],gradientVars,"enrich_hdf5.py · slope_aspect (input DEM before enrichment cleaning)");
  if(kind==="forest_cover_fraction")return calc([
    "valid(j) = 1 if vj is finite, otherwise 0",
    "hit(j) = valid(j) × 1[vj ≥ hc]",
    "w = max(1, round(window_m / r))",
    "R = floor(w / 2)",
    "Wi = [rowi − R … rowi + R] × [coli − R … coli + R]",
    "Wi is clipped to the array boundary.",
    "FCFi = Σj∈Wi hit(j) / Σj∈Wi valid(j)",
    "FCFi = NaN when the denominator is zero."
  ],[["vj","Original input vegetation height in metres."],["hc",a.canopy_height_threshold_m!=null?`${a.canopy_height_threshold_m} m, from this layer's recorded threshold.`:"Threshold not recorded; do not infer."],["window_m",a.window_m!=null?`${a.window_m} m nominal window, as recorded.`:"Window not recorded."],["r",`${P.grid.res_m} m archive spacing.`],["round","Python round: nearest integer, ties to even. Window width is 2R + 1 cells, not w."],["1[condition]","1 if the condition is true; otherwise 0."]],"enrich_hdf5.py · box_fraction + canopy caller (original vegetation input)");
  if(kind==="coherence_mask")return calc(["mask = 255   if γ is not finite","mask = 1     if γ is finite and γ ≥ τ","mask = 0     if γ is finite and γ < τ"],[["γ","Coherence after pipeline swath/range cleaning."],["τ",a.coherence_threshold!=null?String(a.coherence_threshold)+" (recorded for this layer)":"Not recorded; verify before interpreting."],["255","Archive uint8 missing code; never included in the display block mean."]],"enrich_hdf5.py · coherence_mask construction; make_explorer.py · declared_nodata_to_nan");
  if(kind==="local_incidence_angle"||kind==="incidence_angle_flat")return calc([
    "(pE, pN) = project(peg_lon, peg_lat, EPSG:4326 → site CRS)",
    "E = c₀ + a₀(col + ½); N = f₀ + e₀(row + ½)",
    "ψ = heading_deg × π/180; u = (sin ψ, cos ψ)",
    "t = (E − pE)uE + (N − pN)uN",
    "A = (pE + t uE, pN + t uN, H)",
    "ℓ = (A − (E, N, z)) / ‖A − (E, N, z)‖",
    ...(kind==="local_incidence_angle"?["For normals: fill missing z with the whole-site finite mean.",...horn,"n = (−gx, −gy, 1) / √(gx² + gy² + 1)","θlocal = deg(acos(clamp(ℓ · n, −1, 1)))"]:["θflat = deg(acos(clamp(ℓup, −1, 1)))"]),
    "Original missing centre z → missing output."
  ],[["a₀, c₀, e₀, f₀","Archive affine transform: east step/origin and north step/origin (metres); rotation terms are ignored."],["pE, pN","Projected annotation peg point; source coordinates are listed below."],["H, ψ","Reported platform altitude (metres) and heading for this radar pair, not a shared site constant."],["r",`|a₀| = ${P.grid.res_m} m, used for both normal-gradient axes.`],["ℓ, n","Unit ground-to-platform vector and upward unit terrain normal."],["deg(x)","x × 180/π; clamp limits round-off before acos."]],"enrich_hdf5.py · local_incidence + surface_normals (straight peg-track approximation)");
  if(kind==="magnitude")return calc(["Ij = xj + i yj","mj = |Ij| = √(xj² + yj²)","mblock = nanmeanj∈B(mj)"],[["Ij","Complex source interferogram sample."],["B","One complete export block; all-NaN blocks remain missing."],["mblock","Mean of magnitudes, NOT magnitude of the complex mean."]],"make_explorer.py · complex-array branch + block_mean");
  if(kind==="wrapped_phase")return calc(["ĪB = nanmeanj∈B(Ij)","φB = atan2(Im(ĪB), Re(ĪB))"],[["B","Complete display block."],["φB","Wrapped phase in radians, returned in (−π, π] with signed-zero conventions at the boundary."],["ĪB = 0","No physical phase direction; a finite NumPy return does not resolve this."]],"make_explorer.py · np.angle(block_mean(raw, stride))");
  if(kind==="cor")return calc(["γ = |Σj wj S1,j conj(S2,j)| /", "    √((Σj wj |S1,j|²)(Σj wj |S2,j|²))"],[["S1, S2","Complex radar samples from two acquisitions."],["wj","Nonnegative estimation weights within a neighbourhood; the source estimator's exact window/weights are not recorded here."]],"Imported UAVSAR coherence; not recomputed by this archive or viewer.","Scientific definition · upstream product");
  if(kind==="unw")return calc(["φunwrapped = φwrapped + 2πk, k ∈ ℤ"],[["k","Integer cycle count estimated upstream; its algorithm/reference is not specified by this viewer."],["φ","Phase; check recorded units and reference. No conversion to snow depth is performed here."]],"Imported UAVSAR unwrapped product, followed by archive cleaning.","Phase relation · not a local unwrapping algorithm");
  if(["amp","amp1","amp2"].includes(kind))return calc(["Ablock = nanmeanj∈B(Aj)"],[["Aj","Imported amplitude sample, not power or decibels for documented JPL repeat-pass amplitudes."],["B","One complete display block; export percentile clipping follows."]],"make_explorer.py · block_mean + quantise (display only)");
  if(/QSI/i.test(String(a.source_dataset||""))&&["snow_depth","veg_height"].includes(kind))return calc([kind==="snow_depth"?"snow depth = snow-on DEM − snow-off DEM":"vegetation height = DSM − bare-earth DEM"],[["DEM","Ground-elevation model; snow-on DEM includes the snow surface."],["DSM","Surface model including above-ground vegetation."],["Scope","Upstream QSI product definition, not a new subtraction in this viewer. Dates and processing are source-specific."]],"NSIDC SnowEx20–21 QSI Version 1 user guide; archive aligns imported product.","Source-product math · QSI");
  return calc(["Imported source values → archive grid → display samples"],[["Method boundary","No new physical retrieval is performed here. The upstream method is not fully specified by this export; use recorded source provenance."]],"Recorded source metadata below; make_explorer.py handles display sampling only.","Imported product · no local retrieval equation");
}
function guideDisplayMath(L){
  return [
    "Complete display block B: vB = nanmean(values in B)",
    "Magnitude uses mean(|I|); wrapped phase uses arg(mean(I)).",
    "Incomplete bottom/right blocks are omitted; all-NaN → missing.",
    L.stretched?"lo, hi = export percentiles P2, P98 (fallback to min/max if equal)":"lo, hi = exported finite min, max",
    `This layer: lo = ${L.lo}, hi = ${L.hi}; b = ${L.bits} bits`,
    "span = hi − lo if hi > lo, otherwise 1",
    "Q = 1 + round(clamp((vB − lo)/span, 0, 1) × (2ᵇ − 2))",
    "Q = 0 for missing values; round uses nearest, ties to even.",
    "vdecoded = lo + (Q − 1)/(2ᵇ − 2) × (hi − lo)",
    "Display colours use vdecoded; clipped extremes cannot be recovered.",
    "Coarse colour samples are assigned to terrain by nearest neighbour.",
    "Source: make_explorer.py · block_mean / quantise; explorer_template.html · decodeAt / floats"
  ];
}
