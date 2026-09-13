/* Read-only integration against already-present exports and one small source TIFF. */
const fs=require('node:fs'),assert=require('node:assert/strict'),{test}=require('node:test');
const C=require('./core'),T=require('./tiff');
// The browser distribution references Worker at module load. No Pool is used;
// workers are deliberately unavailable in this Node numerical test harness.
global.Worker=class {constructor(){throw Error('Workers must not be used in numerical tests');}};
const GeoTIFF=require('../assets/vendor/geotiff-2.1.3.js');
const page='viewer/grand_mesa_explorer.html';
test('largest existing website layer decodes at its exported resolution',{skip:!fs.existsSync(page)},()=>{
  const p=JSON.parse(fs.readFileSync(page,'utf8').match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const layer=p.arrays[p.dem_path],values=C.decode(layer),g=C.grid(p,layer);
  assert.equal(values.length,layer.w*layer.h);assert.equal(g.dx,layer.cell_m);assert.ok(values.some(Number.isFinite));
});
const source='ASO_GrandMesa_mosaic_2020Feb13_AllData_and_Reports/ASO_GrandMesa_mosaic_2020Feb13_AllData_and_Reports/ASO_GrandMesa_Mosaic_2020Feb13_snowdepth_50m.tif';
test('actual ASO GeoTIFF parses and aligns a numeric window',{skip:!fs.existsSync(source)},async()=>{
  const bytes=fs.readFileSync(source),tiff=await GeoTIFF.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const im=await tiff.getImage(),info=T.describe(im);
  assert.equal(info.epsg,32612);assert.equal(info.w,455);assert.equal(info.h,212);
  const [a,,left,,,top]=info.affine;
  const target={w:40,h:40,left,top,dx:a,dy:-a,epsg:32612};
  const result=await T.align(im,info,target,{method:'nearest'});
  const raw=await im.readRasters({window:[0,0,40,40],samples:[0],interleave:true});
  for(let i=0;i<raw.length;i++){
    if(!Number.isFinite(raw[i])||raw[i]===info.nodata)assert.ok(Number.isNaN(result[i]));
    else assert.ok(Math.abs(raw[i]-result[i])<1e-5);
  }
});
test('real ASO TIFF compares to the full exported Grand Mesa snow-depth grid',{skip:!fs.existsSync(source)||!fs.existsSync(page)},async()=>{
  const p=JSON.parse(fs.readFileSync(page,'utf8').match(/<script id="payload" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const [key,layer]=Object.entries(p.arrays).find(([k,l])=>l.leaf==='snow_depth'&&k.includes('20200201'));
  assert.ok(key);const g=C.grid(p,layer),a=C.decode(layer);
  const bytes=fs.readFileSync(source),tiff=await GeoTIFF.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const im=await tiff.getImage(),info=T.describe(im),b=await T.align(im,info,g,{method:'nearest'});
  const result=C.difference(a,b);
  assert.ok(result.stats.count>1000);assert.ok(Number.isFinite(result.stats.rmse));
  assert.equal(result.values.length,g.w*g.h);
});
