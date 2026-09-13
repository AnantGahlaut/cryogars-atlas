/* Script-level interaction checks with a minimal DOM/canvas stub, not browser QA.
 * node ui_preview/check_index.js [viewer/index.html]
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const file = path.resolve(process.argv[2] || path.join(__dirname, '../viewer/index.html'));
const html = fs.readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
const payload = scripts.find(s => s[1].includes('id="sites"'))[2];
const sites = JSON.parse(payload);
const app = scripts.filter(s => !s[1].includes('application/json')).map(s => s[2]).join('\n');
assert.equal(new Set(sites.map(s => s.key)).size, sites.length);
function harness({reducedMotion=false,canvasAvailable=true}={}) {
  const stats={faces:0},pending=new Map();let nextId=0,intersection;
  const paint=new Proxy({}, {get:(_obj,prop)=>prop==='fill'?()=>stats.faces++:()=>{}});
  function element(){
    return {textContent:'',attrs:{},style:{},hidden:false,href:'',
      setAttribute(k,v){this.attrs[k]=v},addEventListener(k,v){this[k]=v},
      getBoundingClientRect(){return {width:900,height:420}},getContext(){return canvasAvailable?paint:null}};
  }
  const els=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],element()]));
  els.sites.textContent=payload;els.terrain.parentElement=element();
  const buttons=sites.map(element),media={matches:reducedMotion,addEventListener(k,v){this[k]=v}};
  const document={hidden:false,getElementById:id=>els[id],querySelectorAll:()=>buttons,
    addEventListener(k,v){this[k]=v}};
  class IntersectionObserver{constructor(cb){intersection=cb}observe(){}}
  const scope=vm.createContext({document,window:{devicePixelRatio:1,addEventListener(){},
    matchMedia:()=>media,IntersectionObserver},IntersectionObserver,ResizeObserver:class{observe(){}},
    requestAnimationFrame:cb=>{const id=++nextId;pending.set(id,cb);return id},
    cancelAnimationFrame:id=>pending.delete(id)});
  vm.runInContext(app,scope);
  return {els,buttons,scope,stats,pending,media,document,
    step(now){const callbacks=[...pending.values()];pending.clear();callbacks.forEach(cb=>cb(now))},
    visible(value){intersection([{isIntersecting:value}])}};
}
const h=harness(),{els,buttons,scope,stats}=h;
for(let i=0;i<sites.length;i++){
  const s=sites[i], t=s.terrain;
  assert(fs.existsSync(path.join(path.dirname(file),s.file)),`Missing link ${s.file}`);
  assert(t.w<=82 && t.h<=82 && t.q.length===t.w*t.h);
  assert(t.q.some(q=>q>0));assert(Number.isFinite(t.lo)&&Number.isFinite(t.hi));
  stats.faces=0;buttons[i].click();
  assert(stats.faces>0,`No terrain for ${s.name}`);
  assert.equal(els['site-name'].textContent,s.name);
  assert.equal(els.launch.href,s.file);
  assert.equal(buttons.filter(b=>b.attrs['aria-pressed']==='true').length,1);
  assert(els['site-metadata'].textContent.includes(s.name));
  assert.equal(els['archive-resolution'].textContent,`${s.res_m} m`);
  assert.equal(els['available-resolution'].textContent,`Archive grid ${s.res_m} m · Finest explorer terrain ${s.mesh_m} m`);
  assert.equal(els['terrain-resolution'].textContent,`This preview only: ${t.cell_m} m sampling · 2× height`);
  assert.equal(t.cell_m%s.mesh_m,0);
  assert.equal(h.pending.size,1,'Selection must not create parallel orbit loops');
}
const grandMesa=sites.findIndex(s=>s.key==='grand_mesa');
if(grandMesa>=0){
  buttons[grandMesa].click();
  assert(els['available-resolution'].textContent.includes('Archive grid 3 m'));
  assert(els['available-resolution'].textContent.includes('terrain 72 m'));
  assert(els['terrain-resolution'].textContent.includes('preview only: 720 m'));
}
const angle=()=>vm.runInContext('orbitAngle',scope);
const before=angle(),compassBefore=els['north-arrow'].style.transform;
assert.equal(vm.runInContext('ORBIT_SPEED',scope),2*Math.PI/300,'Orbit should remain a subtle five-minute revolution');
h.step(0);h.step(16);assert.equal(angle(),before,'No redraw above the 30fps cap');
h.step(40);assert(angle()>before,'Orbit should advance');
assert.notEqual(els['north-arrow'].style.transform,compassBefore,'North must track rotation');
els['orbit-toggle'].click();assert.equal(h.pending.size,0,'Pause cancels scheduled frame');
const paused=angle();h.step(10000);assert.equal(angle(),paused);
els['orbit-toggle'].click();assert.equal(h.pending.size,1);
h.step(10000);assert.equal(angle(),paused,'Resume must not jump');
h.step(10040);assert(angle()>paused);
h.visible(false);assert.equal(h.pending.size,0,'Offscreen orbit stops');
h.visible(true);assert.equal(h.pending.size,1);
h.document.hidden=true;h.document.visibilitychange();assert.equal(h.pending.size,0,'Hidden tab stops');
h.document.hidden=false;h.document.visibilitychange();assert.equal(h.pending.size,1);
h.media.matches=true;h.media.change();assert.equal(h.pending.size,0,'Reduced-motion change stops orbit');
const reduced=harness({reducedMotion:true});
assert.equal(reduced.pending.size,0,'Reduced motion does not autoplay');
assert.equal(reduced.els['orbit-toggle'].textContent,'Rotate preview');
// An incomplete quad must not become a surface across a missing-data hole.
vm.runInContext('sites[0].terrain={w:2,h:2,q:[0,1,65535,32768],bits:16,lo:0,hi:100,cell_m:10}',scope);
stats.faces=0;buttons[0].click();assert.equal(stats.faces,0);
assert.equal(h.pending.size,0,'Empty geometry must not animate');
// No canvas support must leave launch links and metadata functional.
const fallback=harness({canvasAvailable:false});
assert.equal(fallback.els['preview-error'].hidden,false);
assert.equal(fallback.els.launch.href,sites[0].file);
assert.equal(fallback.pending.size,0);
console.log(`PASS: ${sites.length} site selections, three resolution labels, terrain geometry, orbit/pause/resume, compass, offscreen/hidden/reduced-motion stops, nodata and no-canvas fallback (script-level, not browser QA).`);
