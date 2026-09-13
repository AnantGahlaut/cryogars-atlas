'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let core = {};
try {
  core = require('./core.js');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes("'./core.js'")) throw error;
}

test('exports the complete numerical API', () => {
  assert.deepEqual(Object.keys(core).sort(), ['center', 'decode', 'difference', 'grid', 'sample']);
});

function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function close(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('UMD build exposes SnowCompareCore in a browser context', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('./core.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.SnowCompareCore).sort(),
    ['center', 'decode', 'difference', 'grid', 'sample']);
});

test('decode handles 8-bit nodata, endpoints, and a real zero', () => {
  const values = core.decode({w: 4, h: 1, bits: 8, b64: b64([0, 1, 128, 255]), lo: -1, hi: 1});
  assert.ok(values instanceof Float32Array);
  assert.ok(Number.isNaN(values[0]));
  assert.deepEqual(Array.from(values.slice(1)), [-1, 0, 1]);
});

test('decode reads 16-bit values as little-endian', () => {
  const values = core.decode({
    w: 3, h: 1, bits: 16,
    b64: b64([1, 0, 0, 1, 255, 255]),
    lo: 0, hi: 65534
  });
  assert.deepEqual(Array.from(values), [0, 255, 65534]);
});

test('decode rejects malformed dimensions and encodings', () => {
  const valid = {w: 1, h: 1, bits: 8, b64: b64([1]), lo: 0, hi: 1};
  for (const layer of [
    {...valid, w: 0}, {...valid, h: 1.5}, {...valid, w: 2000001},
    {...valid, bits: 12}, {...valid, b64: '!!!!'}, {...valid, b64: 'AA=A'},
    {...valid, b64: b64([1, 2])}, {...valid, lo: NaN}
  ]) assert.throws(() => core.decode(layer), TypeError);
});

test('grid uses cropped layer dimensions and top-left source origin', () => {
  const payload = {
    grid: {origin: [100, 200], pixel: [3, -3], full: [1000, 900]},
    identification: {common_crs_epsg: 26911}
  };
  const result = core.grid(payload, {w: 2, h: 3, cell_m: 12});
  assert.deepEqual(result, {w: 2, h: 3, left: 100, top: 200, dx: 12, dy: -12, epsg: 26911});
  assert.deepEqual(core.center(result, 1, 2), [118, 170]);
  assert.equal(result.left + result.w * result.dx, 124);
  assert.equal(result.top + result.h * result.dy, 164);
});

test('grid rejects missing CRS, invalid geometry, and non-north-up source pixels', () => {
  const good = {grid: {origin: [0, 1], pixel: [1, -1]}, identification: {common_crs_epsg: 32612}};
  for (const payload of [
    {grid: {origin: [0, 1]}},
    {...good, grid: {...good.grid, origin: [0]}},
    {...good, grid: {...good.grid, pixel: [-1, -1]}},
    {...good, grid: {...good.grid, pixel: [1, 1]}}
  ]) assert.throws(() => core.grid(payload, {w: 1, h: 1, cell_m: 2}), TypeError);
  assert.throws(() => core.grid(good, {w: 0, h: 1, cell_m: 2}), TypeError);
  assert.throws(() => core.grid(good, {w: 1, h: 1, cell_m: -2}), TypeError);
});

test('center guards invalid coordinate inputs', () => {
  const good = {w: 1, h: 1, left: 0, top: 1, dx: 1, dy: -1, epsg: 1};
  assert.throws(() => core.center(good, NaN, 0), TypeError);
  assert.throws(() => core.center({...good, dy: 1}, 0, 0), TypeError);
});

test('nearest sampling honors center footprint boundaries and nodata', () => {
  const values = new Float32Array([0, 10, 20, NaN]);
  assert.equal(core.sample(values, 2, 2, -0.5, -0.5, 'nearest'), 0);
  assert.ok(Number.isNaN(core.sample(values, 2, 2, 1.5, 1.5, 'nearest')));
  assert.equal(core.sample(values, 2, 2, 1.49, 0, 'nearest'), 10);
  assert.ok(Number.isNaN(core.sample(values, 2, 2, -0.500001, 0, 'nearest')));
  assert.ok(Number.isNaN(core.sample(values, 2, 2, 0, 1.500001, 'nearest')));
});

test('bilinear sampling clamps edges and uses center-coordinate weights', () => {
  const values = new Float32Array([0, 10, 20, 30]);
  assert.equal(core.sample(values, 2, 2, 0.5, 0.5, 'bilinear'), 15);
  assert.equal(core.sample(values, 2, 2, -0.5, 0.5, 'bilinear'), 10);
  assert.equal(core.sample(values, 2, 2, 1.5, 0.5, 'bilinear'), 20);
});

test('bilinear sampling ignores zero-weight nodata but rejects weighted nodata', () => {
  const values = new Float32Array([1, NaN, 3, 4]);
  assert.equal(core.sample(values, 2, 2, 0, 0, 'bilinear'), 1);
  assert.ok(Number.isNaN(core.sample(values, 2, 2, 0.25, 0, 'bilinear')));
});

test('sample rejects malformed grids, coordinates, and methods', () => {
  assert.throws(() => core.sample([1], 2, 1, 0, 0, 'nearest'), TypeError);
  assert.throws(() => core.sample([1], 1, 1, Infinity, 0, 'nearest'), TypeError);
  assert.throws(() => core.sample([1], 1, 1, 0, 0, 'cubic'), TypeError);
});

test('linear difference preserves zero and reports hand-calculated intersection metrics', () => {
  const a = new Float32Array([1, 2, 3, NaN, 5, 0]);
  const b = new Float32Array([2, 0, 7, 8, Infinity, 0]);
  const beforeA = Array.from(a);
  const beforeB = Array.from(b);
  const result = core.difference(a, b);
  assert.deepEqual(Array.from(result.values), [1, -2, 4, NaN, NaN, 0]);
  assert.deepEqual({count: result.stats.count, total: result.stats.total}, {count: 4, total: 6});
  close(result.stats.coverage, 2 / 3);
  close(result.stats.mean, 0.75);
  close(result.stats.mae, 1.75);
  close(result.stats.rmse, Math.sqrt(21 / 4));
  assert.equal(result.stats.min, -2);
  assert.equal(result.stats.max, 4);
  assert.deepEqual(Array.from(a), beforeA);
  assert.deepEqual(Array.from(b), beforeB);
});

test('degree and radian differences wrap to shortest signed changes', () => {
  assert.deepEqual(Array.from(core.difference([359, 1], [1, 359], 'degrees').values), [2, -2]);
  const phase = core.difference(
    [Math.PI - 0.1, -Math.PI + 0.1],
    [-Math.PI + 0.1, Math.PI - 0.1],
    'radians'
  ).values;
  close(phase[0], 0.2);
  close(phase[1], -0.2);
});

test('mask difference reports signed threshold transitions', () => {
  const result = core.difference([0, 0.5, 1, 0.49], [0.5, 0, 1, 0.51], 'mask');
  assert.deepEqual(Array.from(result.values), [1, -1, 0, 1]);
  assert.deepEqual(result.stats, {
    count: 4, total: 4, coverage: 1, mean: 0.25,
    mae: 0.75, rmse: Math.sqrt(3 / 4), min: -1, max: 1
  });
});

test('difference returns NaN statistics without finite overlap', () => {
  const result = core.difference([NaN, Infinity], [1, 2]);
  assert.deepEqual(Array.from(result.values), [NaN, NaN]);
  assert.deepEqual(
    {count: result.stats.count, total: result.stats.total, coverage: result.stats.coverage},
    {count: 0, total: 2, coverage: 0}
  );
  for (const key of ['mean', 'mae', 'rmse', 'min', 'max']) assert.ok(Number.isNaN(result.stats[key]));
});

test('difference rejects invalid arrays, lengths, and modes', () => {
  assert.throws(() => core.difference(null, []), TypeError);
  assert.throws(() => core.difference([1], []), TypeError);
  assert.throws(() => core.difference([1], [2], 'percent'), TypeError);
});
