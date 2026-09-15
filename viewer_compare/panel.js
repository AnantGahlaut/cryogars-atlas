/* Comparison UI, deliberately isolated from the existing widgets and preferences. */
(() => {
  'use strict';
  const $=id=>document.getElementById('nxc-'+id),api=window.SnowCompareViewer;
  if(!api){$('open').hidden=true;return;}
  const C=window.SnowCompareCore,T=window.SnowCompareTiff,E=window.SnowCompareExport;
  const panel=$('panel'),trigger=$('open');document.getElementById('legend').appendChild(trigger);
  const terrain=$('terrain');document.getElementById('legend').appendChild(terrain);
  document.getElementById('stage').appendChild(panel);
  const viewButtons=[...panel.querySelectorAll('[data-nxc-view]'),...terrain.querySelectorAll('[data-nxc-view]')];
  let context,layers=[],fileState=null,result=null,view='difference',controller=null,epoch=0,loadingFile=false;
  let paletteChoices=[];
  const styleDefaults=()=>({ab:{palette:'__source__',lower:0,upper:100,reverse:false,zero:false},difference:{palette:'diverging',lower:0,upper:100,reverse:false,zero:true}});
  let styles=styleDefaults();
  const styleKey=()=>view==='difference'?'difference':'ab';
  const ownsComparison=()=>!!result&&api.selection().comparison!==null;
  const binaryMask=()=>result?.maskOptions?.mode==='binary';
  const baseWarning='Exploratory comparison, not native-resolution validation. Website values are quantized; some layers are clipped. Only shared valid cells enter the maps and statistics.';
  const status=message=>{$('status').textContent=message;$('terrain-status').textContent=message;};
  const exportDisabled=value=>{$('export').disabled=value;$('terrain-export').disabled=value;};
  const selected=()=>layers.find(l=>l.key===$('reference').value);
  const units=l=>l.unit||(['aspect','slope','local_incidence_angle','incidence_angle_flat'].includes(l.kind)?'deg':
    ['cor','coherence_mask','forest_cover_fraction'].includes(l.kind)?'unitless':'stored units');
  const mode=l=>l.kind==='aspect'?'degrees':l.kind==='wrapped_phase'?'radians':l.kind==='coherence_mask'?'mask':'linear';
  const label=l=>l.label+(l.date?' · '+l.date:'')+(l.pol?' · '+l.pol:'');
  function options(select,items){select.replaceChildren();for(const [value,text] of items){const o=document.createElement('option');o.value=value;o.textContent=text;select.appendChild(o);}}
  function resetResult(options){result=null;$('result').hidden=true;terrain.hidden=true;trigger.hidden=false;api.clear(options);}
  function resetInputs(){
    context=null;layers=[];fileState=null;styles=styleDefaults();view='difference';
    $('file').value='';$('confirm').checked=false;$('file-info').textContent='Numeric rasters only. Nothing is uploaded.';
    $('source').value='file';$('file-fields').hidden=false;$('layer-field').hidden=true;
    $('scale').value='1';$('offset').value='0';$('nodata').value='';$('approx').checked=false;
  }
  function cancel(){
    epoch++;if(controller)controller.abort();controller=null;
    if(loadingFile){loadingFile=false;$('file-info').textContent='TIFF loading cancelled. Choose the file again.';$('file').value='';}
    $('cancel').hidden=true;$('run').disabled=false;exportDisabled(false);
  }
  function changed(){cancel();resetResult();$('confirm').checked=false;status('Inputs changed. Run comparison to calculate a new result.');}
  function referenceChanged(){
    changed();const a=selected();if(!a)return;
    const g=C.grid(context,a);
    $('grid').textContent=`${a.kind.replace(/_/g,' ')} · ${units(a)} · ${g.w} × ${g.h} @ ${g.dx} m · EPSG:${g.epsg}. Camera LOD does not change this grid.`;
    options($('layer'),layers.filter(b=>b.key!==a.key&&b.kind===a.kind&&units(b)===units(a)).map(b=>[b.key,label(b)+' · '+b.key]));
    styles=styleDefaults();refreshPalettes();
    $('warning').textContent=baseWarning+(a.stretched?' This reference has clipped tails; differences cannot recover them.':'')+
      (a.kind==='aspect'?' CAUTION: stored aspect has known north/south convention and arithmetic-averaging issues. This tool does not repair those values.':'')+
      (a.kind==='wrapped_phase'?' Wrapped phase was averaged in the existing export. This limits quantitative interpretation.':'');
    $('method').disabled=mode(a)!=='linear';if(mode(a)!=='linear')$('method').value='nearest';
  }
  trigger.onclick=event=>{
    event.stopPropagation();
    if(result&&!ownsComparison()){cancel();resetResult({restore:false});resetInputs();}
    if(!context){context=api.context();layers=context.layers;options($('reference'),layers.map(l=>[l.key,label(l)+' · '+l.key]));$('reference').value=context.current;referenceChanged();}
    else if(!result){const current=api.context().current;if(current&&current!==$('reference').value){$('reference').value=current;referenceChanged();}}
    panel.close();panel.classList.remove('nxc-inspect');panel.showModal();$('reference').focus();
    if(result){captureAppearance();refreshPalettes();loadStyle();render();}
  };
  function close(){cancel();panel.close();(result?$('terrain-style'):trigger).focus();}
  $('close').onclick=close;panel.addEventListener('cancel',e=>{e.preventDefault();close();});
  // Do not let terrain orbit/hover handlers act behind the dialog.
  for(const ev of ['pointerdown','pointermove','mousedown','mousemove','wheel','keydown'])panel.addEventListener(ev,e=>e.stopPropagation());
  for(const ev of ['pointerdown','pointermove','mousedown','mousemove','wheel','keydown','click'])terrain.addEventListener(ev,e=>e.stopPropagation());
  $('terrain-style').onclick=()=>{
    if(!ownsComparison())return;
    panel.close();panel.classList.add('nxc-inspect');panel.show();
    captureAppearance();refreshPalettes();loadStyle();render();$('palette').focus();
  };
  $('reference').onchange=referenceChanged;
  $('source').onchange=()=>{changed();const file=$('source').value==='file';$('file-fields').hidden=!file;$('layer-field').hidden=file;};
  for(const id of ['band','scale','offset','nodata','method','approx','layer'])$(id).addEventListener('change',changed);
  $('confirm').addEventListener('change',()=>{if(result)changed();});
  async function chooseFile(file){
    if(!file)return;
    changed();fileState=null;$('file-info').textContent='Reading TIFF metadata…';const token=++epoch;
    loadingFile=true;
    try{
      if(!/\.tiff?$/i.test(file.name))throw Error('Choose a .tif or .tiff numeric GeoTIFF.');
      if(file.size>4*1024**3)throw Error('This file exceeds the 4 GiB import limit. Choose a tiled/overview or cropped TIFF.');
      const tiff=await window.GeoTIFF.fromBlob(file),image=await tiff.getImage(),info=T.describe(image);
      if(token!==epoch)return;
      fileState={file,tiff,image,info};
      options($('band'),Array.from({length:info.bands},(_,i)=>[String(i),String(i+1)]));
      $('file-info').textContent=`${file.name} · ${info.w} × ${info.h} · ${info.bands} band(s) · EPSG:${info.epsg} · nodata: ${info.nodata===null?'not tagged':info.nodata}.`;
      $('scale').value='1';$('offset').value='0';$('nodata').value='';$('approx').checked=false;
      status('TIFF ready. Check the product, units, band, and conversion before comparing.');
    }catch(e){if(token===epoch){$('file-info').textContent='No TIFF loaded.';status(e.message);}}
    finally{if(token===epoch)loadingFile=false;}
  }
  $('file').onchange=()=>chooseFile($('file').files[0]);
  $('drop').addEventListener('dragover',e=>{e.preventDefault();$('drop').classList.add('nxc-drag');});
  $('drop').addEventListener('dragleave',()=>$('drop').classList.remove('nxc-drag'));
  $('drop').addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();$('drop').classList.remove('nxc-drag');if(e.dataTransfer.files.length!==1){status('Drop one GeoTIFF at a time.');return;}chooseFile(e.dataTransfer.files[0]);});
  $('cancel').onclick=()=>{cancel();status('Comparison cancelled.');};
  $('clear').onclick=()=>{cancel();resetResult();fileState=null;$('file').value='';$('confirm').checked=false;$('file-info').textContent='Numeric rasters only. Nothing is uploaded.';status('Temporary data cleared; original layer restored.');};
  $('terrain-clear').onclick=()=>{if(!ownsComparison())return;$('clear').onclick();panel.close();trigger.focus();};
  function previewImage(layer,values){
    const g=C.grid(context,layer);
    return {info:{w:g.w,h:g.h,bands:1,epsg:g.epsg,nodata:NaN,pixel:(x,y)=>[(x-g.left)/g.dx-.5,(y-g.top)/g.dy-.5]},
      image:{async readRasters({window:[x0,y0,x1,y1]}){const out=new Float32Array((x1-x0)*(y1-y0));for(let y=y0;y<y1;y++)out.set(values.subarray(y*g.w+x0,y*g.w+x1),(y-y0)*(x1-x0));return out;}}};
  }
  function calculate(r){
    const mask=r.mode==='mask',options=mask?C.maskOptions(api.maskOptions(r.aname)):null;
    const a=mask?C.maskPreview(r.rawA,options):new Float32Array(r.rawA);
    const b=mask?C.maskPreview(r.rawB,options):new Float32Array(r.rawB);
    const binary=options?.mode==='binary';
    const d=binary?C.difference(r.rawA,r.rawB,'mask',options.cutoff):C.difference(a,b,mask?'linear':r.mode);
    if(!d.stats.count)throw Error('No overlapping valid data. Check the site, EPSG, band, nodata, and raster footprint.');
    // Keep decoded/aligned originals intact; each view shares the statistics' valid intersection.
    const transitions=[0,0,0];
    for(let i=0;i<a.length;i++){
      if(!Number.isFinite(d.values[i]))a[i]=b[i]=NaN;
      else if(binary)transitions[d.values[i]+1]++;
    }
    Object.assign(r,{a,b,difference:d.values,stats:d.stats,maskOptions:options,transitions,
      unit:mask?(binary?'state change':'fraction change'):r.aUnit,
      ranks:{ab:E.sortedValues([a,b]),difference:E.sortedValues([d.values])}});
    return r;
  }
  $('run').onclick=async()=>{
    if(!panel.open||result)return;
    cancel();resetResult();const a=selected(),g=C.grid(context,a),token=++epoch;
    controller=new AbortController();const signal=controller.signal;
    $('run').disabled=true;$('cancel').hidden=false;status('Preparing comparison…');
    try{
      const av=C.decode(a);let bv,bname,sourceNote;
      const opts={signal,method:mode(a)==='linear'?$('method').value:'nearest',proj4:window.proj4,
        progress:f=>{if(token===epoch)status(`Aligning B to A: ${Math.round(100*f)}%`);}};
      if($('source').value==='file'){
        if(!fileState)throw Error('Choose a GeoTIFF first.');
        if(!$('confirm').checked)throw Error('Confirm that B is the same product, with matching units and vertical datum where relevant.');
        const {image,info,file}=fileState;
        opts.band=+$('band').value;opts.scale=Number($('scale').value);opts.offset=Number($('offset').value);
        if(!$('scale').value.trim()||!$('offset').value.trim())throw Error('Enter scale and offset explicitly.');
        if($('nodata').value.trim())opts.nodataOverride=Number($('nodata').value);
        opts.allowApproximate=$('approx').checked;
        bv=await T.align(image,info,g,opts);bname=file.name+' · band '+(opts.band+1);
        sourceNote=`B: EPSG:${info.epsg}; ${opts.method} centre sampling; raw × ${opts.scale} + ${opts.offset}`;
        if(info.epsg!==g.epsg)sourceNote+=opts.allowApproximate?'; approximate horizontal transform (no shift grids)':' ; reprojected';
      }else{
        const b=layers.find(l=>l.key===$('layer').value);
        if(!b||b.kind!==a.kind||units(a)!==units(b))throw Error('No compatible same-product comparison layer selected.');
        const source=previewImage(b,C.decode(b));bv=await T.align(source.image,source.info,g,opts);
        bname=b.key;sourceNote=`B: exported ${b.bits}-bit values at ${b.cell_m} m; ${opts.method} centre sampling${b.stretched?'; clipped tails':''}`;
      }
      if(token!==epoch)return;
      result=calculate({rawA:av,rawB:bv,grid:g,mode:mode(a),kind:a.kind,
        aUnit:units(a),aname:a.key,bname,sourceNote,site:context.identification.site_name||context.site,
        quantization:`A: ${a.bits}-bit exported values; increment ≈ ${((a.hi-a.lo)/(2**a.bits-2)).toPrecision(3)} ${units(a)}${a.stretched?'; clipped tails':''}`,
        warnings:$('warning').textContent});
      view='difference';$('result').hidden=false;loadStyle();render();show3D();panel.close();
      $('terrain-style').focus();status('Comparison ready in 3D. Switch A / B / B − A, adjust colours, or export PNG.');
    }catch(e){if(token===epoch)status(e.name==='AbortError'?'Comparison cancelled.':e.message);}
    finally{if(token===epoch){controller=null;$('run').disabled=false;$('cancel').hidden=true;}}
  };
  function display(){
    const values=result[view],difference=view==='difference',s=styles[styleKey()],binary=binaryMask();
    const {lo,hi}=binary?{lo:difference?-1:0,hi:1}:E.stretch(result.ranks[styleKey()],s.lower,s.upper,difference&&s.zero);
    const palette=paletteChoices.find(p=>p.id===s.palette)||paletteChoices[0];
    const style={stops:palette.stops,reverse:!!s.reverse!==!!palette.reverse,...(palette.builtin?{builtin:palette.builtin}:{})};
    const title=difference?(binary?'Mask transitions B − A':'Difference B − A'):view==='a'?'Reference A':'Comparison B';
    const rangeName=s.lower===0&&s.upper===100?'Full':s.lower===2&&s.upper===98?'Robust':s.lower===10&&s.upper===90?'Detail':'Custom';
    const rangeLabel=`${rangeName} ${s.lower}–${s.upper}% stretch${difference&&s.zero?' · zero-centred limits':''}`;
    return {values,lo,hi,difference,title,unit:difference?result.unit:result.mode==='mask'?(binary?'state':'fraction'):result.aUnit,
      grid:result.grid,style,paletteName:palette.name,rangeLabel,...s.appearance,
      zeroCentered:difference&&!binary&&!!(s.appearance?.zeroCentered??s.zero),
      ...(result.mode==='mask'?{maskKey:result.aname,maskBinary:binary&&!difference,maskCategory:binary?(difference?'transition':'binary'):null}:{}),
      ...(binary?{lo,hi,rangeLabel:`0–1 preview · cutoff ${result.maskOptions.cutoff} · fixed ${difference?'−1 / 0 / +1':'0 / 1'} states`}:{})};
  }
  function captureAppearance(){
    if(!result)return;
    const a=api.appearance(view);if(!a)return;
    const d=display();
    if(binaryMask()){
      if(JSON.stringify(a.style)!==JSON.stringify(d.style)||a.paletteName!==d.paletteName)
        styles[styleKey()].appearance={...styles[styleKey()].appearance,style:a.style,paletteName:a.paletteName};
      return;
    }
    if(a.lo!==d.lo||a.hi!==d.hi||!!a.zeroCentered!==d.zeroCentered||JSON.stringify(a.style)!==JSON.stringify(d.style)||a.rangeLabel!==d.rangeLabel||a.paletteName!==d.paletteName)
      styles[styleKey()].appearance=a;
  }
  function refreshPalettes(){
    paletteChoices=api.palettes($('reference').value);
    const currentStyle=styles[styleKey()],a=currentStyle.appearance;
    if(a)paletteChoices.push({id:'__terrain__',name:a.paletteName,stops:a.style.stops,reverse:a.style.reverse,builtin:a.style.builtin});
    else if(currentStyle.paletteData)paletteChoices.push(currentStyle.paletteData);
    options($('palette'),paletteChoices.map(p=>[p.id,p.name]));
    if(!paletteChoices.some(p=>p.id===currentStyle.palette))currentStyle.palette=paletteChoices[0].id;
  }
  function loadStyle(){
    const s=styles[styleKey()];$('palette').value=s.palette;$('reverse').checked=s.reverse;
    $('percent-low').value=String(s.lower);$('percent-high').value=String(s.upper);$('zero').checked=s.zero;
    if(s.appearance){
      $('palette').value='__terrain__';$('reverse').checked=false;
      $('zero').checked=!!(s.appearance.zeroCentered??s.zero);
      if(s.appearance.rangeLabel){
        const p=s.appearance.rangeLabel.match(/([\d.]+)[–-]([\d.]+)%/);
        $('percent-low').value=p?p[1]:'';$('percent-high').value=p?p[2]:'';
      }
    }
    $('zero-field').hidden=view!=='difference';
    for(const id of ['percent-low','percent-high','zero'])$(id).disabled=binaryMask();
    panel.querySelectorAll('[data-nxc-range]').forEach(b=>b.disabled=binaryMask());
    exportDisabled(false);$('show').disabled=false;
  }
  function updateStyle(rangeChanged=false){
    if(!ownsComparison()||binaryMask()&&rangeChanged)return;
    captureAppearance();
    const lower=$('percent-low').value.trim()?Number($('percent-low').value):NaN;
    const upper=$('percent-high').value.trim()?Number($('percent-high').value):NaN;
    try{
      const palette=paletteChoices.find(p=>p.id===$('palette').value);
      if(!palette)throw Error('Select an available palette.');E.colorMapper(palette);
      const previous=styles[styleKey()];
      if(rangeChanged==='zero'&&Number.isFinite(previous.appearance?.lo)&&Number.isFinite(previous.appearance?.hi)&&!/[\d.]+[–-][\d.]+%/.test(previous.appearance.rangeLabel||'')){
        const a=previous.appearance,zero=view==='difference'&&$('zero').checked;
        const {lo,hi}=E.stretch([a.lo,a.hi],0,100,zero);
        previous.appearance={...a,lo,hi,zeroCentered:zero,rangeLabel:'Custom value limits'+(zero?' · zero-centred limits':'')};
        previous.zero=zero;
      }else if(previous.appearance&&!rangeChanged){
        previous.appearance={...previous.appearance,style:{stops:palette.stops,reverse:!!$('reverse').checked!==!!palette.reverse,...(palette.builtin?{builtin:palette.builtin}:{})},paletteName:palette.name};
      }else{
        if(!binaryMask())E.stretch(result.ranks[styleKey()],lower,upper,view==='difference'&&$('zero').checked);
        styles[styleKey()]={palette:palette.id,paletteData:palette.id==='__terrain__'?palette:null,lower:binaryMask()?previous.lower:lower,upper:binaryMask()?previous.upper:upper,reverse:$('reverse').checked,zero:$('zero').checked};
      }
      // Invalidate any PNG still being encoded with the previous styling.
      epoch++;exportDisabled(false);$('show').disabled=false;render();show3D();status(binaryMask()?'3D and PNG colours updated; mask states keep fixed limits.':'3D and PNG updated with these colours and percentile limits.');
    }catch(e){epoch++;exportDisabled(true);$('show').disabled=true;status(e.message);}
  }
  for(const id of ['palette','reverse'])$(id).addEventListener('change',()=>updateStyle());
  for(const id of ['percent-low','percent-high'])$(id).addEventListener('change',()=>updateStyle(true));
  $('zero').addEventListener('change',()=>updateStyle('zero'));
  panel.querySelectorAll('[data-nxc-range]').forEach(b=>b.onclick=()=>{
    if(binaryMask())return;
    const p=b.dataset.nxcRange.split(',');$('percent-low').value=p[0];$('percent-high').value=p[1];updateStyle(true);
  });
  function render(){
    const d=display(),s=result.stats;
    const c=E.raster(document,d.values,d.grid.w,d.grid.h,d.lo,d.hi,d.difference,d.style),canvas=$('canvas');
    canvas.width=c.width;canvas.height=c.height;canvas.getContext('2d').drawImage(c,0,0);
    const stops=d.style.reverse?d.style.stops.map(([p,c])=>[1-p,c]).reverse():d.style.stops;
    $('key').style.background='linear-gradient(90deg,'+stops.map(([p,c])=>c+' '+(p*100)+'%').join(',')+')';
    if(d.style.builtin||d.hi-d.lo<1e-6){
      const color=E.colorMapper(d.style);
      $('key').style.background='linear-gradient(90deg,'+Array.from({length:65},(_,i)=>'rgb('+color((d.hi-d.lo)*i/64/Math.max(d.hi-d.lo,1e-6)).slice(0,3).join(',')+') '+i*100/64+'%').join(',')+')';
    }
    if(d.maskCategory){
      const color=E.colorMapper(d.style),fractions=d.maskCategory==='transition'?[0,.5,1]:[0,1];
      $('key').style.background='linear-gradient(90deg,'+fractions.flatMap((v,i)=>{
        const c='rgb('+color(v).slice(0,3).join(',')+')';return [c+' '+i*100/fractions.length+'%',c+' '+(i+1)*100/fractions.length+'%'];
      }).join(',')+')';
    }
    $('range-label').textContent=d.rangeLabel;
    const p=d.rangeLabel.match(/([\d.]+)[–-]([\d.]+)%/),activeRange=p?p[1]+','+p[2]:'';
    panel.querySelectorAll('[data-nxc-range]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.nxcRange===activeRange)));
    $('ticks').replaceChildren();for(const value of d.maskCategory==='binary'?[0,1]:[d.lo,(d.lo+d.hi)/2,d.hi]){const span=document.createElement('span');span.textContent=value.toPrecision(4)+' '+d.unit;$('ticks').appendChild(span);}
    viewButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.nxcView===view)));
    $('terrain-name').textContent=d.title+' · temporary';
    $('summary').textContent=`${d.title} · north up\n${s.count.toLocaleString()} shared cells (${(s.coverage*100).toFixed(1)}% of A grid)\n`+
      (binaryMask()?`0–1 preview · cutoff ${result.maskOptions.cutoff}\n−1 lost pass: ${result.transitions[0]} · 0 unchanged: ${result.transitions[1]} · +1 gained pass: ${result.transitions[2]}`:`${result.mode==='mask'?'Average fractions\n':''}Mean B−A ${s.mean.toPrecision(4)} ${result.unit}\nMAE ${s.mae.toPrecision(4)} · RMSE ${s.rmse.toPrecision(4)} ${result.unit}`)+
      `\n${d.grid.w} × ${d.grid.h} @ ${d.grid.dx} m`;
  }
  function show3D(){
    if(!result)return;const d=display();
    if(result.pendingMaskUpdate)result.pendingMaskUpdate=false;
    api.show({...d,id:view,mode:result.mode,kind:result.kind,label:d.title+' · temporary',cmap:d.difference?'diverging':'viridis'});
    terrain.hidden=false;trigger.hidden=true;
  }
  viewButtons.forEach(b=>b.onclick=()=>{if(!ownsComparison())return;captureAppearance();view=b.dataset.nxcView;refreshPalettes();loadStyle();render();show3D();});
  $('show').onclick=()=>{if(!ownsComparison()||$('show').disabled)return;show3D();panel.close();$('terrain-style').focus();};
  $('export').onclick=$('terrain-export').onclick=()=>{
    if(!ownsComparison()||$('export').disabled)return;captureAppearance();render();const d=display(),g=result.grid;
    const token=epoch,filename=context.site+'_'+view+'_comparison.png';
    const lines=[result.site+' · EPSG:'+g.epsg+' · north up · '+g.w+' × '+g.h+' map pixels @ '+g.dx+' m',
      'A: '+result.aname,'B: '+result.bname,result.sourceNote,result.quantization,
      'Palette: '+d.paletteName+(d.style.reverse?' (reversed)':''),d.rangeLabel+(binaryMask()?'; palette changes do not change states.':'; out-of-range colours saturate; statistics unchanged.'),
      `Shared valid: ${result.stats.count}/${result.stats.total}; nodata transparent/white; Δ = B − A`,
      'Grid upper-left edge: '+g.left+', '+g.top+'; centre x=left+(col+0.5)×cell, y=top−(row+0.5)×cell.',
      'Exploratory website-resolution comparison; no native-data or vertical-datum validation.'];
    if(result.mode==='degrees')lines.push('Aspect uses shortest signed angular difference; known source direction/averaging issues remain.');
    if(result.mode==='radians')lines.push('Phase uses shortest signed angular difference; existing preview averaging is not corrected.');
    if(result.mode==='mask'){
      const cutoff=result.maskOptions.cutoff;
      lines.push(binaryMask()?`Mask 0–1 preview; cutoff ${cutoff} applied to both original A/B fractions. A/B: 0 below cutoff, 1 at or above cutoff. Δ: −1 lost pass, 0 unchanged, +1 gained pass.`:
        `Mask Average mode: A/B show fractions of valid cells passing the archived coherence test; Δ is the fraction change. Binary preview cutoff ${cutoff} is saved but does not classify this map.`);
    }
    exportDisabled(true);
    try{
      E.figure(document,{...d,lines}).toBlob(blob=>{
        if(token!==epoch||!ownsComparison())return;
        exportDisabled(false);
        if(!blob){status('PNG encoding failed. Try a smaller reference layer.');return;}
        let url,link;
        try{
          url=URL.createObjectURL(blob);link=document.createElement('a');link.href=url;link.download=filename;
          document.body.appendChild(link);link.click();status('PNG download requested at the analysis grid resolution.');
        }catch(e){status('PNG export failed: '+e.message);}
        finally{if(link)link.remove();if(url)setTimeout(()=>URL.revokeObjectURL(url),1000);}
      },'image/png');
    }catch(e){exportDisabled(false);status('PNG export failed: '+e.message);}
  };
  let lastSelection=null;
  api.onMaskOptions(({key})=>{
    if(!result||result.mode!=='mask'||key!==result.aname)return;
    if(ownsComparison())captureAppearance();
    calculate(result);epoch++;result.pendingMaskUpdate=true;
    if(ownsComparison()){refreshPalettes();loadStyle();render();show3D();status('Mask preview and statistics updated from the original aligned fractions.');}
  });
  api.onSelection(selection=>{
    const previous=lastSelection;lastSelection=selection;
    if(ownsComparison()){
      terrain.hidden=false;trigger.hidden=true;
      if(result.pendingMaskUpdate){refreshPalettes();loadStyle();render();show3D();return;}
      if(!previous||previous.comparison===null){captureAppearance();refreshPalettes();loadStyle();render();}
      return;
    }
    terrain.hidden=true;trigger.hidden=false;
    if(previous&&(previous.tab!==selection.tab||previous.key!==selection.key)){
      cancel();panel.close();
      if(!result)resetInputs();
    }
    if(result&&!selection.available){
      cancel();panel.close();resetResult({restore:false});resetInputs();
    }
  });
})();
