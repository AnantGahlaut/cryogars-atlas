/* Add-on event tests with DOM stubs + byte-level isolation checks.
 * These are not browser visual tests. The working viewer is never written.
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const source=read('viewer/banner_summit_explorer.html');
const preview=read('ui_preview/banner_summit_logo_notes_preview.html');
const manifest=JSON.parse(read('ui_preview/logo_notes_preview_manifest.json'));
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
for(const [p,h] of Object.entries(manifest.protected_files))assert.equal(sha(fs.readFileSync(path.join(root,p))),h,p+' unchanged');
const styles=s=>[...s.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)].map(m=>m[1]);
const scripts=s=>[...s.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
const marker='\n<!-- SnowEx logo and notes addon v1 -->\n';
const compareMarker='\n<!-- SnowEx comparison addon v1 -->\n';
const originalScripts=scripts(source.split(marker)[0]),newScripts=scripts(preview);
assert.equal(styles(preview)[0],styles(source)[0],'Original CSS byte-for-byte identical');
originalScripts.forEach((m,i)=>assert.equal(newScripts[i][0],m[0],'Original app/payload byte-for-byte identical'));
if(source.includes(compareMarker)){
  assert(preview.includes(compareMarker),'Preview retains the existing comparison tool');
  assert.equal(preview.split(compareMarker)[1],source.split(compareMarker)[1],'Existing comparison tool is byte-identical');
}
for(const m of newScripts)if(!m[1].includes('application/json'))new Function(m[2]);
assert(preview.includes('<base href="../viewer/">'),'Existing links lead to working viewers');
const metadata=JSON.parse(preview.match(/<script id="nxn-metadata" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const code=preview.match(/<script id="nxn-script">([\s\S]*?)<\/script>/)[1];
const nodes=new Map(),observers=[];
function node(id){if(!nodes.has(id))nodes.set(id,{id,hidden:id==='nxn-panel',style:{},attrs:{},events:{},children:[],textContent:'',innerHTML:'',
  appendChild(child){this.children.push(child);},setAttribute(k,v){this.attrs[k]=v;},
  addEventListener(k,f){this.events[k]=f;},focus(){scope.focused=id;},
  getBoundingClientRect(){return id==='nxn-logo'?{left:900,right:988,top:700,bottom:736}:{left:0,right:200,top:0,bottom:200};}});return nodes.get(id);}
node('nxn-metadata').textContent=JSON.stringify(metadata);node('iPath').textContent=metadata.dem;
class Observer{constructor(callback){this.callback=callback;observers.push(this);}observe(target){this.target=target;}}
const scope=vm.createContext({document:{getElementById:node},MutationObserver:Observer,ResizeObserver:Observer,
  getComputedStyle:n=>({display:n.style.display||'block',visibility:n.style.visibility||'visible'}),focused:null});
vm.runInContext(code,scope);
const event=(key)=>({key,stopped:false,prevented:false,stopPropagation(){this.stopped=true;},preventDefault(){this.prevented=true;}});
const click=id=>{const e=event();node(id).events.click(e);return e;};
assert.equal(node('nxn-panel').hidden,true,'Notes hidden initially');
assert.equal(node('info').children.length,1,'Only the notes entry row added to info');
assert.equal(node('info').children[0].id,'nxn-trigger');
assert.equal(node('nxn-trigger').attrs['aria-label'],'Product notes & methods for Elevation','Accessible name includes the visible entry label');
assert.equal(node('stage').children[0].id,'nxn-logo');
assert(click('nxn-trigger').stopped,'No click bubbling into existing scene');
assert.equal(node('nxn-panel').hidden,false);
assert.equal(node('nxn-trigger').attrs['aria-expanded'],'true');
assert.equal(node('nxn-title').textContent,'Elevation');
assert.equal(scope.focused,'nxn-close');
assert(node('nxn-content').innerHTML.includes('2021-09-17'),'Recorded Banner Summit source date');
const escape=event('Escape');node('nxn-panel').events.keydown(escape);
assert(escape.stopped&&escape.prevented);assert(node('nxn-panel').hidden);assert.equal(scope.focused,'nxn-trigger');
assert.equal(node('nxn-trigger').attrs['aria-expanded'],'false');
click('nxn-trigger');click('nxn-close');
assert(node('nxn-panel').hidden);assert.equal(scope.focused,'nxn-trigger');
click('nxn-trigger');click('nxn-trigger');
assert(node('nxn-panel').hidden,'Entry row toggles notes closed');
click('nxn-trigger');scope.focused='iClose';
node('info').style.display='none';observers.find(o=>o.target.id==='info').callback();
assert(node('nxn-panel').hidden,'Closing Info closes notes');
assert.equal(scope.focused,'iClose','Do not focus an entry hidden with Info');
assert.equal(node('nxn-trigger').attrs['aria-expanded'],'false');
node('info').style.display='';observers.find(o=>o.target.id==='info').callback();
assert(node('nxn-panel').hidden,'Reopening Info does not reopen notes');
click('nxn-trigger');
const nonDem=Object.keys(metadata.layers).find(k=>k.endsWith('/snow_depth'));
assert(nonDem,'An unreviewed snow-depth fixture is available');
node('iPath').textContent=nonDem;observers.find(o=>o.target.id==='iPath').callback();
assert(node('nxn-content').innerHTML.includes('recorded metadata only'),'Unreviewed products are explicitly scoped');
node('info').style.visibility='hidden';observers.find(o=>o.target.id==='info').callback();
assert(node('nxn-panel').hidden,'Timeline/details hide the notes');assert(node('nxn-logo').hidden);
assert(!/localStorage|sessionStorage|window\.name|showModal|preventDefault\(\).*wheel/.test(code),'No preference writes or modal overlay');
assert.deepEqual(node('info').style,{display:'',visibility:'hidden'},'Add-on did not write original info styles');
console.log('PASS: original CSS/app/payload identical; all 10 working files unchanged; add-on open/close/Escape/layer tracking/visibility tested with DOM stubs.');
