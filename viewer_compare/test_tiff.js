const {test} = require('node:test');
const assert = require('node:assert/strict');
const T = require('./tiff.js');

function image(extra={}) {
  return {getWidth:()=>2,getHeight:()=>2,getSamplesPerPixel:()=>1,
    getFileDirectory:()=>({ModelPixelScale:[3,3,0],ModelTiepoint:[0,0,0,100,200,0],BitsPerSample:[32],SampleFormat:[3],RowsPerStrip:2,...extra}),
    getGeoKeys:()=>({ProjectedCSTypeGeoKey:32612,GTRasterTypeGeoKey:1}),getGDALNoData:()=>-9999};
}
test('GeoTIFF affine maps pixel centers with area and point semantics',()=>{
  const info=T.describe(image()); assert.deepEqual(info.pixel(101.5,198.5),[0,0]);
  const p=image(); p.getGeoKeys=()=>({ProjectedCSTypeGeoKey:32612,GTRasterTypeGeoKey:2});
  assert.ok(T.describe(p).pixel(100,200).every(v=>v===0));
});
test('tiepoint raster indices and rotated affine are honored',()=>{
  const info=T.describe(image({ModelTiepoint:[4,5,0,112,185,0]}));
  assert.deepEqual(info.pixel(101.5,198.5),[0,0]);
  const rotated=T.describe(image({ModelTransformation:[0,-3,0,100,3,0,0,200,0,0,1,0,0,0,0,1]}));
  assert.deepEqual(rotated.pixel(98.5,201.5),[0,0]);
});
test('missing EPSG, complex samples, enormous strips and singular transforms reject',()=>{
  const missing=image(); missing.getGeoKeys=()=>({}); assert.throws(()=>T.describe(missing),/EPSG/);
  assert.throws(()=>T.describe(image({SampleFormat:[6]})),/real numeric/);
  const giant=image({RowsPerStrip:100000000}); giant.getHeight=()=>100000000;
  assert.throws(()=>T.describe(giant),/memory/);
  assert.throws(()=>T.describe(image({ModelPixelScale:[0,3,0]})),/transform/);
});
test('same CRS needs no library; unknown cross-CRS and datum change reject by default',()=>{
  assert.deepEqual(T.transform(32612,32612)([1,2]),[1,2]);
  const proj4=require('../assets/vendor/proj4-2.12.1.js');
  assert.throws(()=>T.transform(32612,26912,proj4),/datum/);
  assert.throws(()=>T.transform(32612,9999,proj4),/supported/);
  const xy=T.transform(4326,32612,proj4)([-111,0]);
  assert.ok(Math.abs(xy[0]-500000)<1e-6 && Math.abs(xy[1])<1e-6);
});
test('bounded import aligns numeric samples, excludes nodata and preserves zeros',async()=>{
  const im=image(); im.readRasters=async opts=>{
    assert.deepEqual(opts.samples,[0]);return new Float32Array([0,2,-9999,6]);
  };
  const target={w:2,h:2,left:100,top:200,dx:3,dy:-3,epsg:32612};
  const out=await T.align(im,T.describe(im),target,{method:'nearest'});
  assert.deepEqual(Array.from(out),[0,2,NaN,6]);
});
test('cancelled import never reads raster; no overlap stays nodata',async()=>{
  let reads=0; const im=image(); im.readRasters=async()=>{reads++;return new Float32Array(4);};
  const target={w:1,h:1,left:10000,top:200,dx:3,dy:-3,epsg:32612};
  const abort=new AbortController();abort.abort();
  await assert.rejects(T.align(im,T.describe(im),target,{signal:abort.signal}),/abort/i);
  const out=await T.align(im,T.describe(im),target,{});
  assert.ok(Number.isNaN(out[0]));assert.equal(reads,0);
});
test('aggregate decoded-strip memory is guarded even for a tiny output window',async()=>{
  const im=image({RowsPerStrip:1});im.getWidth=()=>16_000_000;im.getHeight=()=>32;
  im.readRasters=async()=>{throw Error('Decoder should not run');};
  const target={w:1,h:32,left:100,top:200,dx:3,dy:-3,epsg:32612};
  await assert.rejects(T.align(im,T.describe(im),target,{}),/memory budget/);
});
