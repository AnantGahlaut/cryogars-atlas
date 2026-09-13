/* Numeric raster -> north-up PNG. No WebGL screenshot or camera LOD dependency. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SnowCompareExport=factory();})(globalThis,function(){
  'use strict';
  function sortedValues(arrays){
    const values=[];for(const a of arrays)for(const v of a)if(Number.isFinite(v))values.push(v);
    return values.sort((a,b)=>a-b);
  }
  function stretch(sorted,lower,upper,zeroCentered){
    if(!Number.isFinite(lower)||!Number.isFinite(upper)||lower<0||upper>100||lower>=upper)throw Error('Percentile bounds must satisfy 0 ≤ lower < upper ≤ 100.');
    if(!sorted.length)throw Error('No valid values for a display range.');
    const quantile=p=>{const rank=(sorted.length-1)*p/100,i=Math.floor(rank),f=rank-i;return sorted[i]*(1-f)+sorted[Math.min(i+1,sorted.length-1)]*f;};
    let lo=quantile(lower),hi=quantile(upper);
    if(zeroCentered){const span=Math.max(Math.abs(lo),Math.abs(hi))||1;lo=-span;hi=span;}
    else if(lo===hi){const pad=Math.max(Math.abs(lo)*.01,.000001);lo-=pad;hi+=pad;}
    return {lo,hi,lower,upper,zeroCentered:!!zeroCentered};
  }
  function mapper(stops,reverse){
    if(!Array.isArray(stops)||stops.length<2||stops.length>8)throw Error('A colour palette needs 2–8 stops.');
    const s=stops.map(([p,hex])=>{
      if(!Number.isFinite(p)||p<0||p>1||!/^#[0-9a-f]{6}$/i.test(hex))throw Error('Invalid colour stop.');
      return [p,[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16))];
    });
    if(s[0][0]!==0||s.at(-1)[0]!==1||s.some((x,i)=>i>0&&x[0]<s[i-1][0]))throw Error('Colour stops must be ordered from 0 to 1.');
    return fraction=>{
      const t=Math.max(0,Math.min(1,reverse?1-fraction:fraction));
      // Match the unchanged terrain shader: an exact boundary belongs to the left segment.
      let i=1;while(i<s.length-1&&t>s[i][0])i++;
      const span=Math.max(s[i][0]-s[i-1][0],1e-6);
      const f=(t-s[i-1][0])/span;
      return s[i-1][1].map((v,k)=>Math.round(v+(s[i][1][k]-v)*f)).concat(255);
    };
  }
  // These are the existing FS shader's unlit RGB anchors, not its approximate UI swatches.
  const builtinStops={
    terrain:[[0,.176,.263,.235],[.30,.353,.416,.278],[.60,.612,.545,.384],[.85,.741,.686,.639],[1,.980,.984,.996]],
    blues:[[0,.937,.965,.988],[.5,.310,.639,.847],[1,.031,.157,.412]],
    greens:[[0,.945,.961,.906],[.5,.400,.667,.392],[1,.043,.235,.145]],
    diverging:[[0,.706,.176,.114],[.5,.965,.961,.941],[1,.114,.353,.655]],
    viridis:[[0,.267,.005,.329],[.33,.128,.435,.549],[.66,.369,.789,.383],[1,.993,.906,.144]],
    magma:[[0,.001,.000,.014],[.33,.443,.122,.507],[.66,.903,.352,.380],[1,.987,.991,.750]],
    gray:[[0,.035,.045,.050],[1,.955,.965,.968]],
    cividis:[[0,.000,.126,.302],[.33,.263,.306,.423],[.66,.576,.565,.467],[1,.996,.910,.217]]
  };
  function colorMapper(style){
    if(!style.builtin)return mapper(style.stops,style.reverse);
    const name=style.builtin,s=builtinStops[name];
    if(!s&&name!=='cyclic'&&name!=='mask')throw Error('Unsupported terrain palette.');
    return fraction=>{
      const clamped=Math.max(0,Math.min(1,fraction)),t=style.reverse?1-clamped:clamped;
      let color;
      if(name==='cyclic')color=[0,2.0944,4.1888].map(offset=>.55+.42*Math.cos(t*6.2831853-offset));
      else if(name==='mask')color=t<.5?[.78,.43,.34]:[.34,.72,.69];
      else{
        let i=1;while(i<s.length-1&&t>s[i][0])i++;
        const a=s[i-1],b=s[i],f=(t-a[0])/(b[0]-a[0]);
        color=a.slice(1).map((v,k)=>v+(b[k+1]-v)*f);
      }
      return color.map(v=>Math.round(255*v)).concat(255);
    };
  }
  function rgb(v,lo,hi,difference){
    if(!Number.isFinite(v))return [0,0,0,0];
    const t=Math.max(0,Math.min(1,(v-lo)/(hi-lo||1)));
    // Match the viewer's built-in difference and Viridis colour anchors, without terrain lighting.
    const stops=difference?[[180,45,29],[246,245,240],[29,90,167]]:[[68,1,84],[33,111,140],[94,201,98],[253,231,37]];
    const positions=difference?[0,.5,1]:[0,.33,.66,1];
    const i=t<=positions[1]?0:t<=positions[2]?1:2,f=(t-positions[i])/(positions[i+1]-positions[i]);
    return stops[i].map((a,j)=>Math.round(a+(stops[i+1][j]-a)*f)).concat(255);
  }
  function raster(document,values,w,h,lo,hi,difference,style){
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const x=c.getContext('2d'),im=x.createImageData(w,h);
    const color=style?colorMapper(style):null;
    for(let i=0;i<values.length;i++)im.data.set(!Number.isFinite(values[i])?[0,0,0,0]:color?color((values[i]-lo)/Math.max(hi-lo,1e-6)):rgb(values[i],lo,hi,difference),i*4);
    x.putImageData(im,0,0);return c;
  }
  function figure(document,result){
    const {grid,values,lo,hi,difference,lines}=result;
    const width=Math.max(grid.w,720),header=52,c=document.createElement('canvas');
    // Wrap provenance instead of shrinking long HDF5 paths into unreadable text.
    const wrapped=[];for(const line of lines){let text=String(line);const chars=Math.floor(width/7.3);while(text.length>chars){wrapped.push(text.slice(0,chars));text=text.slice(chars);}wrapped.push(text);}
    c.width=width+48;c.height=grid.h+header+100+wrapped.length*21;
    const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);
    x.fillStyle='#17252c';x.font='bold 18px sans-serif';x.fillText('CryoGARS · '+result.title,24,30,c.width-48);
    const map=raster(document,values,grid.w,grid.h,lo,hi,difference,result.style),left=24+(width-grid.w)/2;
    x.drawImage(map,left,header);x.strokeStyle='#8c9aa1';x.strokeRect(left-.5,header-.5,grid.w+1,grid.h+1);
    let y=header+grid.h+26;
    const color=result.style?colorMapper(result.style):null;
    for(let i=0;i<320;i++){
      const col=color?color((hi-lo)*i/319/Math.max(hi-lo,1e-6)):rgb(lo+(hi-lo)*i/319,lo,hi,difference);x.fillStyle=`rgb(${col.slice(0,3).join(',')})`;x.fillRect(24+i,y,1,12);
    }
    x.font='12px sans-serif';x.fillStyle='#17252c';
    x.fillText(lo.toPrecision(5),24,y+29);x.fillText(((lo+hi)/2).toPrecision(5),160,y+29);x.fillText(hi.toPrecision(5)+' '+result.unit,286,y+29);
    y+=51;x.font='12px monospace';
    for(const line of wrapped){x.fillText(line,24,y,c.width-48);y+=21;}
    return c;
  }
  return {rgb,raster,figure,sortedValues,stretch,mapper,colorMapper};
});
