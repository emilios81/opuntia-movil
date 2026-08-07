
/**
 * CORE IMAGE PROCESSING LOGIC - OPUNTIA COLOR v3.4.0
 * Implementation strictly aligned with scientific reference standards.
 */

// --- HELPERS ESTADÍSTICOS ---

export function meanCov3(ch1: Float32Array, ch2: Float32Array, ch3: Float32Array, mask: Uint8Array | null) {
  const n = ch1.length;
  let m1 = 0, m2 = 0, m3 = 0, count = 0;
  
  for (let i = 0; i < n; i++) {
    if (!mask || mask[i]) {
      m1 += ch1[i]; m2 += ch2[i]; m3 += ch3[i];
      count++;
    }
  }
  
  if (count === 0) return meanCov3(ch1, ch2, ch3, null);
  
  m1 /= count; m2 /= count; m3 /= count;
  
  let c11=0, c12=0, c13=0, c22=0, c23=0, c33=0;
  for (let i = 0; i < n; i++) {
    if (!mask || mask[i]) {
      const d1 = ch1[i] - m1, d2 = ch2[i] - m2, d3 = ch3[i] - m3;
      c11 += d1 * d1; c12 += d1 * d2; c13 += d1 * d3;
      c22 += d2 * d2; c23 += d2 * d3; c33 += d3 * d3;
    }
  }
  
  const eps = 1e-10;
  return {
    means: [m1, m2, m3],
    cov: [
      [c11/count + eps, c12/count, c13/count],
      [c12/count, c22/count + eps, c23/count],
      [c13/count, c23/count, c33/count + eps]
    ]
  };
}

export function meanStd1(arr: Float32Array, mask: Uint8Array | null) {
  const n = arr.length;
  let sum = 0, count = 0;
  for (let i = 0; i < n; i++) {
    if (!mask || mask[i]) { sum += arr[i]; count++; }
  }
  if (count === 0) return meanStd1(arr, null);
  const mean = sum / count;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    if (!mask || mask[i]) varSum += (arr[i] - mean) ** 2;
  }
  const std = Math.sqrt(varSum / count);
  return { mean, std: std || 1 };
}

export function jacobiEigen3(cov: number[][]) {
  let a = cov.map(row => [...row]);
  let v = [[1,0,0], [0,1,0], [0,0,1]];
  
  for (let iter = 0; iter < 50; iter++) {
    let maxVal = 0, p = 0, q = 1;
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        if (Math.abs(a[i][j]) > maxVal) { maxVal = Math.abs(a[i][j]); p = i; q = j; }
      }
    }
    if (maxVal < 1e-12) break;
    
    const theta = 0.5 * Math.atan2(2 * a[p][q], a[p][p] - a[q][q]);
    const c = Math.cos(theta), s = Math.sin(theta);
    
    // Rotación de columnas para todas las filas
    for (let i = 0; i < 3; i++) {
      const gip = a[i][p], giq = a[i][q];
      a[i][p] = c * gip + s * giq;
      a[i][q] = -s * gip + c * giq;
      
      const vip = v[i][p], viq = v[i][q];
      v[i][p] = c * vip + s * viq;
      v[i][q] = -s * vip + c * viq;
    }
    
    // Rotación de filas para las filas p y q
    for (let j = 0; j < 3; j++) {
      const apj = a[p][j], aqj = a[q][j];
      a[p][j] = c * apj + s * aqj;
      a[q][j] = -s * apj + c * aqj;
    }
  }

  const eigenvalues = [a[0][0], a[1][1], a[2][2]];
  const indices = [0, 1, 2].sort((i, j) => eigenvalues[j] - eigenvalues[i]);
  
  return {
    values: indices.map(i => eigenvalues[i]),
    vectors: indices.map(i => [v[0][i], v[1][i], v[2][i]])
  };
}

export function buildSAT(data: Float32Array, w: number, h: number): Float64Array {
  const sat = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += data[y * w + x];
      sat[y * w + x] = rowSum + (y > 0 ? sat[(y - 1) * w + x] : 0);
    }
  }
  return sat;
}

export function satMean(sat: Float64Array, w: number, h: number, x: number, y: number, r: number): number {
  const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
  const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
  const area = (x1 - x0 + 1) * (y1 - y0 + 1);
  let sum = sat[y1 * w + x1];
  if (x0 > 0) sum -= sat[y1 * w + (x0 - 1)];
  if (y0 > 0) sum -= sat[(y0 - 1) * w + x1];
  if (x0 > 0 && y0 > 0) sum += sat[(y0 - 1) * w + (x0 - 1)];
  return sum / area;
}

// --- COLOR SPACE ---

export function rgb2lab(r: number, g: number, b: number): [number, number, number] {
  let rr = r / 255, gg = g / 255, bb = b / 255;
  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;
  let x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
  let y = (rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750);
  let z = (rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041) / 1.08883;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function lab2rgb(L: number, a: number, b: number): [number, number, number] {
  let y = (L + 16) / 116, x = a / 500 + y, z = y - b / 200;
  const fi = (t: number) => t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787;
  let rr = fi(x) * 0.95047 * 3.2404542 - fi(y) * 1.5371385 - fi(z) * 1.08883 * 0.4985314;
  let gg = -fi(x) * 0.95047 * 0.9692660 + fi(y) * 1.8760108 + fi(z) * 1.08883 * 0.0415560;
  let bb = fi(x) * 0.95047 * 0.0556434 - fi(y) * 0.2040259 + fi(z) * 1.08883 * 1.0572252;
  const g = (c: number) => c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;
  return [Math.round(g(rr) * 255), Math.round(g(gg) * 255), Math.round(g(bb) * 255)];
}

// --- FILTROS v3.4.0 ---

export function red(imageData: ImageData, I: number, mask: Uint8Array | null) {
  const data = imageData.data, n = data.length / 4, out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) { out.set(data.slice(i * 4, i * 4 + 4), i * 4); continue; }
    let [L, a, b] = rgb2lab(data[i*4], data[i*4+1], data[i*4+2]);
    const a_ = Math.max(-128, Math.min(127, a * I));
    const b_ = Math.max(-128, Math.min(127, b * (1 + (I - 1) * 0.3)));
    const L_ = Math.max(0, Math.min(100, L + (a > 0 ? (I - 1) * 8 : -(I - 1) * 5)));
    const [r, g, b_val] = lab2rgb(L_, a_, b_);
    out[i*4] = r; out[i*4+1] = g; out[i*4+2] = b_val; out[i*4+3] = 255;
  }
  return new ImageData(out, imageData.width, imageData.height);
}

export function white(imageData: ImageData, I: number, mask: Uint8Array | null, store: any) {
  const data = imageData.data, n = data.length / 4, out = new Uint8ClampedArray(data.length);
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = rgb2lab(data[i*4], data[i*4+1], data[i*4+2])[0];
  
  if (!store.frozen) store.frozen = meanStd1(L, mask);
  const { mean: mL, std: stdL } = store.frozen;

  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) { out.set(data.slice(i * 4, i * 4 + 4), i * 4); continue; }
    let [Li, ai, bi] = rgb2lab(data[i*4], data[i*4+1], data[i*4+2]);
    const z = (Li - mL) / stdL;
    const boost = z > 0 ? z * I * 5 : z * I * 2;
    const sf = Li > mL ? 1 / (1 + (I - 1) * 0.5) : 1;
    const [r, g, b] = lab2rgb(Math.max(0, Math.min(100, Li + boost)), ai * sf, bi * sf);
    out[i*4] = r; out[i*4+1] = g; out[i*4+2] = b; out[i*4+3] = 255;
  }
  return new ImageData(out, imageData.width, imageData.height);
}

export function black(imageData: ImageData, I: number, mask: Uint8Array | null, store: any) {
  const data = imageData.data, n = data.length / 4, out = new Uint8ClampedArray(data.length);
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = rgb2lab(data[i*4], data[i*4+1], data[i*4+2])[0];
  
  if (!store.frozen) store.frozen = meanStd1(L, mask);
  const { mean: mL, std: stdL } = store.frozen;

  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) { out.set(data.slice(i * 4, i * 4 + 4), i * 4); continue; }
    let [Li, ai, bi] = rgb2lab(data[i*4], data[i*4+1], data[i*4+2]);
    const ch = Math.hypot(ai, bi), z = (Li - mL) / stdL;
    let nL = Li, na = ai, nb = bi;
    if (Li < mL && ch < 20) {
      const df = (mL - Li) / (mL || 1);
      nL = Li - df * I * 18;
      const cr = 1 / (1 + (I - 1) * 0.8);
      na *= cr; nb *= cr;
    } else {
      nL = Li + Math.max(0, z) * I * 3;
      na *= (1 + (I - 1) * 0.15);
      nb *= (1 + (I - 1) * 0.15);
    }
    const [r, g, b] = lab2rgb(Math.max(0, Math.min(100, nL)), na, nb);
    out[i*4] = r; out[i*4+1] = g; out[i*4+2] = b; out[i*4+3] = 255;
  }
  return new ImageData(out, imageData.width, imageData.height);
}

export function bichrome(imageData: ImageData, I: number, mask: Uint8Array | null, store: any) {
  const data = imageData.data, n = data.length / 4, out = new Uint8ClampedArray(data.length);
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = rgb2lab(data[i*4], data[i*4+1], data[i*4+2])[0];
  if (!store.frozen) store.frozen = { mL: meanStd1(L, mask).mean };
  const { mL } = store.frozen;

  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) { out.set(data.slice(i * 4, i * 4 + 4), i * 4); continue; }
    let [Li, ai, bi] = rgb2lab(data[i*4], data[i*4+1], data[i*4+2]);
    const ch = Math.hypot(ai, bi);
    const rb = ai > 5 ? I * 1.3 : (ai > 0 ? I : 1);
    const isW = Li > mL && ch < 25;
    const wb = isW ? (Li - mL) * I * 0.15 : 0;
    const nL = Math.max(0, Math.min(100, Li + wb));
    const isR = !isW && ai < 5 && Li < mL;
    const rs = isR ? 0.7 : 1;
    const [r, g, b] = lab2rgb(nL * rs + (1 - rs) * (nL * 0.6), ai * rb, bi * (isW ? 0.5 : 1));
    out[i*4] = r; out[i*4+1] = g; out[i*4+2] = b; out[i*4+3] = 255;
  }
  return new ImageData(out, imageData.width, imageData.height);
}

export function crgb(imageData: ImageData, I: number, mask: Uint8Array | null, store: any) {
  const data = imageData.data, n = data.length / 4, out = new Uint8ClampedArray(data.length);
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { R[i] = data[i*4]; G[i] = data[i*4+1]; B[i] = data[i*4+2]; }

  if (!store.frozen) {
    const { means, cov } = meanCov3(R, G, B, mask);
    const { values, vectors } = jacobiEigen3(cov);
    store.frozen = { means, vectors, stds: values.map(v => Math.sqrt(Math.max(v, 1e-10))) };
  }
  const { means: m, vectors: v, stds: s } = store.frozen;

  const clipStd = Math.max(0.8, 3.5 / I);
  const pcs = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  
  for (let i = 0; i < n; i++) {
    const d = [R[i] - m[0], G[i] - m[1], B[i] - m[2]];
    for (let k = 0; k < 3; k++) {
      pcs[k][i] = (v[k][0] * d[0] + v[k][1] * d[1] + v[k][2] * d[2]) / s[k];
    }
  }

  for (let k = 0; k < 3; k++) {
    const { mean: pm, std: ps } = meanStd1(pcs[k], mask);
    const lo = pm - ps * clipStd, hi = pm + ps * clipStd, range = hi - lo || 1;
    for (let i = 0; i < n; i++) {
      if (mask && !mask[i]) { if (k === 0) out.set(data.slice(i * 4, i * 4 + 4), i * 4); continue; }
      const val = Math.max(lo, Math.min(hi, pcs[k][i]));
      out[i * 4 + k] = Math.round(((val - lo) / range) * 255);
    }
  }
  for (let i = 0; i < n; i++) out[i*4+3] = 255;
  return new ImageData(out, imageData.width, imageData.height);
}

export function dslab(imageData: ImageData, I: number, mask: Uint8Array | null, store: any) {
  const data = imageData.data, n = data.length / 4, out = new Uint8ClampedArray(data.length);
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) [L[i], A[i], B[i]] = rgb2lab(data[i*4], data[i*4+1], data[i*4+2]);

  if (!store.frozen) {
    const { means, cov } = meanCov3(L, A, B, mask);
    const { values, vectors } = jacobiEigen3(cov);
    store.frozen = { means, vectors, stds: values.map(v => Math.sqrt(Math.max(v, 1e-10))) };
  }
  const { means: m, vectors: v, stds: s } = store.frozen;

  const clipStd = Math.max(0.8, 3.5 / I);
  const pcs = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const d = [L[i] - m[0], A[i] - m[1], B[i] - m[2]];
    for (let k = 0; k < 3; k++) pcs[k][i] = (v[k][0] * d[0] + v[k][1] * d[1] + v[k][2] * d[2]) / s[k];
  }

  for (let k = 0; k < 3; k++) {
    const { mean: pm, std: ps } = meanStd1(pcs[k], mask);
    const lo = pm - ps * clipStd, hi = pm + ps * clipStd, range = hi - lo || 1;
    for (let i = 0; i < n; i++) {
      if (mask && !mask[i]) { if (k === 0) out.set(data.slice(i * 4, i * 4 + 4), i * 4); continue; }
      const val = Math.max(lo, Math.min(hi, pcs[k][i]));
      out[i * 4 + k] = Math.round(((val - lo) / range) * 255);
    }
  }
  for (let i = 0; i < n; i++) out[i*4+3] = 255;
  return new ImageData(out, imageData.width, imageData.height);
}

export function lds(imageData: ImageData, I: number, mask: Uint8Array | null, store: any) {
  const data = imageData.data, n = data.length / 4, out = new Uint8ClampedArray(data.length);
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { R[i] = data[i*4]; G[i] = data[i*4+1]; B[i] = data[i*4+2]; }

  if (!store.frozen) {
    const { means, cov } = meanCov3(R, G, B, mask);
    const { values, vectors } = jacobiEigen3(cov);
    const stds = values.map(v => Math.sqrt(Math.max(v, 1e-10)));
    store.frozen = { means, vectors, stds };
  }
  const { means: m, vectors: v, stds } = store.frozen;

  // Los pesos se recalculan SIEMPRE: dependen de la intensidad. Si se
  // congelaran junto con la base de componentes, mover la intensidad no
  // tendría ningún efecto — que es justo el defecto que v3.4.0 corrigió.
  const tgtStd = (stds[0] + stds[1] + stds[2]) / 3;
  const gamma = Math.min(2.0, I / 1.5);
  const w = stds.map((s: number) => Math.pow(tgtStd / s, gamma));

  const outR = new Float32Array(n), outG = new Float32Array(n), outB = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = [R[i] - m[0], G[i] - m[1], B[i] - m[2]];
    const pcs = v.map((vec: number[]) => (vec[0] * d[0] + vec[1] * d[1] + vec[2] * d[2]));
    outR[i] = m[0] + v[0][0]*pcs[0]*w[0] + v[1][0]*pcs[1]*w[1] + v[2][0]*pcs[2]*w[2];
    outG[i] = m[1] + v[0][1]*pcs[0]*w[0] + v[1][1]*pcs[1]*w[1] + v[2][1]*pcs[2]*w[2];
    outB[i] = m[2] + v[0][2]*pcs[0]*w[0] + v[1][2]*pcs[1]*w[1] + v[2][2]*pcs[2]*w[2];
  }

  // Los valores reproyectados no están acotados a 0-255: el rango arranca en
  // ±Infinity o el mínimo/máximo real quedaría recortado por la inicialización.
  let minR=Infinity, maxR=-Infinity, minG=Infinity, maxG=-Infinity, minB=Infinity, maxB=-Infinity;
  for (let i = 0; i < n; i++) {
    if (!mask || mask[i]) {
      if (outR[i] < minR) minR = outR[i]; if (outR[i] > maxR) maxR = outR[i];
      if (outG[i] < minG) minG = outG[i]; if (outG[i] > maxG) maxG = outG[i];
      if (outB[i] < minB) minB = outB[i]; if (outB[i] > maxB) maxB = outB[i];
    }
  }
  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) { out.set(data.slice(i * 4, i * 4 + 4), i * 4); continue; }
    out[i*4] = Math.round(((outR[i] - minR) / (maxR - minR || 1)) * 255);
    out[i*4+1] = Math.round(((outG[i] - minG) / (maxG - minG || 1)) * 255);
    out[i*4+2] = Math.round(((outB[i] - minB) / (maxB - minB || 1)) * 255);
    out[i*4+3] = 255;
  }
  return new ImageData(out, imageData.width, imageData.height);
}

export function petro(imageData: ImageData, I: number, mask: Uint8Array | null, store: any) {
  const w = imageData.width, h = imageData.height, n = w * h;
  const data = imageData.data, out = new Uint8ClampedArray(data.length);
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) [L[i], A[i], B[i]] = rgb2lab(data[i*4], data[i*4+1], data[i*4+2]);

  if (!store.frozen) {
    let minA=Infinity, maxA=-Infinity, minB=Infinity, maxB=-Infinity;
    for (let i = 0; i < n; i++) {
      if (!mask || mask[i]) {
        if (A[i] < minA) minA = A[i]; if (A[i] > maxA) maxA = A[i];
        if (B[i] < minB) minB = B[i]; if (B[i] > maxB) maxB = B[i];
      }
    }
    store.frozen = { midA: (minA + maxA) / 2, midB: (minB + maxB) / 2 };
  }
  const { midA, midB } = store.frozen;
  // La tabla de sumas acumuladas describe ESTA imagen: se calcula siempre.
  // Congelarla reutilizaría los promedios locales de otra foto (o, en vivo,
  // los del primer cuadro) y el micro-relieve saldría mal.
  const satL = buildSAT(L, w, h);
  const rS = Math.max(8, Math.floor(Math.min(w, h) / 40)), rL = Math.max(24, Math.floor(Math.min(w, h) / 10));

  let maxEdge = 0; const edges = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const gx = -L[idx-w-1] + L[idx-w+1] - 2*L[idx-1] + 2*L[idx+1] - L[idx+w-1] + L[idx+w+1];
      const gy = -L[idx-w-1] - 2*L[idx-w] - L[idx-w+1] + L[idx+w-1] + 2*L[idx+w] + L[idx+w+1];
      edges[idx] = Math.sqrt(gx*gx + gy*gy);
      if (edges[idx] > maxEdge) maxEdge = edges[idx];
    }
  }

  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) { out.set(data.slice(i * 4, i * 4 + 4), i * 4); continue; }
    const x = i % w, y = Math.floor(i / w);
    const mS = satMean(satL, w, h, x, y, rS), mLg = satMean(satL, w, h, x, y, rL);
    const Lloc = L[i] + (L[i] - mS)*I*2.5*0.6 + (L[i] - mLg)*I*1.2*0.4;
    const nL = Math.max(0, Math.min(100, Lloc + (edges[i] / (maxEdge || 1)) * 20 * (I * 0.25)));
    const [r, g, b] = lab2rgb(nL, midA + (A[i] - midA) * I * 3, midB + (B[i] - midB) * I * 3);
    out[i*4] = r; out[i*4+1] = g; out[i*4+2] = b; out[i*4+3] = 255;
  }
  return new ImageData(out, w, h);
}

export function relief(imageData: ImageData, I: number, mask: Uint8Array | null) {
  const w = imageData.width, h = imageData.height, n = w * h, out = new Uint8ClampedArray(imageData.data.length);
  const lum = new Float64Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.299*imageData.data[i*4] + 0.587*imageData.data[i*4+1] + 0.114*imageData.data[i*4+2];

  let maxEdge = 0; const edges = new Float64Array(n);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const idx = y * w + x;
      const g3x = -lum[idx-w-1]+lum[idx-w+1]-2*lum[idx-1]+2*lum[idx+1]-lum[idx+w-1]+lum[idx+w+1];
      const g3y = -lum[idx-w-1]-2*lum[idx-w]-lum[idx-w+1]+lum[idx+w-1]+2*lum[idx+w]+lum[idx+w+1];
      const g5x = -lum[idx-2*w-2]+lum[idx-2*w+2]-2*lum[idx-2]+2*lum[idx+2]-lum[idx+2*w-2]+lum[idx+2*w+2];
      const g5y = -lum[idx-2*w-2]-2*lum[idx-2*w]-lum[idx-2*w+2]+lum[idx+2*w-2]+2*lum[idx+2*w]+lum[idx+2*w+2];
      edges[idx] = Math.sqrt(g3x*g3x + g3y*g3y) * 0.65 + Math.sqrt(g5x*g5x + g5y*g5y) * 0.35;
      if (edges[idx] > maxEdge) maxEdge = edges[idx];
    }
  }

  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) { out.set(imageData.data.slice(i * 4, i * 4 + 4), i * 4); continue; }
    const e = Math.pow(Math.min(1, (edges[i] / (maxEdge || 1)) * I * 1.2), 0.7);
    const v = Math.round(e * 255);
    out[i*4] = Math.min(255, Math.round(v * 1.05)); out[i*4+1] = Math.min(255, Math.round(v * 0.92)); out[i*4+2] = Math.min(255, Math.round(v * 0.78)); out[i*4+3] = 255;
  }
  return new ImageData(out, w, h);
}

export function ybk(imageData: ImageData, I: number, mask: Uint8Array | null, store: any) {
  const data = imageData.data, n = data.length / 4, out = new Uint8ClampedArray(data.length);
  const Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Y[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2];
    Cb[i] = 128 - 0.168736*data[i*4] - 0.331264*data[i*4+1] + 0.5*data[i*4+2];
    Cr[i] = 128 + 0.5*data[i*4] - 0.418688*data[i*4+1] - 0.081312*data[i*4+2];
  }
  
  if (!store.frozen) {
    const sY = meanStd1(Y, mask), sCb = meanStd1(Cb, mask), sCr = meanStd1(Cr, mask);
    store.frozen = { mY: sY.mean, mCb: sCb.mean, mCr: sCr.mean, stdCb: sCb.std, stdCr: sCr.std };
  }
  const { mY, mCb, mCr, stdCb, stdCr } = store.frozen;
  const chromaBoost = I * 3.0, lumaContrast = 1 + (I - 1) * 0.6;

  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) { out.set(data.slice(i * 4, i * 4 + 4), i * 4); continue; }
    // Y, Cb y Cr se acotan a 0-255 ANTES de volver a RGB, igual que en la
    // referencia. Dejarlos desbordar y recortar solo el RGB final cambia el
    // color resultante (no solo su brillo) en cuanto la crominancia se pasa.
    const y_ = Math.max(0, Math.min(255, mY + (Y[i] - mY) * lumaContrast));
    const cb_ = Math.max(0, Math.min(255, 128 + ((Cb[i] - mCb) / stdCb) * 40 * chromaBoost));
    const cr_ = Math.max(0, Math.min(255, 128 + ((Cr[i] - mCr) / stdCr) * 40 * chromaBoost));
    const r = y_ + 1.402 * (cr_ - 128), g = y_ - 0.344136 * (cb_ - 128) - 0.714136 * (cr_ - 128), b = y_ + 1.772 * (cb_ - 128);
    out[i*4] = Math.max(0, Math.min(255, r));
    out[i*4+1] = Math.max(0, Math.min(255, g));
    out[i*4+2] = Math.max(0, Math.min(255, b));
    out[i*4+3] = 255;
  }
  return new ImageData(out, imageData.width, imageData.height);
}

export function clahe(imageData: ImageData, I: number, mask: Uint8Array | null) {
  const w = imageData.width, h = imageData.height, n = w * h, data = imageData.data;
  // Luminancia en 0-255 y doble precisión: en 0-1 y Float32 el redondeo al bin
  // del histograma cae del otro lado en los valores de borde.
  const lum = new Float64Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2];

  // Grilla de 8x8: el tamaño de tile se redondea hacia ARRIBA para que los
  // tiles del borde derecho/inferior no reciban los píxeles sobrantes de sus
  // vecinos, y cada histograma se normaliza por su cuenta real de píxeles.
  const tw = Math.ceil(w / 8), th = Math.ceil(h / 8);
  const nx = Math.ceil(w / tw), ny = Math.ceil(h / th);
  const histograms = Array.from({ length: nx * ny }, () => new Float32Array(256));
  const counts = new Float64Array(nx * ny);

  for (let y = 0; y < h; y++) {
    const tileY = Math.min(ny - 1, Math.floor(y / th));
    for (let x = 0; x < w; x++) {
      const tileX = Math.min(nx - 1, Math.floor(x / tw));
      const t = tileY * nx + tileX;
      histograms[t][Math.max(0, Math.min(255, Math.round(lum[y * w + x])))]++;
      counts[t]++;
    }
  }

  const maps = histograms.map((hist, t) => {
    const cnt = counts[t] || 1;
    const clipLimit = Math.max(1, (1 + I * 2) * cnt / 256);
    let excess = 0;
    for (let i = 0; i < 256; i++) { if (hist[i] > clipLimit) { excess += hist[i] - clipLimit; hist[i] = clipLimit; } }
    const add = excess / 256;
    let sum = 0; const cdf = new Float64Array(256);
    for (let i = 0; i < 256; i++) { sum += hist[i] + add; cdf[i] = sum / cnt * 255; }
    return cdf;
  });

  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask && !mask[x + y * w]) { out.set(data.slice((x + y * w) * 4, (x + y * w) * 4 + 4), (x + y * w) * 4); continue; }
      // La posición fraccional se acota ANTES de partirla en índice + resto:
      // sin eso, los píxeles del borde superior/izquierdo dan un resto negativo
      // y la interpolación sale con pesos negativos (halos en los bordes).
      const fxc = Math.max(0, Math.min(nx - 1, (x - tw / 2) / tw));
      const fyc = Math.max(0, Math.min(ny - 1, (y - th / 2) / th));
      const x1 = Math.floor(fxc), x2 = Math.min(nx - 1, x1 + 1);
      const y1 = Math.floor(fyc), y2 = Math.min(ny - 1, y1 + 1);
      const fx = fxc - x1, fy = fyc - y1;
      const val = Math.max(0, Math.min(255, Math.round(lum[y * w + x])));
      const newLum = (1-fx)*(1-fy)*maps[y1*nx+x1][val] + fx*(1-fy)*maps[y1*nx+x2][val] + (1-fx)*fy*maps[y2*nx+x1][val] + fx*fy*maps[y2*nx+x2][val];
      const ratio = lum[y*w+x] > 0.5 ? newLum / lum[y*w+x] : 1;
      out[(y*w+x)*4] = Math.min(255, data[(y*w+x)*4] * ratio);
      out[(y*w+x)*4+1] = Math.min(255, data[(y*w+x)*4+1] * ratio);
      out[(y*w+x)*4+2] = Math.min(255, data[(y*w+x)*4+2] * ratio);
      out[(y*w+x)*4+3] = 255;
    }
  }
  return new ImageData(out, w, h);
}

export function map(imageData: ImageData, I: number, mask: Uint8Array | null, store: any) {
  const data = imageData.data, n = data.length / 4, out = new Uint8ClampedArray(data.length);
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = rgb2lab(data[i*4], data[i*4+1], data[i*4+2])[0];
  if (!store.frozen) store.frozen = { mL: meanStd1(L, mask).mean };
  const { mL } = store.frozen;

  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) { out.set(data.slice(i * 4, i * 4 + 4), i * 4); continue; }
    const [Li, ai, bi] = rgb2lab(data[i*4], data[i*4+1], data[i*4+2]), ch = Math.hypot(ai, bi);
    if (ai > 8 && ch > 12) {
      const ri = Math.min(1, ai / 40); out[i*4] = 255 * ri; out[i*4+1] = 80 * (1 - ri); out[i*4+2] = 0;
    } else if (Li < mL - 10 && ch < 15) {
      const bi_ = Math.min(1, (mL - Li) / (mL * 0.6)); out[i*4] = 40 * (1 - bi_); out[i*4+1] = 200 + 55 * bi_; out[i*4+2] = 40 * (1 - bi_);
    } else if (Li > 65 && ch < 18) {
      const wi = Math.min(1, (Li - 65) / 35); out[i*4] = 100 * (1 - wi); out[i*4+1] = 200 + 55 * wi; out[i*4+2] = 220 + 35 * wi;
    } else {
      const g = Math.min(255, Li * 1.2); out[i*4] = out[i*4+1] = out[i*4+2] = g;
    }
    out[i*4+3] = 255;
  }
  return new ImageData(out, imageData.width, imageData.height);
}

export function applyPostProcessing(imageData: ImageData, contrast: number, saturation: number) {
  const data = imageData.data, n = data.length / 4, out = new Uint8ClampedArray(data.length);
  const k = 1 + contrast / 100, ko = 127.5 * (1 - k), s = 1 + saturation / 100;
  for (let i = 0; i < n; i++) {
    const r1 = data[i*4] * k + ko, g1 = data[i*4+1] * k + ko, b1 = data[i*4+2] * k + ko;
    const lum = 0.213 * (1 - s) * r1 + 0.715 * (1 - s) * g1 + 0.072 * (1 - s) * b1;
    out[i*4] = Math.max(0, Math.min(255, lum + s * r1));
    out[i*4+1] = Math.max(0, Math.min(255, lum + s * g1));
    out[i*4+2] = Math.max(0, Math.min(255, lum + s * b1));
    out[i*4+3] = 255;
  }
  return new ImageData(out, imageData.width, imageData.height);
}

