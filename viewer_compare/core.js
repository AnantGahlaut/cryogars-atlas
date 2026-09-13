(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnowCompareCore = api;
}(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const MAX_CELLS = 2000000;

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function dimensions(w, h, limit) {
    if (!Number.isSafeInteger(w) || w <= 0 || !Number.isSafeInteger(h) || h <= 0 ||
        (limit && w * h > MAX_CELLS)) throw new TypeError('Invalid grid dimensions');
    return w * h;
  }

  function numericArray(value) {
    return Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
  }

  function decodeBytes(text, expected) {
    const pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    if (typeof text !== 'string' || !pattern.test(text)) throw new TypeError('Invalid base64 encoding');
    let bytes;
    try {
      if (typeof Buffer === 'function') bytes = new Uint8Array(Buffer.from(text, 'base64'));
      else {
        const raw = atob(text);
        bytes = Uint8Array.from(raw, function (char) { return char.charCodeAt(0); });
      }
    } catch (_) {
      throw new TypeError('Invalid base64 encoding');
    }
    if (bytes.length !== expected) throw new TypeError('Encoded byte length does not match dimensions');
    return bytes;
  }

  function decode(layer) {
    if (!layer || typeof layer !== 'object') throw new TypeError('Layer is required');
    const count = dimensions(layer.w, layer.h, true);
    if (layer.bits !== 8 && layer.bits !== 16) throw new TypeError('Only 8- and 16-bit layers are supported');
    if (!finite(layer.lo) || !finite(layer.hi) || layer.hi < layer.lo) {
      throw new TypeError('Invalid quantization range');
    }
    const bytes = decodeBytes(layer.b64, count * (layer.bits / 8));
    const values = new Float32Array(count);
    const scale = (layer.hi - layer.lo) / (2 ** layer.bits - 2);
    for (let i = 0; i < count; i += 1) {
      const q = layer.bits === 8 ? bytes[i] : bytes[i * 2] | (bytes[i * 2 + 1] << 8);
      values[i] = q === 0 ? NaN : layer.lo + (q - 1) * scale;
    }
    return values;
  }

  function grid(payload, layer) {
    if (!payload || !layer || !payload.grid || !payload.identification) {
      throw new TypeError('Payload grid metadata is required');
    }
    dimensions(layer.w, layer.h, true);
    const origin = payload.grid.origin;
    const epsg = payload.identification.common_crs_epsg;
    if (!Array.isArray(origin) || origin.length !== 2 || !origin.every(finite) ||
        !finite(layer.cell_m) || layer.cell_m <= 0 || !Number.isSafeInteger(epsg) || epsg <= 0) {
      throw new TypeError('Invalid grid metadata');
    }
    const pixel = payload.grid.pixel;
    if (pixel !== undefined && (!Array.isArray(pixel) || pixel.length !== 2 ||
        !finite(pixel[0]) || !finite(pixel[1]) || pixel[0] <= 0 || pixel[1] >= 0)) {
      throw new TypeError('Source grid must be north-up');
    }
    return {
      w: layer.w, h: layer.h, left: origin[0], top: origin[1],
      dx: layer.cell_m, dy: -layer.cell_m, epsg: epsg
    };
  }

  function validGrid(value) {
    return value && Number.isSafeInteger(value.w) && value.w > 0 &&
      Number.isSafeInteger(value.h) && value.h > 0 && finite(value.left) && finite(value.top) &&
      finite(value.dx) && value.dx > 0 && finite(value.dy) && value.dy < 0;
  }

  function center(gridValue, col, row) {
    if (!validGrid(gridValue) || !finite(col) || !finite(row)) throw new TypeError('Invalid grid coordinate');
    return [gridValue.left + (col + 0.5) * gridValue.dx,
      gridValue.top + (row + 0.5) * gridValue.dy];
  }

  function sample(values, width, height, x, y, method) {
    const count = dimensions(width, height, false);
    if (!numericArray(values) || values.length !== count || !finite(x) || !finite(y) ||
        (method !== 'nearest' && method !== 'bilinear')) throw new TypeError('Invalid sample input');
    if (x < -0.5 || x > width - 0.5 || y < -0.5 || y > height - 0.5) return NaN;
    if (method === 'nearest') {
      const col = Math.max(0, Math.min(width - 1, Math.floor(x + 0.5)));
      const row = Math.max(0, Math.min(height - 1, Math.floor(y + 0.5)));
      const value = values[row * width + col];
      return Number.isFinite(value) ? value : NaN;
    }
    const cx = Math.max(0, Math.min(width - 1, x));
    const cy = Math.max(0, Math.min(height - 1, y));
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = cx - x0;
    const ty = cy - y0;
    const terms = [
      [values[y0 * width + x0], (1 - tx) * (1 - ty)],
      [values[y0 * width + x1], tx * (1 - ty)],
      [values[y1 * width + x0], (1 - tx) * ty],
      [values[y1 * width + x1], tx * ty]
    ];
    let result = 0;
    for (const term of terms) {
      if (term[1] > 0 && !Number.isFinite(term[0])) return NaN;
      if (term[1] > 0) result += term[0] * term[1];
    }
    return result;
  }

  function difference(a, b, mode) {
    mode = mode === undefined ? 'linear' : mode;
    if (!numericArray(a) || !numericArray(b) || a.length !== b.length ||
        !['linear', 'degrees', 'radians', 'mask'].includes(mode)) {
      throw new TypeError('Invalid difference input');
    }
    const values = new Float32Array(a.length);
    values.fill(NaN);
    let count = 0;
    let sum = 0;
    let absolute = 0;
    let squared = 0;
    let min = Infinity;
    let max = -Infinity;
    const period = mode === 'degrees' ? 360 : 2 * Math.PI;
    for (let i = 0; i < a.length; i += 1) {
      if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
      let value = b[i] - a[i];
      if (mode === 'degrees' || mode === 'radians') {
        value = ((value + period / 2) % period + period) % period - period / 2;
      } else if (mode === 'mask') value = Number(b[i] >= 0.5) - Number(a[i] >= 0.5);
      values[i] = value;
      count += 1;
      sum += value;
      absolute += Math.abs(value);
      squared += value * value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const stats = {
      count: count,
      total: a.length,
      coverage: a.length ? count / a.length : 0,
      mean: count ? sum / count : NaN,
      mae: count ? absolute / count : NaN,
      rmse: count ? Math.sqrt(squared / count) : NaN,
      min: count ? min : NaN,
      max: count ? max : NaN
    };
    return {values: values, stats: stats};
  }

  return {
    decode: decode,
    grid: grid,
    center: center,
    sample: sample,
    difference: difference
  };
}));
