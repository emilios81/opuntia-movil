/*
 * OPC móvil — motor en vivo sobre la GPU (WebGL2)
 *
 * Copyright (C) 2025-2026  Emilio A. Villafañez
 * LATDAA – Universidad Nacional de Catamarca (UNCa), Argentina
 * GNU General Public License v3.0 o posterior. Ver LICENSE.
 *
 * Hasta v3.5.0 el modo en vivo procesaba cada cuadro con el mismo motor que
 * las fotos: JavaScript en el procesador, un píxel detrás de otro. Eso obligaba
 * a achicar el video a 480 o 720 px de ancho, y aun así en celular rendía pocos
 * cuadros por segundo. A ese tamaño, y en un visor que ocupa media pantalla,
 * las dos opciones se veían prácticamente iguales.
 *
 * Este motor hace el mismo trabajo en la GPU, que procesa miles de píxeles a la
 * vez. Con eso el video se procesa a la resolución que entrega la cámara (hasta
 * 4K) y alcanza además para cosas que antes eran impensables en vivo:
 *
 *  - reducción de ruido temporal (promedio de cuadros con detección de
 *    movimiento): la decorrelación amplifica el ruido de color del sensor, y en
 *    video ese ruido se veía como un granulado de colores;
 *  - zoom y desplazamiento sobre la imagen ya procesada, con muestreo de buena
 *    calidad al achicar y bicúbico al ampliar;
 *  - comparación con el original con una línea divisoria, como en las fotos.
 *
 * La matemática de los filtros es la del motor (ver live-shaders.ts y
 * live-stats.ts). Lo que este motor NO garantiza es la igualdad byte a byte con
 * el escritorio: la GPU calcula en precisión simple y las estadísticas salen de
 * una muestra del cuadro. Por eso el video es para explorar; un cuadro
 * capturado se vuelve a procesar con el motor de referencia.
 */

import { FRAGMENTS, VERT } from './live-shaders';
import { LiveStats, CPU_STATS_FILTERS, type StatsSample, type FilterUniforms } from './live-stats';

/** Reducción de ruido: 0 = sin, 1 = media, 2 = alta. */
export type Denoise = 0 | 1 | 2;

export interface LiveParams {
  /** null: la imagen de la cámara tal cual, sin filtro. */
  filter: string | null;
  intensity: number;
  contrast: number;
  saturation: number;
  /** Estadísticas fijadas: los colores dejan de seguir a la escena. */
  lock: boolean;
}

export interface LiveView {
  /** 1 = la imagen entera a la vista. */
  zoom: number;
  /** Punto de la imagen (en píxeles de la imagen) que queda en el centro. */
  cx: number;
  cy: number;
  /** Comparación con el original: posición de la línea, 0-1 del ancho. null = sin comparar. */
  split: number | null;
}

type Kind = 'rgba8' | 'rgba8mip' | 'rgba16f' | 'r32f' | 'rg32f' | 'rgba32f';

interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number; kind: Kind }

interface Prog { program: WebGLProgram; locs: Map<string, WebGLUniformLocation | null> }

// Peso de cada cuadro nuevo en el acumulado. 0,3 equivale a promediar unos
// cinco cuadros (el ruido baja a menos de la mitad); 0,12, unos quince (baja a
// la cuarta parte). Donde hay movimiento el peso sube a 1 y no queda estela.
const DENOISE_ALPHA = [1, 0.3, 0.12];
// Umbrales del detector de movimiento, sobre promedios de 3x3 en escala 0-1:
// por debajo de 4 niveles de 255 es ruido; por encima de 16, la imagen cambió.
const MOTION_T0 = 4 / 255;
const MOTION_T1 = 16 / 255;
// Cada cuánto se toma una muestra para las estadísticas (s).
const STATS_INTERVAL = 0.1;
// Tiempo de respuesta del suavizado de máximos y mínimos en la GPU (s).
const GPU_STATS_TAU = 0.35;
// Lado mayor de la muestra para estadísticas: ~480 x 270 = 130.000 píxeles.
const SAMPLE_TARGET = 480;

// Sin filtro: una sola instancia, así la comparación por identidad de abajo
// detecta que no cambió nada.
const NONE: FilterUniforms = { kind: 'none' };

export class LiveEngine {
  readonly gl: WebGL2RenderingContext;
  readonly maxTextureSize: number;
  /** Se llama si el sistema le quita el contexto gráfico a la página. */
  onContextLost: (() => void) | null = null;

  private canvas: HTMLCanvasElement;
  private vao: WebGLVertexArrayObject;
  private cam: WebGLTexture;
  private dummy: WebGLTexture;
  private pbo: WebGLBuffer;
  // Formatos internos por tipo de destino. Se leen del contexto y no de
  // WebGL2RenderingContext al cargar el módulo: la página se compila también
  // fuera del navegador, donde esa clase no existe.
  private formats: Record<Kind, number>;
  private progs = new Map<string, Prog>();
  private targets = new Map<string, Target>();
  private cur: Prog | null = null;
  private unit = 0;

  private W = 0;
  private H = 0;
  private hasFrame = false;
  private sourceVersion = 0;
  private lost = false;

  private denoise: Denoise = 1;
  private accIdx = 0;
  private accValid = false;

  private stats = new LiveStats();
  private sample: StatsSample | null = null;
  private sampleVersion = -1;
  private lastSampleAt = -1e9;
  private rb: { sync: WebGLSync; w: number; h: number; stride: number; fullW: number; fullH: number } | null = null;
  private strideOverride: number | null = null;

  private lastFilter: string | null | undefined = undefined;
  private gpuStatsValid = false;
  private gpuStatsAt = 0;
  private gpuStatsIdx = 0;
  private prepared = new Map<string, number>();
  private petroF = { S: 1, L: 1 };
  private lut: { tex: WebGLTexture; n: number; version: number } | null = null;
  private outKey = '';
  private lastU: FilterUniforms | null = null;
  private origVersion = -1;
  private scaleCanvas: HTMLCanvasElement | null = null;

  static create(canvas: HTMLCanvasElement): LiveEngine | null {
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
      });
    } catch { return null; }
    // Sin destinos flotantes no hay reducción de ruido ni Micro-relieve: en ese
    // caso queda el motor de siempre, en la CPU.
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
    let engine: LiveEngine | null = null;
    try {
      engine = new LiveEngine(canvas, gl);
      engine.selfTest();
      return engine;
    } catch (err) {
      console.error('Motor en vivo por GPU no disponible:', err);
      engine?.dispose();
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.formats = { rgba8: gl.RGBA8, rgba8mip: gl.RGBA8, rgba16f: gl.RGBA16F, r32f: gl.R32F, rg32f: gl.RG32F, rgba32f: gl.RGBA32F };
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.cam = this.plainTexture();
    this.dummy = this.plainTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.dummy);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    this.pbo = gl.createBuffer()!;
    canvas.addEventListener('webglcontextlost', this.handleLost);
  }

  private handleLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.onContextLost?.();
  };

  get width() { return this.W; }
  get height() { return this.H; }
  get ready() { return this.hasFrame && !this.lost; }

  // Compila todos los programas y prueba cada tipo de destino al arrancar: si
  // algo falla en este equipo, que falle acá y se use el motor de la CPU, no a
  // mitad de una exploración al elegir un filtro.
  private selfTest() {
    for (const name of Object.keys(FRAGMENTS)) this.prog(name);
    const kinds: Kind[] = ['rgba8', 'rgba8mip', 'rgba16f', 'r32f', 'rg32f', 'rgba32f'];
    for (const k of kinds) this.target('prueba:' + k, 4, 4, k);
    this.freeTargets(n => n.startsWith('prueba:'));
  }

  // --- Recursos -------------------------------------------------------------------

  private plainTexture(): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private target(name: string, w: number, h: number, kind: Kind): Target {
    const old = this.targets.get(name);
    if (old && old.w === w && old.h === h && old.kind === kind) return old;
    if (old) this.freeTarget(name);
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = kind === 'rgba8mip' ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, this.formats[kind], w, h);
    const lineal = kind === 'rgba8' || kind === 'rgba8mip';
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, kind === 'rgba8mip' ? gl.LINEAR_MIPMAP_LINEAR : lineal ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, lineal ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      throw new Error(`No se puede dibujar sobre una textura ${kind} (estado ${status})`);
    }
    const t = { tex, fbo, w, h, kind };
    this.targets.set(name, t);
    return t;
  }

  private freeTarget(name: string) {
    const t = this.targets.get(name);
    if (!t) return;
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.tex);
    this.targets.delete(name);
  }

  private freeTargets(pred: (name: string) => boolean) {
    for (const name of [...this.targets.keys()]) if (pred(name)) this.freeTarget(name);
  }

  // --- Programas y uniformes --------------------------------------------------------

  private compile(type: number, src: string, name: string): WebGLShader {
    const gl = this.gl, s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`No compila el sombreador ${name}: ${log}`);
    }
    return s;
  }

  private prog(name: string): Prog {
    const hecho = this.progs.get(name);
    if (hecho) return hecho;
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, VERT, 'vértices');
    const fs = this.compile(gl.FRAGMENT_SHADER, FRAGMENTS[name], name);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`No enlaza el programa ${name}: ${log}`);
    }
    const p = { program, locs: new Map() };
    this.progs.set(name, p);
    return p;
  }

  private use(name: string) {
    this.cur = this.prog(name);
    this.gl.useProgram(this.cur.program);
    this.unit = 0;
  }

  private loc(n: string) {
    const c = this.cur!;
    let l = c.locs.get(n);
    if (l === undefined) { l = this.gl.getUniformLocation(c.program, n); c.locs.set(n, l); }
    return l;
  }

  private f1(n: string, v: number) { this.gl.uniform1f(this.loc(n), v); }
  private i1(n: string, v: number | boolean) { this.gl.uniform1i(this.loc(n), typeof v === 'boolean' ? (v ? 1 : 0) : v); }
  private i2(n: string, a: number, b: number) { this.gl.uniform2i(this.loc(n), a, b); }
  private f2(n: string, a: number, b: number) { this.gl.uniform2f(this.loc(n), a, b); }
  private f3(n: string, v: number[]) { this.gl.uniform3f(this.loc(n), v[0], v[1], v[2]); }

  // Cada sampler del programa tiene que apuntar a una textura válida y que no
  // sea el destino del pase: si no, WebGL lo toma como un lazo de lectura y
  // escritura sobre la misma textura y no dibuja nada.
  private tex(n: string, t: WebGLTexture) {
    const gl = this.gl, u = this.unit++;
    gl.activeTexture(gl.TEXTURE0 + u);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(this.loc(n), u);
  }

  private draw(t: Target | null, w = 0, h = 0) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.w : w, t ? t.h : h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // --- Fuente ---------------------------------------------------------------------

  private get accCur() { return this.targets.get('acc' + this.accIdx); }
  private get usingAcc() { return this.denoise > 0 && this.accValid && !!this.accCur; }
  private get srcTex() { return this.usingAcc ? this.accCur!.tex : this.cam; }

  private bindSrc() {
    this.tex('uSrc', this.srcTex);
    this.i1('uSrcU8', !this.usingAcc);
    this.i2('uSize', this.W, this.H);
  }

  private resize(w: number, h: number) {
    this.freeTargets(() => true);
    this.W = w;
    this.H = h;
    this.accValid = false;
    this.hasFrame = false;
    this.resetStats();
  }

  /** Olvida estadísticas, muestras y preparados: el próximo cuadro arranca de cero. */
  resetStats() {
    if (this.rb) { this.gl.deleteSync(this.rb.sync); this.rb = null; }
    this.stats.clear();
    this.sample = null;
    this.sampleVersion = -1;
    this.lastSampleAt = -1e9;
    this.gpuStatsValid = false;
    this.prepared.clear();
    this.outKey = '';
  }

  setDenoise(level: Denoise) {
    if (level === this.denoise) return;
    const estaba = this.denoise > 0;
    this.denoise = level;
    if (level === 0) {
      this.freeTarget('acc0');
      this.freeTarget('acc1');
      this.accValid = false;
    } else if (!estaba) {
      this.accValid = false;
    }
    this.sourceVersion++;
  }

  private scaled(src: TexImageSource & { videoWidth?: number }, w: number, h: number): HTMLCanvasElement {
    if (!this.scaleCanvas) this.scaleCanvas = document.createElement('canvas');
    const c = this.scaleCanvas;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    c.getContext('2d')!.drawImage(src as CanvasImageSource, 0, 0, w, h);
    return c;
  }

  /** Sube el cuadro actual del video. Devuelve false si todavía no hay imagen. */
  pushFrame(video: HTMLVideoElement): boolean {
    if (this.lost) return false;
    let w = video.videoWidth, h = video.videoHeight;
    if (!w || !h || video.readyState < 2) return false;
    let src: TexImageSource = video;
    // Una cámara que entrega más que la textura más grande que admite la GPU
    // (raro: casi todas admiten 4096 o más) se achica antes de subirla.
    if (w > this.maxTextureSize || h > this.maxTextureSize) {
      const k = this.maxTextureSize / Math.max(w, h);
      w = Math.floor(w * k); h = Math.floor(h * k);
      src = this.scaled(video, w, h);
    }
    this.upload(src, w, h);
    return true;
  }

  /** Sube una imagen fija (prueba de verificación). */
  setImage(img: ImageData) {
    this.upload(img, img.width, img.height);
  }

  private upload(src: TexImageSource, w: number, h: number) {
    const gl = this.gl;
    if (w !== this.W || h !== this.H) this.resize(w, h);
    gl.bindTexture(gl.TEXTURE_2D, this.cam);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    if (this.denoise > 0) this.runDenoise();
    this.hasFrame = true;
    this.sourceVersion++;
  }

  private runDenoise() {
    const a = this.target('acc0', this.W, this.H, 'rgba16f');
    const b = this.target('acc1', this.W, this.H, 'rgba16f');
    const [from, to] = this.accIdx === 0 ? [a, b] : [b, a];
    this.use('denoise');
    this.tex('uCam', this.cam);
    this.tex('uAcc', from.tex);
    this.i2('uSize', this.W, this.H);
    // El primer cuadro (o el primero después de un corte) se copia entero.
    this.f1('uAlpha', this.accValid ? DENOISE_ALPHA[this.denoise] : 1);
    this.f1('uT0', MOTION_T0);
    this.f1('uT1', MOTION_T1);
    this.draw(to);
    this.accIdx = 1 - this.accIdx;
    this.accValid = true;
  }

  // --- Muestra para las estadísticas ------------------------------------------------

  private renderSample() {
    const stride = this.strideOverride ?? Math.max(1, Math.ceil(Math.max(this.W, this.H) / SAMPLE_TARGET));
    const w = Math.ceil(this.W / stride), h = Math.ceil(this.H / stride);
    const t = this.target('sample', w, h, 'rgba8');
    this.use('sample');
    this.tex('uSrc', this.srcTex);
    this.i2('uSize', this.W, this.H);
    this.i1('uStride', stride);
    this.draw(t);
    return { t, stride, w, h };
  }

  private readSampleSync(now: number): StatsSample {
    const gl = this.gl;
    const { t, stride, w, h } = this.renderSample();
    const data = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.sampleVersion = this.sourceVersion;
    this.lastSampleAt = now;
    return { data, w, h, stride, fullW: this.W, fullH: this.H };
  }

  // Lectura asincrónica: la GPU copia la muestra a un buffer y la CPU la recoge
  // en un cuadro siguiente, cuando ya está. Leer de forma sincrónica obliga a
  // esperar a que la GPU termine todo lo pendiente, y eso se nota como
  // tironeos en el video.
  private startReadback(now: number) {
    const gl = this.gl;
    const { t, stride, w, h } = this.renderSample();
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) return;
    gl.flush();
    this.rb = { sync, w, h, stride, fullW: this.W, fullH: this.H };
    this.sampleVersion = this.sourceVersion;
    this.lastSampleAt = now;
  }

  private pollReadback(): StatsSample | null {
    const gl = this.gl, rb = this.rb;
    if (!rb) return null;
    const st = gl.clientWaitSync(rb.sync, 0, 0);
    if (st === gl.TIMEOUT_EXPIRED) return null;
    gl.deleteSync(rb.sync);
    this.rb = null;
    if (st === gl.WAIT_FAILED || rb.fullW !== this.W || rb.fullH !== this.H) return null;
    const data = new Uint8Array(rb.w * rb.h * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return { data, w: rb.w, h: rb.h, stride: rb.stride, fullW: rb.fullW, fullH: rb.fullH };
  }

  // --- Relieve y Micro-relieve: pases previos y estadísticas en la GPU -----------------

  // Máximo de toda la imagen por bloques de 4x4, nivel tras nivel, hasta 1x1.
  private reduceChain(name: string, mode: 0 | 1 | 2, input: WebGLTexture | null): Target {
    let w = Math.ceil(this.W / 4), h = Math.ceil(this.H / 4);
    let t = this.target(`${name}:0`, w, h, 'rgba32f');
    this.use('reduceFirst');
    this.bindSrc();
    this.tex('uIn', mode === 0 && input ? input : this.dummy);
    this.tex('uL', mode === 2 && input ? input : this.dummy);
    this.i1('uMode', mode);
    this.draw(t);
    for (let k = 1; w > 1 || h > 1; k++) {
      const nw = Math.ceil(w / 4), nh = Math.ceil(h / 4);
      const nt = this.target(`${name}:${k}`, nw, nh, 'rgba32f');
      this.use('reduce');
      this.tex('uIn', t.tex);
      this.i2('uInSize', w, h);
      this.draw(nt);
      t = nt; w = nw; h = nh;
    }
    return t;
  }

  // Texel 0: (máx a*, −mín a*, máx b*, −mín b*). Texel 1: máximo de borde.
  private get gpuState() { return this.targets.get('gstat' + this.gpuStatsIdx); }

  private updateGpuStats(filter: 'relief' | 'petro', now: number) {
    let ab: Target, e: Target;
    if (filter === 'petro') {
      ab = this.reduceChain('petro:redAB', 1, null);
      e = this.reduceChain('petro:redE', 2, this.targets.get('petro:L')!.tex);
    } else {
      e = this.reduceChain('relief:redE', 0, this.targets.get('relief:edge')!.tex);
      ab = e;
    }
    const prev = this.target('gstat' + this.gpuStatsIdx, 2, 1, 'rgba32f');
    const next = this.target('gstat' + (1 - this.gpuStatsIdx), 2, 1, 'rgba32f');
    const alpha = this.gpuStatsValid ? 1 - Math.exp(-Math.max(0, now - this.gpuStatsAt) / GPU_STATS_TAU) : 1;
    this.use('statsEma');
    this.tex('uPrev', prev.tex);
    this.tex('uAB', ab.tex);
    this.tex('uE', e.tex);
    this.f1('uAlpha', alpha);
    this.draw(next);
    this.gpuStatsIdx = 1 - this.gpuStatsIdx;
    this.gpuStatsValid = true;
    this.gpuStatsAt = now;
  }

  private prepRelief() {
    const t = this.target('relief:edge', this.W, this.H, 'r32f');
    this.use('reliefEdge');
    this.bindSrc();
    this.draw(t);
  }

  // Nivel de reducción para la media en caja de radio r: el más grueso en el
  // que la ventana todavía abarca 24 texeles por lado o más. Con radios chicos
  // (hasta 1080p, el radio corto) queda en 1 y la caja es la exacta.
  private static boxLevel(r: number) {
    let f = 1;
    while (r / (2 * f) >= 24) f *= 2;
    return f;
  }

  private prepPetro() {
    const W = this.W, H = this.H;
    const L = this.target('petro:L', W, H, 'r32f');
    this.use('petroL');
    this.bindSrc();
    this.draw(L);

    // Radios del motor: relativos al lado menor, para que el realce mire la
    // misma escala de estructuras a cualquier resolución.
    const m = Math.min(W, H);
    const rS = Math.max(8, Math.floor(m / 40)), rL = Math.max(24, Math.floor(m / 10));
    const fS = LiveEngine.boxLevel(rS), fL = LiveEngine.boxLevel(rL);

    const niveles = new Map<number, Target>([[1, L]]);
    let prev = L, w = W, h = H;
    for (let f = 2; f <= Math.max(fS, fL); f *= 2) {
      const nw = Math.ceil(w / 2), nh = Math.ceil(h / 2);
      const t = this.target(`petro:pyr${f}`, nw, nh, 'rg32f');
      this.use('pyrDown');
      this.tex('uIn', prev.tex);
      this.i2('uInSize', w, h);
      this.i1('uFirst', prev === L);
      this.draw(t);
      niveles.set(f, t);
      prev = t; w = nw; h = nh;
    }

    const caja = (tag: 'S' | 'L', r: number, f: number) => {
      const lvl = niveles.get(f)!;
      const R = (2 * r + 1) / (2 * f);
      const th = this.target(`petro:box${tag}h`, lvl.w, lvl.h, 'rg32f');
      const tv = this.target(`petro:box${tag}`, lvl.w, lvl.h, 'rg32f');
      this.use('box');
      this.tex('uIn', lvl.tex);
      this.i2('uInSize', lvl.w, lvl.h);
      this.i2('uDir', 1, 0);
      this.f1('uR', R);
      this.i1('uFirst', f === 1);
      this.draw(th);
      this.use('box');
      this.tex('uIn', th.tex);
      this.i2('uInSize', lvl.w, lvl.h);
      this.i2('uDir', 0, 1);
      this.f1('uR', R);
      this.i1('uFirst', false);
      this.draw(tv);
    };
    caja('S', rS, fS);
    caja('L', rL, fL);
    this.petroF = { S: fS, L: fL };
  }

  private uploadLut(u: Extract<FilterUniforms, { kind: 'clahe' }>): WebGLTexture {
    const gl = this.gl, n = u.nx * u.ny;
    if (this.lut && this.lut.version === u.version && this.lut.n === n) return this.lut.tex;
    if (!this.lut || this.lut.n !== n) {
      if (this.lut) gl.deleteTexture(this.lut.tex);
      const tex = this.plainTexture();
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, 256, n);
      this.lut = { tex, n, version: -1 };
    }
    gl.bindTexture(gl.TEXTURE_2D, this.lut.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, n, gl.RED, gl.FLOAT, u.lut);
    this.lut.version = u.version;
    return this.lut.tex;
  }

  // --- Proceso --------------------------------------------------------------------------

  /**
   * Aplica el filtro al cuadro actual. `now` en segundos. Es barato llamarlo de
   * más: si nada cambió desde la última vez, no recalcula.
   */
  process(p: LiveParams, now: number) {
    if (!this.hasFrame || this.lost) return;
    const f = p.filter;

    if (f !== this.lastFilter) {
      this.lastFilter = f;
      this.stats.clear();
      this.gpuStatsValid = false;
      // Las texturas propias de un filtro (en 4K, decenas de megabytes) no
      // quedan ocupando memoria cuando se pasa a otro.
      this.freeTargets(n => (n.startsWith('petro:') && f !== 'petro') || (n.startsWith('relief:') && f !== 'relief'));
      this.prepared.clear();
    }

    let u: FilterUniforms = NONE;
    if (f && CPU_STATS_FILTERS.has(f)) {
      const lista = this.pollReadback();
      if (lista && !p.lock) {
        this.sample = lista;
        this.stats.ingest(f, lista, now);
      }
      if (!this.stats.has(f)) {
        if (!this.sample || this.sample.fullW !== this.W || this.sample.fullH !== this.H) this.sample = this.readSampleSync(now);
        this.stats.ingest(f, this.sample, now);
      }
      if (!p.lock && !this.rb && this.sampleVersion !== this.sourceVersion && now - this.lastSampleAt >= STATS_INTERVAL) {
        this.startReadback(now);
      }
      u = this.stats.derive(f, p.intensity) ?? u;
    }

    if (f === 'relief' || f === 'petro') {
      if (this.prepared.get(f) !== this.sourceVersion || !this.gpuStatsValid) {
        if (f === 'relief') this.prepRelief(); else this.prepPetro();
        if (!p.lock || !this.gpuStatsValid) this.updateGpuStats(f, now);
        this.prepared.set(f, this.sourceVersion);
      }
    }

    const key = `${this.sourceVersion}|${f}|${p.intensity}|${p.contrast}|${p.saturation}|${this.gpuStatsAt}|${this.gpuStatsIdx}`;
    if (key === this.outKey && u === this.lastU) return;
    this.outKey = key;
    this.lastU = u;
    this.renderFilter(f, p, u);
  }

  private renderFilter(f: string | null, p: LiveParams, u: FilterUniforms) {
    const gl = this.gl;
    const out = this.target('out', this.W, this.H, 'rgba8mip');
    // La tabla de CLAHE se sube ANTES de empezar a asignar samplers: subirla
    // engancha su textura en la unidad activa, que a esa altura ya sería la de
    // la imagen fuente, y el filtro terminaba leyendo la tabla como si fuera
    // la foto.
    const lutTex = u.kind === 'clahe' ? this.uploadLut(u) : null;
    if (!f || !FRAGMENTS[f]) {
      this.use('copy');
      this.bindSrc();
    } else {
      this.use(f);
      this.bindSrc();
      this.f1('uI', p.intensity);
      this.f1('uContrast', p.contrast);
      this.f1('uSaturation', p.saturation);
      switch (u.kind) {
        case 'L':
          this.f1('uML', u.mL);
          this.f1('uStdL', u.stdL);
          break;
        case 'pca':
          this.f3('uM', u.m);
          this.f3('uV0', u.V[0]); this.f3('uV1', u.V[1]); this.f3('uV2', u.V[2]);
          this.f3('uS', u.s);
          this.f3('uLo', u.lo);
          this.f3('uHi', u.hi);
          break;
        case 'lds':
          this.f3('uM', u.m);
          this.f3('uV0', u.V[0]); this.f3('uV1', u.V[1]); this.f3('uV2', u.V[2]);
          this.f3('uW', u.w);
          this.f1('uGain', u.gain);
          this.f1('uOffset', u.offset);
          break;
        case 'red':
          this.f1('uMA', u.ma); this.f1('uMB', u.mb);
          this.f1('uCo', u.co); this.f1('uSi', u.si);
          this.f1('uW1', u.w1); this.f1('uW2', u.w2);
          break;
        case 'ybk':
          this.f1('uMY', u.mY); this.f1('uMCb', u.mCb); this.f1('uMCr', u.mCr);
          this.f1('uStdCb', u.stdCb); this.f1('uStdCr', u.stdCr);
          break;
        case 'clahe':
          this.tex('uLut', lutTex!);
          this.f1('uTw', u.tw); this.f1('uTh', u.th);
          this.i1('uNx', u.nx); this.i1('uNy', u.ny);
          break;
      }
      const estado = this.gpuState?.tex ?? this.dummy;
      if (f === 'relief') {
        this.tex('uEdge', this.targets.get('relief:edge')!.tex);
        this.tex('uState', estado);
      } else if (f === 'petro') {
        this.tex('uL', this.targets.get('petro:L')!.tex);
        this.tex('uBoxS', this.targets.get('petro:boxS')!.tex);
        this.tex('uBoxL', this.targets.get('petro:boxL')!.tex);
        this.tex('uState', estado);
        this.i1('uFS', this.petroF.S);
        this.i1('uFL', this.petroF.L);
      }
    }
    this.draw(out);
    gl.bindTexture(gl.TEXTURE_2D, out.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  // --- Pantalla ---------------------------------------------------------------------------

  /** Escala de "imagen entera a la vista" para un lienzo de cw x ch píxeles. */
  fitScale(cw: number, ch: number) {
    return this.W && this.H ? Math.min(cw / this.W, ch / this.H) : 1;
  }

  /**
   * Dibuja en el lienzo. cssW/cssH: tamaño en pantalla; dpr: píxeles físicos
   * por píxel CSS. El lienzo se dimensiona a píxeles físicos para no perder
   * nitidez en pantallas de alta densidad.
   */
  display(view: LiveView, cssW: number, cssH: number, dpr: number) {
    if (this.lost) return;
    const gl = this.gl, canvas = this.canvas;
    const cw = Math.max(1, Math.round(cssW * dpr)), ch = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const out = this.targets.get('out');
    if (!this.hasFrame || !out) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    let orig: WebGLTexture = this.dummy;
    if (view.split !== null) {
      const t = this.target('orig', this.W, this.H, 'rgba8mip');
      if (this.origVersion !== this.sourceVersion) {
        this.use('copy');
        this.bindSrc();
        this.draw(t);
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.generateMipmap(gl.TEXTURE_2D);
        this.origVersion = this.sourceVersion;
      }
      orig = t.tex;
    } else if (this.targets.has('orig')) {
      this.freeTarget('orig');
      this.origVersion = -1;
    }
    this.use('display');
    this.tex('uOut', out.tex);
    this.tex('uOrig', orig);
    this.f2('uImg', this.W, this.H);
    this.f2('uCanvas', cw, ch);
    this.f2('uCenter', view.cx, view.cy);
    this.f1('uScale', this.fitScale(cw, ch) * view.zoom);
    this.i1('uCompare', view.split !== null);
    this.f1('uSplit', (view.split ?? 0) * cw);
    this.f1('uLine', Math.max(1, dpr));
    this.draw(null, cw, ch);
  }

  // --- Lecturas -----------------------------------------------------------------------------

  private readTarget(t: Target): ImageData {
    const gl = this.gl;
    const buf = new Uint8Array(t.w * t.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return new ImageData(new Uint8ClampedArray(buf.buffer), t.w, t.h);
  }

  /**
   * El cuadro actual sin filtro, a 8 bits y a resolución completa. Si la
   * reducción de ruido está activa es el acumulado: un cuadro más limpio que
   * cualquiera de los que manda la cámara.
   */
  readSource(): ImageData | null {
    if (!this.hasFrame || this.lost) return null;
    const t = this.target('tmp8', this.W, this.H, 'rgba8');
    this.use('copy');
    this.bindSrc();
    this.draw(t);
    const img = this.readTarget(t);
    this.freeTarget('tmp8');
    return img;
  }

  /** La salida del filtro tal como quedó en la textura (prueba de verificación). */
  readOutput(): ImageData | null {
    const t = this.targets.get('out');
    return t && !this.lost ? this.readTarget(t) : null;
  }

  /**
   * Prueba de verificación: procesa una imagen fija de punta a punta, sin
   * suavizado ni reducción de ruido. `stride` 1 = estadísticas sobre todos los
   * píxeles, como el motor; sin indicar, la muestra que se usa en vivo.
   */
  processImage(img: ImageData, p: LiveParams, opts: { stride?: number } = {}): ImageData | null {
    this.setDenoise(0);
    this.strideOverride = opts.stride ?? null;
    this.stats.tau = 0;
    this.stats.continuity = false;
    this.setImage(img);
    this.lastFilter = undefined;
    this.resetStats();
    this.process(p, 0);
    return this.readOutput();
  }

  dispose() {
    const gl = this.gl;
    this.canvas.removeEventListener('webglcontextlost', this.handleLost);
    if (this.rb) { gl.deleteSync(this.rb.sync); this.rb = null; }
    this.freeTargets(() => true);
    for (const p of this.progs.values()) gl.deleteProgram(p.program);
    this.progs.clear();
    if (this.lut) { gl.deleteTexture(this.lut.tex); this.lut = null; }
    gl.deleteTexture(this.cam);
    gl.deleteTexture(this.dummy);
    gl.deleteBuffer(this.pbo);
    gl.deleteVertexArray(this.vao);
    this.hasFrame = false;
  }
}
