/*
 * OPC móvil — página de verificación del motor en vivo (ver tests/verificar-gpu.js)
 *
 * Copyright (C) 2025-2026  Emilio A. Villafañez
 * LATDAA – Universidad Nacional de Catamarca (UNCa), Argentina
 * GNU General Public License v3.0 o posterior. Ver LICENSE.
 */

import * as CPU from '/motor/image-processing.js';
import { LiveEngine } from '/motor/live-gpu.js';

const FILTROS = ['red', 'white', 'black', 'bichrome', 'crgb', 'dslab', 'lds', 'petro', 'relief', 'ybk', 'clahe', 'map'];

// ------------------------------------------------------------ imágenes de prueba
// Deterministas: la prueba da lo mismo en cualquier máquina.

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function generar(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fn(x, y, w, h);
    const i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  return new ImageData(d, w, h);
}

// Las mismas que tests/comparar-con-escritorio.js.
function panel(conTarjeta) {
  const rnd = lcg(12345);
  return generar(120, 90, (x, y, w, h) => {
    const base = 110 + 30 * Math.sin(x / 17) + 20 * Math.cos(y / 13);
    let r = base * 1.15, g = base * 0.92, b = base * 0.70;
    const dx = x - w / 2, dy = y - h / 2;
    if (dx * dx / 400 + dy * dy / 150 < 1) { r += 14; g -= 4; b -= 6; }
    if (conTarjeta && x < 22 && y < 22) {
      const p = (x < 11 ? 0 : 1) + (y < 11 ? 0 : 2);
      return [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]][p];
    }
    return [r + rnd() * 3, g + rnd() * 3, b + rnd() * 3];
  });
}

// Roca con textura fractal, manchas de color, motivos tenues en rojo, blanco y
// negro, y ruido de sensor: lo más parecido a una foto de campo sin usar una.
function roca(w, h, seed, conTarjeta) {
  const rnd = lcg(seed);
  const octavas = [];
  for (let k = 0; k < 6; k++) {
    const celda = Math.max(2, Math.round(Math.min(w, h) / (5 * 2 ** k)));
    const gw = Math.ceil(w / celda) + 2, gh = Math.ceil(h / celda) + 2;
    const g = new Float32Array(gw * gh * 2);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    octavas.push({ celda, gw, g, amp: 0.55 ** k });
  }
  const suave = t => t * t * (3 - 2 * t);
  function ruido(x, y, canal) {
    let s = 0, n = 0;
    for (const o of octavas) {
      const fx = x / o.celda, fy = y / o.celda, ix = fx | 0, iy = fy | 0;
      const tx = suave(fx - ix), ty = suave(fy - iy);
      const at = (i, j) => o.g[((iy + j) * o.gw + ix + i) * 2 + canal];
      const v = (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - ty) + (at(0, 1) * (1 - tx) + at(1, 1) * tx) * ty;
      s += v * o.amp; n += o.amp;
    }
    return s / n;
  }
  const m = Math.min(w, h);
  const motivos = [];
  for (let k = 0; k < 9; k++) {
    motivos.push({
      cx: w * (0.15 + 0.7 * rnd()), cy: h * (0.15 + 0.7 * rnd()),
      rx: m * (0.03 + 0.08 * rnd()), ry: m * (0.01 + 0.04 * rnd()), ang: rnd() * Math.PI,
      tipo: k < 5 ? 'rojo' : k < 7 ? 'blanco' : 'negro', a: 0.12 + 0.18 * rnd(),
    });
  }
  const color = { rojo: [168, 72, 52], blanco: [222, 214, 198], negro: [40, 36, 34] };
  const rg = lcg(seed ^ 0x9e3779b9);
  return generar(w, h, (x, y) => {
    const n1 = ruido(x, y, 0), n2 = ruido(x, y, 1);
    const luz = 0.55 + 0.9 * n1;
    let r = 150 * luz * (0.92 + 0.16 * n2), g = 118 * luz, b = 88 * luz * (1.08 - 0.16 * n2);
    for (const mo of motivos) {
      const c = Math.cos(mo.ang), s = Math.sin(mo.ang);
      const dx = x - mo.cx, dy = y - mo.cy;
      const u = (dx * c + dy * s) / mo.rx, v = (-dx * s + dy * c) / mo.ry;
      const d = u * u + v * v;
      if (d < 1) {
        const a = mo.a * (1 - d) * (0.6 + 0.8 * n1);
        const [cr, cg, cb] = color[mo.tipo];
        r += (cr - r) * a; g += (cg - g) * a; b += (cb - b) * a;
      }
    }
    if (conTarjeta && x < m * 0.12 && y < m * 0.12) {
      const p = (x < m * 0.06 ? 0 : 1) + (y < m * 0.06 ? 0 : 2);
      return [[250, 20, 20], [20, 220, 40], [30, 40, 240], [245, 245, 245]][p];
    }
    // Ruido de sensor (aprox. normal, σ ≈ 2,5 niveles)
    const ns = () => (rg() + rg() + rg() - 1.5) * 5;
    return [r + ns(), g + ns(), b + ns()];
  });
}

// ------------------------------------------------------------ comparación

function comparar(a, b) {
  let distintos = 0, max = 0, suma = 0, n2 = 0, n8 = 0;
  const N = a.width * a.height * 3;
  for (let i = 0, k = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++, k++) {
      const d = Math.abs(a.data[i + c] - b.data[i + c]);
      if (d) { distintos++; suma += d; if (d > max) max = d; if (d > 2) n2++; if (d > 8) n8++; }
    }
  }
  return { pct: 100 * distintos / N, media: suma / N, max, p2: 100 * n2 / N, p8: 100 * n8 / N };
}

function juicio(r, exactas) {
  if (exactas) {
    if (r.p8 <= 0.05 && r.media <= 0.15) return 'ok';
    if (r.p8 <= 0.5 && r.media <= 1) return 'aviso';
    return 'mal';
  }
  if (r.p8 <= 1 && r.media <= 1) return 'ok';
  if (r.p8 <= 5 && r.media <= 3) return 'aviso';
  return 'mal';
}

const fmt = (v, d = 3) => (v === 0 ? '0' : v.toFixed(d));
const espera = () => new Promise(r => setTimeout(r, 0));

async function main() {
  const estado = document.getElementById('estado'), filas = document.getElementById('filas');
  const canvas = document.createElement('canvas');
  const motor = LiveEngine.create(canvas);
  const resultado = { renderer: null, filas: [], terminado: false, error: null };
  window.__resultado = resultado;
  if (!motor) {
    estado.textContent = 'Este navegador no tiene WebGL2 con texturas flotantes: el motor en vivo usaría la CPU.';
    resultado.error = 'sin-gpu'; resultado.terminado = true;
    return;
  }
  const info = motor.gl.getExtension('WEBGL_debug_renderer_info');
  resultado.renderer = info ? motor.gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : motor.gl.getParameter(motor.gl.RENDERER);
  document.getElementById('gpu').textContent = 'GPU: ' + resultado.renderer + ' · textura máxima ' + motor.maxTextureSize + ' px';

  const casos = [
    { nombre: 'panel 120x90', img: panel(false), I: [0.5, 1.5, 3.0], modos: [1] },
    { nombre: 'panel + tarjeta', img: panel(true), I: [0.5, 1.5, 3.0], modos: [1] },
    { nombre: 'roca 1280x720', img: roca(1280, 720, 7, false), I: [0.5, 1.5, 3.0], modos: [1, null] },
    { nombre: 'roca 1920x1080 + tarjeta', img: roca(1920, 1080, 11, true), I: [1.5, 3.0], modos: [1, null] },
    { nombre: 'roca 3840x2160', img: roca(3840, 2160, 23, false), I: [1.5], modos: [1, null] },
  ];
  const post = [
    { nombre: 'roca 1280x720', img: casos[2].img, filtros: ['crgb', 'lds', 'red', 'ybk'], contraste: 25, saturacion: -30 },
    { nombre: 'roca 1280x720', img: casos[2].img, filtros: ['crgb', 'lds', 'red', 'ybk'], contraste: -40, saturacion: 45 },
  ];

  const total = casos.reduce((s, c) => s + FILTROS.length * c.I.length * c.modos.length, 0)
    + post.reduce((s, p) => s + p.filtros.length, 0);
  let hechos = 0;

  const correr = async (nombre, img, filtro, I, stride, contraste, saturacion) => {
    estado.textContent = `${++hechos} / ${total} · ${nombre} · ${filtro} · I=${I}`;
    await espera();
    const fn = CPU[filtro];
    const copia = () => new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    let t0 = performance.now();
    const ref = CPU.applyPostProcessing(fn(copia(), I, null, {}), contraste, saturacion);
    const tCpu = performance.now() - t0;
    t0 = performance.now();
    const gpu = motor.processImage(img, { filter: filtro, intensity: I, contrast: contraste, saturation: saturacion, lock: false }, stride ? { stride } : {});
    const tGpu = performance.now() - t0;
    const r = comparar(ref, gpu);
    const exactas = stride === 1 || Math.max(img.width, img.height) <= 480;
    const j = juicio(r, exactas);
    const fila = { imagen: nombre + (contraste || saturacion ? ` (c${contraste} s${saturacion})` : ''), filtro, I, estadisticas: exactas ? 'exactas' : 'muestra', ...r, tCpu, tGpu, juicio: j };
    resultado.filas.push(fila);
    const tr = document.createElement('tr');
    tr.className = j;
    tr.innerHTML = [fila.imagen, filtro, I.toFixed(1), fila.estadisticas, fmt(r.pct, 2), fmt(r.media), r.max, fmt(r.p2), fmt(r.p8), tCpu.toFixed(0), tGpu.toFixed(0), j]
      .map(v => `<td>${v}</td>`).join('');
    filas.appendChild(tr);
  };

  try {
    for (const c of casos)
      for (const filtro of FILTROS)
        for (const I of c.I)
          for (const stride of c.modos)
            await correr(c.nombre, c.img, filtro, I, stride, 0, 0);
    for (const p of post)
      for (const filtro of p.filtros)
        await correr(p.nombre, p.img, filtro, 1.5, 1, p.contraste, p.saturacion);
  } catch (err) {
    console.error(err);
    resultado.error = String(err && err.stack || err);
    estado.textContent = 'Error: ' + err;
    resultado.terminado = true;
    return;
  }

  const malos = resultado.filas.filter(f => f.juicio === 'mal').length;
  const avisos = resultado.filas.filter(f => f.juicio === 'aviso').length;
  estado.textContent = `Listo: ${resultado.filas.length} comparaciones · ${malos} fuera de tolerancia · ${avisos} con aviso.`;
  resultado.terminado = true;
}

main();
