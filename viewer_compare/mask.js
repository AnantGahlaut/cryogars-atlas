/* Session-local display controls for the selected mask and mask overlay. */
(() => {
  'use strict';
  const api=window.SnowCompareViewer,host=document.querySelector('#dock .db');
  if(!api||!host)return;
  const group=document.createElement('section');group.id='nxm-controls';group.className='grp';group.hidden=true;
  group.setAttribute('aria-label','Mask preview');
  group.innerHTML=`<div class="t">Mask preview</div>
    <label class="f" id="nxm-target-label"><span>Layer</span><select id="nxm-target" aria-label="Mask layer"></select></label>
    <div class="seg" role="group" aria-label="Mask display mode">
      <button type="button" data-mode="average" aria-pressed="true">Average</button>
      <button type="button" data-mode="binary" aria-pressed="false">0–1</button>
    </div>
    <label class="f"><span>Passing-fraction cutoff</span><div class="sl">
      <input id="nxm-slider" type="range" min="0" max="1" step="0.01" value="0.5" aria-label="Passing-fraction cutoff">
      <input id="nxm-cutoff" type="number" min="0" max="1" step="any" value="0.5" aria-label="Exact passing-fraction cutoff">
    </div></label><div id="nxm-status" role="status" aria-live="polite"></div>`;
  const style=document.createElement('style');
  style.textContent=`#nxm-controls[hidden]{display:none}#nxm-controls .seg{margin-bottom:10px}
    #nxm-controls .f{margin-bottom:8px}#nxm-cutoff{width:62px;min-width:0;padding:4px;background:var(--deep);color:var(--ink-2);border:1px solid var(--hair-2);border-radius:4px;font:11px var(--mono)}
    #nxm-status{color:var(--ink-3);font:10px/1.4 var(--ui);overflow-wrap:anywhere}
    #nxm-controls :focus-visible{outline:2px solid var(--live);outline-offset:2px}
    #nxm-controls button:disabled,#nxm-controls input:disabled{opacity:.45;cursor:not-allowed}`;
  document.head.appendChild(style);host.appendChild(group);
  const $=id=>document.getElementById('nxm-'+id),buttons=Array.from(group.querySelectorAll('[data-mode]'));
  let key=null,lastPrimary=null;
  function sync(){
    const targets=api.maskTargets(),first=targets[0]?.key||null;
    if(first!==lastPrimary||!targets.some(t=>t.key===key))key=first;
    lastPrimary=first;group.hidden=!targets.length;
    $('target').replaceChildren();
    for(const target of targets){const option=document.createElement('option');option.value=target.key;option.textContent=target.label;$('target').appendChild(option);}
    $('target').value=key||'';$('target-label').hidden=targets.length<2;
    if(!key)return;
    const options=api.maskOptions(key),binary=options.mode==='binary';
    for(const b of buttons){b.setAttribute('aria-pressed',String(b.dataset.mode===options.mode));b.disabled=b.dataset.mode==='binary'&&!api.maskSupported();}
    $('cutoff').value=String(options.cutoff);$('slider').value=String(options.cutoff);
    $('cutoff').disabled=$('slider').disabled=!binary;
    $('cutoff').setCustomValidity('');
    $('status').textContent=binary?'1 when fraction ≥ '+options.cutoff+'; otherwise 0. Missing stays blank.':
      'Fraction of valid cells passing the recorded coherence threshold.';
    if(!api.maskSupported())$('status').textContent+=' Updated viewer rendering is required for 0–1 mode.';
  }
  function update(mode,cutoff){
    if(!key)return;
    try{api.setMaskOptions(key,{mode,cutoff});sync();}
    catch(error){$('cutoff').setCustomValidity(error.message);$('cutoff').reportValidity();$('status').textContent=error.message;}
  }
  for(const b of buttons)b.onclick=()=>{if(!b.disabled&&key)update(b.dataset.mode,api.maskOptions(key).cutoff);};
  $('cutoff').onchange=()=>update(api.maskOptions(key).mode,$('cutoff').value.trim()?Number($('cutoff').value):NaN);
  $('slider').oninput=()=>update(api.maskOptions(key).mode,Number($('slider').value));
  $('target').onchange=()=>{key=$('target').value;sync();};
  for(const event of ['pointerdown','pointermove','mousedown','mousemove','wheel','keydown','click'])group.addEventListener(event,e=>e.stopPropagation());
  api.onSelection(sync);api.onMaskOptions(sync);
})();
