/* Browser-only, bounded GeoTIFF alignment. No URLs, uploads, or persistent data. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./core.js'));
  else root.SnowCompareTiff=factory(root.SnowCompareCore);
})(globalThis,function(C){
  'use strict';
  const MAX_WINDOW=4_000_000, MAX_BLOCK_BYTES=64*1024*1024;
  function describe(image){
    const d=image.getFileDirectory(), keys=image.getGeoKeys()||{};
    const w=image.getWidth(),h=image.getHeight(),bands=image.getSamplesPerPixel();
    const epsg=Number(keys.ProjectedCSTypeGeoKey||keys.GeographicTypeGeoKey);
    if(!Number.isInteger(epsg)||epsg<=0||epsg===32767)throw Error('GeoTIFF needs an explicit supported EPSG code; georeferencing will not be guessed.');
    if(!Number.isSafeInteger(w*h)||w<1||h<1||bands<1||bands>32)throw Error('Unsupported TIFF dimensions or band count.');
    const formats=Array.from(d.SampleFormat||[1]), bits=Array.from(d.BitsPerSample||[8]);
    if(formats.some(x=>![1,2,3].includes(x))||bits.some(x=>![8,16,32,64].includes(x)))throw Error('Select a real numeric TIFF, not complex or packed-bit samples.');
    if([2,3,5,6,8].includes(d.PhotometricInterpretation))throw Error('RGB/paletted imagery is not a numeric product raster.');
    const tw=d.TileWidth||w,th=d.TileLength||Math.min(d.RowsPerStrip||h,h);
    const bytes=Array.from({length:bands},(_,i)=>(bits[i]||bits[0])/8).reduce((s,n)=>s+n,0);
    if(tw*th*bytes>MAX_BLOCK_BYTES)throw Error('A TIFF tile/strip exceeds the browser memory limit (64 MiB decoded). Use a tiled or overview TIFF.');
    let a,b,c,e,f,g;
    if(d.ModelTransformation){
      const m=d.ModelTransformation;
      if(m.length!==16||m[12]!==0||m[13]!==0||m[15]!==1)throw Error('Unsupported GeoTIFF transform.');
      [a,b,c,e,f,g]=[m[0],m[1],m[3],m[4],m[5],m[7]];
    }else{
      const s=d.ModelPixelScale,t=d.ModelTiepoint;
      if(!s||!t||t.length!==6)throw Error('GeoTIFF needs a single affine tiepoint/scale or transformation matrix.');
      a=s[0];b=0;e=0;f=-s[1];c=t[3]-a*t[0];g=t[4]-f*t[1];
    }
    const det=a*f-b*e;
    if(![a,b,c,e,f,g,det].every(Number.isFinite)||Math.abs(det)<1e-20)throw Error('Invalid or singular GeoTIFF transform.');
    if(keys.GTRasterTypeGeoKey && ![1,2].includes(keys.GTRasterTypeGeoKey))throw Error('Unsupported raster pixel interpretation.');
    const shift=keys.GTRasterTypeGeoKey===2?0:.5;
    return {w,h,bands,epsg,nodata:image.getGDALNoData(),blockBytes:tw*th*bytes,tw,th,
      byteCounts:d.TileByteCounts||d.StripByteCounts||[],planar:d.PlanarConfiguration||1,
      affine:[a,b,c,e,f,g],area:shift===.5,
      pixel:(x,y)=>[((x-c)*f-(y-g)*b)/det-shift,((y-g)*a-(x-c)*e)/det-shift]};
  }
  function crs(epsg){
    if(epsg===4326)return {datum:'WGS84',def:'+proj=longlat +datum=WGS84 +no_defs'};
    if(epsg===3857)return {datum:'WGS84',def:'EPSG:3857'};
    if(epsg===4269||epsg===6318)return {datum:epsg===4269?'NAD83':'NAD83(2011)',def:'+proj=longlat +ellps=GRS80 +no_defs'};
    if(epsg>=32601&&epsg<=32760&&epsg%100>=1&&epsg%100<=60)return {
      datum:'WGS84',def:`+proj=utm +zone=${epsg%100} ${epsg>=32700?'+south ':''}+datum=WGS84 +units=m +no_defs`};
    if(epsg>=26901&&epsg<=26923)return {datum:'NAD83',def:`+proj=utm +zone=${epsg-26900} +ellps=GRS80 +units=m +no_defs`};
    if(epsg>=6330&&epsg<=6348)return {datum:'NAD83(2011)',def:`+proj=utm +zone=${epsg-6329} +ellps=GRS80 +units=m +no_defs`};
    throw Error(`EPSG:${epsg} is not supported offline yet. Reproject this TIFF externally to the site's EPSG first.`);
  }
  function transform(from,to,proj,allowApproximate=false){
    if(from===to)return xy=>xy;
    const a=crs(from),b=crs(to);
    if(a.datum!==b.datum&&!allowApproximate)throw Error('Horizontal datum differs. Explicitly allow an approximate transform, or supply a TIFF in the site CRS.');
    if(!proj)throw Error('Projection library is unavailable.');
    const p=proj(a.def,b.def);
    return xy=>p.forward(xy);
  }
  function abort(signal){if(signal&&signal.aborted)throw new DOMException('Import aborted','AbortError');}
  async function align(image,info,target,opts={}){
    const {signal,method='nearest',band=0,scale=1,offset=0}=opts;
    abort(signal);
    if(!['nearest','bilinear'].includes(method))throw Error('Unsupported sampling method.');
    if(!Number.isInteger(band)||band<0||band>=info.bands)throw Error('Invalid TIFF band.');
    if(!Number.isFinite(scale)||scale===0||!Number.isFinite(offset))throw Error('Scale must be finite and nonzero; offset must be finite.');
    if(!Number.isSafeInteger(target.w*target.h)||target.w*target.h>2_000_000)throw Error('Comparison grid exceeds the two-million-cell browser limit.');
    const project=transform(target.epsg,info.epsg,opts.proj4,opts.allowApproximate);
    const out=new Float32Array(target.w*target.h).fill(NaN);
    for(let row=0;row<target.h;row+=32){
      for(let col=0;col<target.w;col+=64){
        abort(signal);
        const rw=Math.min(64,target.w-col),rh=Math.min(32,target.h-row),points=[];
        let xmin=Infinity,ymin=Infinity,xmax=-Infinity,ymax=-Infinity;
        for(let j=0;j<rh;j++)for(let i=0;i<rw;i++){
          const xy=project(C.center(target,col+i,row+j)), p=info.pixel(xy[0],xy[1]);
          if(p.every(Number.isFinite)&&p[0]>=-.5&&p[1]>=-.5&&p[0]<info.w-.5&&p[1]<info.h-.5){
            points.push([i,j,p[0],p[1]]);xmin=Math.min(xmin,p[0]);ymin=Math.min(ymin,p[1]);xmax=Math.max(xmax,p[0]);ymax=Math.max(ymax,p[1]);
          }
        }
        if(!points.length)continue;
        const x0=Math.max(0,Math.floor(xmin)),y0=Math.max(0,Math.floor(ymin));
        const x1=Math.min(info.w,Math.ceil(xmax)+2),y1=Math.min(info.h,Math.ceil(ymax)+2),n=(x1-x0)*(y1-y0);
        if(n>MAX_WINDOW)throw Error('A source window is too large for safe browser decoding. Use a coarser/tiled TIFF.');
        // readRasters decodes complete intersecting blocks concurrently, even for
        // very narrow windows. Bound their aggregate size, not just output cells.
        if(info.tw&&info.th){
          const blocks=(Math.ceil(x1/info.tw)-Math.floor(x0/info.tw))*(Math.ceil(y1/info.th)-Math.floor(y0/info.th));
          if(blocks*info.blockBytes+n*12>128*1024*1024)throw Error('Intersecting TIFF tiles/strips exceed the browser memory budget (128 MiB). Use a tiled or cropped TIFF.');
          const across=Math.ceil(info.w/info.tw),down=Math.ceil(info.h/info.th);
          let encodedBytes=0;
          for(let y=Math.floor(y0/info.th);y<Math.ceil(y1/info.th);y++)for(let x=Math.floor(x0/info.tw);x<Math.ceil(x1/info.tw);x++){
            const index=y*across+x+(info.planar===2?band*across*down:0);
            const count=Number(info.byteCounts[index]||0);
            if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid TIFF block byte count.');
            encodedBytes+=count;
          }
          if(encodedBytes>128*1024*1024)throw Error('Encoded TIFF blocks exceed the browser memory budget. Use a tiled or cropped TIFF.');
        }
        const data=await image.readRasters({window:[x0,y0,x1,y1],samples:[band],interleave:true,signal});
        abort(signal);
        const clean=new Float32Array(n);
        const nodata=opts.nodataOverride===undefined?info.nodata:opts.nodataOverride;
        for(let k=0;k<n;k++)clean[k]=!Number.isFinite(data[k])||(nodata!==null&&nodata!==undefined&&data[k]===nodata)?NaN:data[k]*scale+offset;
        for(const [i,j,x,y] of points)out[(row+j)*target.w+col+i]=C.sample(clean,x1-x0,y1-y0,x-x0,y-y0,method);
      }
      if(opts.progress)opts.progress(Math.min(1,(row+32)/target.h));
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    abort(signal);return out;
  }
  return {describe,transform,align,crs};
});
