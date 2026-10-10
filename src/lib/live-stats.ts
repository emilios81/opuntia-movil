/*
 * OPC móvil — estadísticas del motor en vivo
 *
 * Copyright (C) 2025-2026  Emilio A. Villafañez
 * LATDAA – Universidad Nacional de Catamarca (UNCa), Argentina
 * GNU General Public License v3.0 o posterior. Ver LICENSE.
 *
 * Los filtros de decorrelación necesitan estadísticas de TODA la imagen antes
 * de procesar un solo píxel: medias, covarianzas, autovectores, vallas de Tukey,
 * histogramas. En vivo no se calculan sobre el cuadro entero (en 4K son ocho
 * millones de píxeles, treinta veces por segundo) sino sobre una muestra
 * puntual de unos 130.000, tomada en la GPU a intervalos regulares de la
 * grilla. Para medias y covarianzas es un estimador sin sesgo: la diferencia con
 * el cuadro entero queda en la tercera cifra decimal.
 *
 * Las cuentas son las del motor (meanCov3, meanStd1, jacobiEigen3, tukeyFences
 * y rgb2lab se importan de image-processing.ts, no se reescriben). Lo que se
 * agrega es lo propio del video:
 *
 *  - Suavizado temporal. Las estadísticas de cada muestra se mezclan con las
 *    anteriores con un tiempo de respuesta de ~0,35 s. Sin esto los colores
 *    "respiran" cuadro a cuadro con el ruido y con cada pequeño movimiento.
 *
 *  - Continuidad de la base en CRGB y DS-LAB. Jacobi entrega los autovectores
 *    con un signo y un orden que pueden saltar de un cuadro al siguiente
 *    aunque la escena casi no cambie; en esos dos filtros cada componente ES
 *    un canal de salida, así que el salto invierte un color de golpe (el
 *    pigmento pasa de magenta a verde). Mientras el video corre, cada base
 *    nueva se alinea con la anterior. Al cambiar de filtro se vuelve a la base
 *    canónica de Jacobi, la misma que daría el motor sobre esa imagen. LDS no
 *    lo necesita: reproyecta al RGB y el signo se cancela.
 */

import { meanCov3, meanStd1, jacobiEigen3, tukeyFences, rgb2lab, rojoMomentos, rojoEjes, RED_SIGMA, type RojoMomentos } from './image-processing';

// Muestra de la imagen: RGBA de 8 bits, un píxel cada `stride` en cada eje.
// El píxel (i, j) de la muestra es el (i·stride + stride/2, j·stride + stride/2)
// de la imagen completa, acotado al borde.
export interface StatsSample {
  data: Uint8Array;
  w: number;
  h: number;
  stride: number;
  fullW: number;
  fullH: number;
}

export type FilterUniforms =
  | { kind: 'none' }
  | { kind: 'L'; mL: number; stdL: number }
  | { kind: 'pca'; m: number[]; V: number[][]; s: number[]; lo: number[]; hi: number[] }
  | { kind: 'lds'; m: number[]; V: number[][]; w: number[]; gain: number; offset: number }
  | { kind: 'ybk'; mY: number; mCb: number; mCr: number; stdCb: number; stdCr: number }
  | { kind: 'red'; ma: number; mb: number; co: number; si: number; w1: number; w2: number }
  | { kind: 'clahe'; lut: Float32Array; nx: number; ny: number; tw: number; th: number; version: number };

// Filtros que necesitan estadísticas calculadas en la CPU. Desde v3.7.0
// también el Rojo, que es adaptativo (media y covarianza de a*, b*). Relieve y
// Micro-relieve solo usan máximos y mínimos, que se reducen en la GPU.
export const CPU_STATS_FILTERS = new Set(['red', 'white', 'black', 'bichrome', 'map', 'crgb', 'dslab', 'lds', 'ybk', 'clahe']);

const LDS_TUKEY_K = 3; // el mismo valor que el motor (ver lds() en image-processing.ts)

// --- Canales de la muestra ----------------------------------------------------

// rgb2lab sobre la muestra, con la linealización sRGB en tabla. Da exactamente
// los mismos números que rgb2lab del motor (la tabla guarda los mismos
// Math.pow para cada entero 0-255): solo evita recalcularlos ciento treinta mil
// veces por muestra.
const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
}
const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
function labU8(r: number, g: number, b: number, out: Float64Array, i: number) {
  const rr = LIN[r], gg = LIN[g], bb = LIN[b];
  const x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
  const y = (rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750);
  const z = (rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041) / 1.08883;
  out[i * 3] = 116 * labF(y) - 16;
  out[i * 3 + 1] = 500 * (labF(x) - labF(y));
  out[i * 3 + 2] = 200 * (labF(y) - labF(z));
}

// Verificación de la tabla contra el rgb2lab del motor: si alguna vez dejaran
// de coincidir, se usa el del motor y listo.
let labTableOk: boolean | null = null;
function labTableMatches(): boolean {
  if (labTableOk !== null) return labTableOk;
  const t = new Float64Array(3);
  labTableOk = true;
  for (let k = 0; k < 2000 && labTableOk; k++) {
    const r = (k * 37) & 255, g = (k * 101 + 13) & 255, b = (k * 173 + 71) & 255;
    labU8(r, g, b, t, 0);
    const ref = rgb2lab(r, g, b);
    if (t[0] !== ref[0] || t[1] !== ref[1] || t[2] !== ref[2]) labTableOk = false;
  }
  return labTableOk;
}

class SampleChannels {
  readonly n: number;
  private _rgb: [Float64Array, Float64Array, Float64Array] | null = null;
  private _lab: [Float64Array, Float64Array, Float64Array] | null = null;
  private _L32: Float32Array | null = null;
  constructor(readonly s: StatsSample) { this.n = s.w * s.h; }

  rgb() {
    if (!this._rgb) {
      const { data } = this.s, n = this.n;
      const R = new Float64Array(n), G = new Float64Array(n), B = new Float64Array(n);
      for (let i = 0; i < n; i++) { R[i] = data[i * 4]; G[i] = data[i * 4 + 1]; B[i] = data[i * 4 + 2]; }
      this._rgb = [R, G, B];
    }
    return this._rgb;
  }

  lab() {
    if (!this._lab) {
      const { data } = this.s, n = this.n;
      const L = new Float64Array(n), A = new Float64Array(n), B = new Float64Array(n);
      if (labTableMatches()) {
        const t = new Float64Array(3);
        for (let i = 0; i < n; i++) {
          labU8(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], t, 0);
          L[i] = t[0]; A[i] = t[1]; B[i] = t[2];
        }
      } else {
        for (let i = 0; i < n; i++) [L[i], A[i], B[i]] = rgb2lab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      }
      this._lab = [L, A, B];
    }
    return this._lab;
  }

  // Blanco, Negro, Bicromo y Mapa guardan L* en Float32Array: se respeta.
  L32() {
    if (!this._L32) {
      const [L] = this.lab();
      this._L32 = Float32Array.from(L);
    }
    return this._L32;
  }
}

// --- Estado suavizado por filtro ----------------------------------------------

interface Moments { means: number[]; cov: number[][] }
interface MeanVar { mean: number; v: number }

type Raw =
  | { kind: 'rgb'; mom: Moments }
  | { kind: 'lab'; mom: Moments }
  | { kind: 'L'; L: MeanVar }
  | { kind: 'ab'; mom: RojoMomentos }
  | { kind: 'ycc'; Y: MeanVar; Cb: MeanVar; Cr: MeanVar }
  | { kind: 'clahe'; frac: Float64Array; counts: Float64Array; nx: number; ny: number; tw: number; th: number; fullW: number; fullH: number };

function meanVar(arr: Float64Array | Float32Array): MeanVar {
  const { mean, std } = meanStd1(arr, null);
  // meanStd1 devuelve std || 1: se respeta ese piso al volver a desviación.
  return { mean, v: std * std };
}

function rawFor(filter: string, ch: SampleChannels): Raw | null {
  switch (filter) {
    case 'crgb':
    case 'lds': {
      const [R, G, B] = ch.rgb();
      return { kind: 'rgb', mom: meanCov3(R, G, B, null) };
    }
    case 'dslab': {
      const [L, A, B] = ch.lab();
      return { kind: 'lab', mom: meanCov3(L, A, B, null) };
    }
    case 'red': {
      const [, A, B] = ch.lab();
      return { kind: 'ab', mom: rojoMomentos(A, B, null) };
    }
    case 'white':
    case 'black':
    case 'bichrome':
    case 'map':
      return { kind: 'L', L: meanVar(ch.L32()) };
    case 'ybk': {
      const { data } = ch.s, n = ch.n;
      const Y = new Float64Array(n), Cb = new Float64Array(n), Cr = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
        Cb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        Cr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      }
      return { kind: 'ycc', Y: meanVar(Y), Cb: meanVar(Cb), Cr: meanVar(Cr) };
    }
    case 'clahe':
      return claheRaw(ch.s);
    default:
      return null;
  }
}

// Histogramas de luminancia por mosaico, con la misma geometría que clahe()
// del motor: grilla de 8x8, tamaño de mosaico redondeado hacia arriba. Cada
// muestra cae en el mosaico del píxel de la imagen completa que representa. Se
// guardan como fracciones, para poder mezclarlos entre muestras.
function claheRaw(s: StatsSample): Raw {
  const W = s.fullW, H = s.fullH;
  const tw = Math.ceil(W / 8), th = Math.ceil(H / 8);
  const nx = Math.ceil(W / tw), ny = Math.ceil(H / th), nT = nx * ny;
  const hist = new Float64Array(nT * 256), counts = new Float64Array(nT);
  const half = Math.floor(s.stride / 2);
  for (let j = 0; j < s.h; j++) {
    const y = Math.min(H - 1, j * s.stride + half);
    const tileY = Math.min(ny - 1, Math.floor(y / th));
    for (let i = 0; i < s.w; i++) {
      const x = Math.min(W - 1, i * s.stride + half);
      const t = tileY * nx + Math.min(nx - 1, Math.floor(x / tw));
      const k = (j * s.w + i) * 4;
      const lum = 0.299 * s.data[k] + 0.587 * s.data[k + 1] + 0.114 * s.data[k + 2];
      hist[t * 256 + Math.max(0, Math.min(255, Math.round(lum)))]++;
      counts[t]++;
    }
  }
  for (let t = 0; t < nT; t++) {
    const c = counts[t] || 1;
    for (let b = 0; b < 256; b++) hist[t * 256 + b] /= c;
  }
  return { kind: 'clahe', frac: hist, counts, nx, ny, tw, th, fullW: W, fullH: H };
}

function mixNum(a: number, b: number, t: number) { return a + (b - a) * t; }
function mixMoments(a: Moments, b: Moments, t: number): Moments {
  return {
    means: a.means.map((v, i) => mixNum(v, b.means[i], t)),
    cov: a.cov.map((row, i) => row.map((v, j) => mixNum(v, b.cov[i][j], t))),
  };
}
function mixMV(a: MeanVar, b: MeanVar, t: number): MeanVar { return { mean: mixNum(a.mean, b.mean, t), v: mixNum(a.v, b.v, t) }; }

function mixRaw(a: Raw, b: Raw, t: number): Raw {
  if (a.kind !== b.kind) return b;
  switch (a.kind) {
    case 'rgb':
    case 'lab':
      return { kind: a.kind, mom: mixMoments(a.mom, (b as typeof a).mom, t) };
    case 'L':
      return { kind: 'L', L: mixMV(a.L, (b as typeof a).L, t) };
    case 'ab': {
      const m = a.mom, n = (b as typeof a).mom;
      return { kind: 'ab', mom: { ma: mixNum(m.ma, n.ma, t), mb: mixNum(m.mb, n.mb, t), saa: mixNum(m.saa, n.saa, t), sab: mixNum(m.sab, n.sab, t), sbb: mixNum(m.sbb, n.sbb, t) } };
    }
    case 'ycc': {
      const bb = b as typeof a;
      return { kind: 'ycc', Y: mixMV(a.Y, bb.Y, t), Cb: mixMV(a.Cb, bb.Cb, t), Cr: mixMV(a.Cr, bb.Cr, t) };
    }
    case 'clahe': {
      const bb = b as typeof a;
      if (bb.fullW !== a.fullW || bb.fullH !== a.fullH) return b;
      const frac = new Float64Array(a.frac.length);
      for (let i = 0; i < frac.length; i++) frac[i] = mixNum(a.frac[i], bb.frac[i], t);
      return { ...bb, frac };
    }
  }
}

// --- Continuidad de la base de componentes principales -----------------------

const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Reordena y cambia de signo la base nueva para que cada vector quede lo más
// parecido posible al de la base anterior.
function alignBasis(prev: number[][], values: number[], vectors: number[][]) {
  let best = PERMS[0], bestScore = -Infinity;
  for (const p of PERMS) {
    const score = Math.abs(dot3(vectors[p[0]], prev[0])) + Math.abs(dot3(vectors[p[1]], prev[1])) + Math.abs(dot3(vectors[p[2]], prev[2]));
    if (score > bestScore + 1e-12) { bestScore = score; best = p; }
  }
  const vals = best.map(i => values[i]);
  const vecs = best.map((i, k) => {
    const v = vectors[i];
    return dot3(v, prev[k]) < 0 ? v.map(x => -x) : v.slice();
  });
  return { values: vals, vectors: vecs };
}

// --- Derivación de los uniformes ------------------------------------------------

export class LiveStats {
  private filter: string | null = null;
  private raw: Raw | null = null;
  private rawAt = 0;
  private version = 0;
  private channels: SampleChannels | null = null;
  private prevBasis: number[][] | null = null;
  private cache: { key: string; u: FilterUniforms } | null = null;
  private claheVersion = 0;

  /** Tiempo de respuesta del suavizado, en segundos. 0 = sin suavizado. */
  tau = 0.35;
  /** Alinear la base de CRGB/DS-LAB con la anterior (solo en video). */
  continuity = true;

  has(filter: string) { return this.filter === filter && this.raw !== null; }

  /** Olvida todo: la próxima muestra vuelve a ser la referencia canónica. */
  clear() {
    this.filter = null; this.raw = null; this.prevBasis = null; this.cache = null; this.channels = null;
  }

  /**
   * Incorpora una muestra nueva. `t` en segundos. Si el filtro cambió, la
   * muestra pasa a ser la referencia sin mezcla y la base vuelve a la canónica.
   */
  ingest(filter: string, sample: StatsSample, t: number) {
    const ch = new SampleChannels(sample);
    const cur = rawFor(filter, ch);
    if (!cur) return;
    if (this.filter !== filter || !this.raw || this.tau <= 0) {
      if (this.filter !== filter) this.prevBasis = null;
      this.filter = filter;
      this.raw = cur;
    } else {
      const a = 1 - Math.exp(-Math.max(0, t - this.rawAt) / this.tau);
      this.raw = mixRaw(this.raw, cur, a);
    }
    this.rawAt = t;
    this.channels = ch;
    this.version++;
  }

  derive(filter: string, I: number): FilterUniforms | null {
    if (this.filter !== filter || !this.raw || !this.channels) return null;
    const key = `${filter}|${I}|${this.version}`;
    if (this.cache && this.cache.key === key) return this.cache.u;
    const u = this.compute(filter, I, this.raw, this.channels);
    this.cache = { key, u };
    return u;
  }

  private basis(cov: number[][]) {
    let { values, vectors } = jacobiEigen3(cov);
    if (this.continuity && this.prevBasis) ({ values, vectors } = alignBasis(this.prevBasis, values, vectors));
    this.prevBasis = vectors.map(v => v.slice());
    return { values, vectors };
  }

  private compute(filter: string, I: number, raw: Raw, ch: SampleChannels): FilterUniforms {
    switch (raw.kind) {
      case 'L':
        return { kind: 'L', mL: raw.L.mean, stdL: Math.sqrt(raw.L.v) || 1 };

      // red() del motor: ejes de la covarianza promediada y pesos de la intensidad
      case 'ab': {
        const { ma, mb, saa, sab, sbb } = raw.mom;
        const st = rojoEjes(ma, mb, saa, sab, sbb);
        const objetivo = RED_SIGMA * I;
        return { kind: 'red', ma: st.ma, mb: st.mb, co: st.co, si: st.si, w1: objetivo / st.s1, w2: objetivo / st.s2 };
      }

      case 'ycc':
        return {
          kind: 'ybk', mY: raw.Y.mean, mCb: raw.Cb.mean, mCr: raw.Cr.mean,
          stdCb: Math.sqrt(raw.Cb.v) || 1, stdCr: Math.sqrt(raw.Cr.v) || 1,
        };

      case 'rgb':
      case 'lab': {
        const { means: m, cov } = raw.mom;
        if (filter === 'lds') return this.lds(I, m, cov, ch);
        // crgb() y dslab() del motor
        const { values, vectors: v } = this.basis(cov);
        const s = values.map(x => Math.sqrt(Math.max(x, 1e-10)));
        const [C0, C1, C2] = raw.kind === 'rgb' ? ch.rgb() : ch.lab();
        const n = ch.n;
        const pcs = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
        for (let i = 0; i < n; i++) {
          const d0 = C0[i] - m[0], d1 = C1[i] - m[1], d2 = C2[i] - m[2];
          for (let k = 0; k < 3; k++) pcs[k][i] = (v[k][0] * d0 + v[k][1] * d1 + v[k][2] * d2) / s[k];
        }
        const clipStd = Math.max(0.8, 3.5 / I);
        const lo: number[] = [], hi: number[] = [];
        for (let k = 0; k < 3; k++) {
          const { mean: pm, std: ps } = meanStd1(pcs[k], null);
          lo.push(pm - ps * clipStd); hi.push(pm + ps * clipStd);
        }
        return { kind: 'pca', m, V: v, s, lo, hi };
      }

      case 'clahe':
        return this.clahe(I, raw);
    }
  }

  // lds() del motor, sobre la muestra.
  private lds(I: number, m: number[], cov: number[][], ch: SampleChannels): FilterUniforms {
    const { values, vectors: v } = jacobiEigen3(cov);
    const stds = values.map(x => Math.sqrt(Math.max(x, 1e-10)));
    const tgtStd = (stds[0] + stds[1] + stds[2]) / 3;
    const gamma = Math.min(2.0, I / 1.5);
    const w = stds.map(s => Math.pow(tgtStd / s, gamma));

    const [R, G, B] = ch.rgb(), n = ch.n;
    const outR = new Float64Array(n), outG = new Float64Array(n), outB = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const d0 = R[i] - m[0], d1 = G[i] - m[1], d2 = B[i] - m[2];
      const p0 = v[0][0] * d0 + v[0][1] * d1 + v[0][2] * d2;
      const p1 = v[1][0] * d0 + v[1][1] * d1 + v[1][2] * d2;
      const p2 = v[2][0] * d0 + v[2][1] * d1 + v[2][2] * d2;
      outR[i] = m[0] + v[0][0] * p0 * w[0] + v[1][0] * p1 * w[1] + v[2][0] * p2 * w[2];
      outG[i] = m[1] + v[0][1] * p0 * w[0] + v[1][1] * p1 * w[1] + v[2][1] * p2 * w[2];
      outB[i] = m[2] + v[0][2] * p0 * w[0] + v[1][2] * p1 * w[1] + v[2][2] * p2 * w[2];
    }
    const canales = [outR, outG, outB];
    const hi = [0, 0, 0], lo = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const f = tukeyFences(canales[c], null, LDS_TUKEY_K);
      hi[c] = f.hi - m[c]; lo[c] = f.lo - m[c];
    }
    const alto = (s: number) => Math.max(m[0] + s * hi[0], m[1] + s * hi[1], m[2] + s * hi[2]);
    const bajo = (s: number) => Math.min(m[0] + s * lo[0], m[1] + s * lo[1], m[2] + s * lo[2]);
    let a = 0, b = 1000;
    for (let it = 0; it < 60; it++) { const mid = (a + b) / 2; if (alto(mid) - bajo(mid) <= 255) a = mid; else b = mid; }
    const gain = a, offset = ((255 - alto(gain)) + (0 - bajo(gain))) / 2;
    return { kind: 'lds', m, V: v, w, gain, offset };
  }

  // clahe() del motor: recorte con el límite que fija la intensidad, reparto
  // del excedente y curva acumulada. Los conteos son los de la muestra; como
  // todo se normaliza por el conteo del mosaico, la escala no cambia.
  private clahe(I: number, raw: Extract<Raw, { kind: 'clahe' }>): FilterUniforms {
    const nT = raw.nx * raw.ny;
    const lut = new Float32Array(nT * 256);
    const hist = new Float32Array(256);
    for (let t = 0; t < nT; t++) {
      const cnt = raw.counts[t] || 1;
      for (let b = 0; b < 256; b++) hist[b] = raw.frac[t * 256 + b] * cnt;
      const clipLimit = Math.max(1, (1 + I * 2) * cnt / 256);
      let excess = 0;
      for (let b = 0; b < 256; b++) { if (hist[b] > clipLimit) { excess += hist[b] - clipLimit; hist[b] = clipLimit; } }
      const add = excess / 256;
      let sum = 0;
      for (let b = 0; b < 256; b++) { sum += hist[b] + add; lut[t * 256 + b] = sum / cnt * 255; }
    }
    return { kind: 'clahe', lut, nx: raw.nx, ny: raw.ny, tw: raw.tw, th: raw.th, version: ++this.claheVersion };
  }
}
