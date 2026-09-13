/* Executed inside the existing viewer closure. All changes are in-memory only. */
{
  const temporary=new Map(), originalFloats=floats, originalSavePrefs=savePrefs;
  let restoreKey=null, restoreOverlay=null, lastShown=null;
  const instance=Date.now().toString(36);
  let generation=0;
  const prefix='__temporary_comparison__/';
  const styleFields=['palettes','customs','ranges','rangeModes','reverse'];
  const copy=stops=>stops.map(s=>[s[0],s[1]]);
  const clearStyle=k=>{for(const field of styleFields)if(PREF[field])delete PREF[field][k];};
  const listeners=new Set();let changing=0,lastSelection='';
  function selection(){
    const tab=tabs.find(t=>t.id===active),key=tab&&tab.kind==='layer'?primKey:null;
    const available=!!(lastShown&&temporary.has(lastShown.key)&&tabs.some(t=>t.key===lastShown.key));
    return {key,tab:active,comparison:available&&key===lastShown.key&&tab.key===lastShown.key?lastShown.id:null,available};
  }
  function notifySelection(){
    if(changing)return;
    const state=selection(),signature=JSON.stringify(state);if(signature===lastSelection)return;
    lastSelection=signature;for(const listener of listeners)listener({...state});
  }
  // A close can activate DEM, and clear can close a tab then restore its source.
  // Publish only the completed operation so consumers never see those intermediate scenes.
  const notifyAfter=fn=>function(...args){
    changing++;try{return fn.apply(this,args);}finally{changing--;notifySelection();}
  };
  activate=notifyAfter(activate);closeTab=notifyAfter(closeTab);
  lastSelection=JSON.stringify(selection());
  floats=function(k){return temporary.has(k)?temporary.get(k):originalFloats(k);};
  if(typeof angularKind==='function'){
    const originalAngularKind=angularKind;
    angularKind=k=>temporary.has(k)?P.arrays[k].comparisonAngleKind:originalAngularKind(k);
  }
  savePrefs=function(...args){
    const removed=[];
    for(const field of styleFields)for(const k of Object.keys(PREF[field]||{}))if(k.startsWith(prefix)){
      removed.push([PREF[field],k,PREF[field][k]]);delete PREF[field][k];
    }
    try{return originalSavePrefs.apply(this,args);}
    finally{for(const [map,k,value] of removed)map[k]=value;}
  };
  window.SnowCompareViewer={
    selection,
    onSelection(listener){listeners.add(listener);listener(selection());return()=>listeners.delete(listener);},
    palettes(key){
      const fromConfig=c=>c.mode==='binary'?[[0,c.colors[0]],[.499,c.colors[0]],[.5,c.colors[1]],[1,c.colors[1]]]:copy(c.stops||[]);
      const choices=Object.keys(BUILTIN_STOPS).map(id=>({id,builtin:id,name:id==='diverging'?'Diverging':PALETTE_LABELS[id]||id,stops:copy(BUILTIN_STOPS[id])}));
      if(P.arrays[key]){
        const name=layerCmap(key),stops=name==='custom'?customStops(key):BUILTIN_STOPS[name];
        if(stops)choices.push({id:'__source__',name:'Current reference layer palette',stops:copy(stops),reverse:!!layerReverse(key),...(name!=='custom'?{builtin:name}:{})});
      }
      for(const p of Object.values(PREF.savedPalettes||{}))if(p&&p.mode){
        choices.push({id:'saved:'+p.id,name:'Saved · '+(p.name||p.id)+' · '+(p.type||''),stops:fromConfig(p)});
      }
      return choices;
    },
    context(){return {site:P.site,identification:P.identification,grid:G,
      current:primKey&&primKey.startsWith(prefix)?restoreKey:primKey,
      layers:Object.keys(P.arrays).filter(k=>!k.startsWith(prefix)).map(k=>({key:k,...P.arrays[k],kind:productKind(k)}))};},
    appearance(id){
      if(selection().comparison!==id)return null;
      const name=layerCmap(primKey),stops=name==='custom'?customStops(primKey):BUILTIN_STOPS[name];
      const style={stops:copy(stops||BUILTIN_STOPS.viridis),reverse:!!layerReverse(primKey)};
      if(name!=='custom')style.builtin=name;
      let [lo,hi]=layerRange(primKey);
      if(isDiverging(primKey)){const m=Math.max(Math.abs(lo),Math.abs(hi),1e-6);lo=-m;hi=m;}
      const mode=rangeMode(primKey),sameStyle=JSON.stringify(style)===JSON.stringify(lastShown.style);
      const sameRange=lo===lastShown.lo&&hi===lastShown.hi&&mode==='custom';
      const terrainSamples=({a:'A',b:'B',difference:'Difference'}[lastShown.id]||lastShown.id)+' terrain samples (sampled ranks)';
      return {lo,hi,style,
        paletteName:sameStyle&&lastShown.paletteName|| (name==='custom'?'Custom legend palette':PALETTE_LABELS[name]||name),
        rangeLabel:sameRange&&lastShown.rangeLabel||({full:'Full 0–100% stretch',robust:'3D legend Robust 2–98% stretch · '+terrainSamples,detail:'3D legend Detail 10–90% stretch · '+terrainSamples}[mode]||'Custom value limits')};
    },
    show:notifyAfter(function(result){
      const identity=instance+'_'+generation;
      const k=prefix+identity,rg=result.grid,n=rg.w*rg.h;
      if(result.values.length!==n)throw Error('Temporary result/grid mismatch.');
      let lo=Infinity,hi=-Infinity,valid=0;
      for(const value of result.values)if(Number.isFinite(value)){lo=Math.min(lo,value);hi=Math.max(hi,value);valid++;}
      if(!valid)throw Error('Temporary result has no finite values.');
      if(!restoreKey){restoreKey=primKey||DEM;restoreOverlay=ovKey;}
      const raw=new Uint8Array(n*2),span=hi-lo||1;
      for(let i=0;i<n;i++)if(Number.isFinite(result.values[i])){
        const q=1+Math.round(Math.max(0,Math.min(1,(result.values[i]-lo)/span))*65534);
        raw[2*i]=q&255;raw[2*i+1]=q>>8;
      }
      let binary='';for(let i=0;i<raw.length;i+=8192)binary+=String.fromCharCode(...raw.subarray(i,i+8192));
      P.arrays[k]={w:rg.w,h:rg.h,cell_m:rg.dx,lo,hi,bits:16,b64:btoa(binary),
        valid,total:n,leaf:'comparison_'+identity,label:result.label,short:result.label,
        comparisonAngleKind:result.id==='difference'?0:result.mode==='degrees'?1:result.mode==='radians'?2:0,
        unit:result.unit||'',domain:'meta',cmap:result.cmap||'diverging'};
      clearStyle(k);
      for(const field of styleFields)if(!PREF[field])PREF[field]={};
      PREF.ranges[k]=[result.lo,result.hi];PREF.rangeModes[k]='custom';
      if(result.style){
        PREF.palettes[k]=result.style.builtin||'__custom__';
        if(!result.style.builtin)PREF.customs[k]={mode:'continuous',stops:copy(result.style.stops)};
        PREF.reverse[k]=!!result.style.reverse;
        // The PNG already chose its exact (possibly asymmetric) display limits.
        P.arrays[k].cmap='viridis';
      }
      // Map result-cell centers onto terrain-cell centers, not rounded size ratios.
      const displayed=new Float32Array(W*H).fill(NaN);
      for(let j=0;j<H;j++)for(let i=0;i<W;i++){
        const x=G.origin[0]+(i+.5)*G.pixel[0],y=G.origin[1]+(j+.5)*G.pixel[1];
        const c=Math.floor((x-rg.left)/rg.dx),r=Math.floor((y-rg.top)/rg.dy);
        if(c>=0&&r>=0&&c<rg.w&&r<rg.h)displayed[j*W+i]=result.values[r*rg.w+c];
      }
      temporary.set(k,displayed);
      lastShown={key:k,id:result.id,lo:result.lo,hi:result.hi,paletteName:result.paletteName,rangeLabel:result.rangeLabel,
        style:result.style&&{stops:copy(result.style.stops),reverse:!!result.style.reverse,...(result.style.builtin?{builtin:result.style.builtin}:{})}};
      // A difference must not inherit an unrelated overlay blend.
      setOverlay(null);if($('ovSel'))$('ovSel').value='__none__';
      openLayer(k);
    }),
    clear:notifyAfter(function({restore=true}={}){
      const owned=selection().comparison!==null;
      for(const k of temporary.keys()){
        const t=tabs.find(t=>t.key===k);if(t)closeTab(t.id);
        delete P.arrays[k];cache.delete(k);
        clearStyle(k);
      }
      temporary.clear();
      lastShown=null;
      generation++;
      if(restore&&owned){
        if(restoreKey&&P.arrays[restoreKey])openLayer(restoreKey);
        if(restoreOverlay&&P.arrays[restoreOverlay]){setOverlay(restoreOverlay);if($('ovSel'))$('ovSel').value=restoreOverlay;}
      }
      restoreKey=null;restoreOverlay=null;
    })
  };
}
