/*
 * OPC móvil — sombreadores del motor en vivo (WebGL2 / GLSL ES 3.0)
 *
 * Copyright (C) 2025-2026  Emilio A. Villafañez
 * LATDAA – Universidad Nacional de Catamarca (UNCa), Argentina
 * GNU General Public License v3.0 o posterior. Ver LICENSE.
 *
 * Cada filtro de src/lib/image-processing.ts portado a un programa que corre en
 * la GPU, un píxel por hilo. La matemática es la misma, línea por línea, y los
 * comentarios marcan dónde el puerto tiene que imitar un detalle de JavaScript
 * para dar el mismo número:
 *
 *  - Math.round redondea las mitades hacia arriba: `jsRound`, no `round()`,
 *    que en GLSL deja las mitades a criterio de cada placa.
 *  - Guardar en un Uint8ClampedArray acota a 0-255 y redondea las mitades al
 *    par: `u8`. Lo usan YBK, CLAHE, Mapa y el contraste/saturación.
 *  - La GPU calcula en precisión simple y el escritorio en doble: sobre la
 *    misma imagen, algún píxel puede quedar a un nivel de distancia. La prueba
 *    tests/verificar-gpu lo mide filtro por filtro.
 *
 * Las estadísticas (medias, covarianzas, autovectores, vallas de Tukey,
 * histogramas de CLAHE) NO se calculan acá: salen de una muestra del cuadro en
 * la CPU, con las mismas funciones del motor (live-stats.ts), y llegan como
 * uniformes. Las únicas que se calculan en la GPU son máximos y mínimos, que se
 * reducen por bloques (Relieve y Micro-relieve).
 *
 * Convención de filas: la fila 0 de toda textura es la de ARRIBA de la imagen,
 * como en ImageData. gl_FragCoord.y = fila + 0,5 en los pases a textura; solo
 * el pase final a pantalla da vuelta el eje.
 */

// Triángulo que cubre todo el destino, sin buffers: los vértices salen del índice.
export const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 o;
`;

// La fuente es el cuadro de la cámara (8 bits, valores enteros) o el acumulado
// de la reducción de ruido (media flotante de varios cuadros). Los filtros
// trabajan en la escala 0-255 de ImageData en los dos casos.
const SRC = `
uniform sampler2D uSrc;
uniform bool uSrcU8;
uniform ivec2 uSize;

vec3 srcAt(ivec2 p) {
  vec3 c = texelFetch(uSrc, p, 0).rgb * 255.0;
  return uSrcU8 ? floor(c + 0.5) : c;
}

// Math.round de JavaScript: las mitades suben.
float jsRound(float x) { return floor(x + 0.5); }

// Lo que hace Uint8ClampedArray al guardar: acota a 0-255 y redondea al entero
// más cercano, con las mitades al par.
float u8(float x) {
  if (!(x > 0.0)) return 0.0;
  if (x >= 255.0) return 255.0;
  float f = floor(x), d = x - f;
  if (d > 0.5) return f + 1.0;
  if (d < 0.5) return f;
  return mod(f, 2.0) == 0.0 ? f : f + 1.0;
}
vec3 u8v(vec3 v) { return vec3(u8(v.r), u8(v.g), u8(v.b)); }
`;

const LAB = `
float srgbLin(float c) {
  c = c / 255.0;
  return c > 0.04045 ? pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
}
float labF(float t) { return t > 0.008856 ? pow(t, 1.0 / 3.0) : (7.787 * t + 16.0 / 116.0); }
vec3 rgb2lab(vec3 c) {
  float rr = srgbLin(c.r), gg = srgbLin(c.g), bb = srgbLin(c.b);
  float x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
  float y = (rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750);
  float z = (rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041) / 1.08883;
  float fy = labF(y);
  vec3 lab = vec3(116.0 * fy - 16.0, 500.0 * (labF(x) - fy), 200.0 * (fy - labF(z)));
  // En un gris exacto (R = G = B) a* y b* son cero salvo por redondeo. En doble
  // precisión el motor obtiene siempre a* ≈ −1e-5; en simple el signo sale al
  // azar, y Rojo elige rama por el signo de a*: un blanco quemado salía hasta
  // 38 niveles más claro que en el motor. En cero se toma la misma rama.
  if (c.r == c.g && c.g == c.b) lab.yz = vec2(0.0);
  return lab;
}
float labFi(float t) { float t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16.0 / 116.0) / 7.787; }
float srgbGam(float c) { return c > 0.0031308 ? 1.055 * pow(c, 1.0 / 2.4) - 0.055 : 12.92 * c; }
// Igual que lab2rgb del motor: devuelve enteros (Math.round) SIN acotar; quien
// llama acota a 0-255, que es lo que hacía el Uint8ClampedArray de salida.
vec3 lab2rgb(float L, float a, float b) {
  float y = (L + 16.0) / 116.0, x = a / 500.0 + y, z = y - b / 200.0;
  float fx = labFi(x), fy = labFi(y), fz = labFi(z);
  float rr = fx * 0.95047 * 3.2404542 - fy * 1.5371385 - fz * 1.08883 * 0.4985314;
  float gg = -fx * 0.95047 * 0.9692660 + fy * 1.8760108 + fz * 1.08883 * 0.0415560;
  float bb = fx * 0.95047 * 0.0556434 - fy * 0.2040259 + fz * 1.08883 * 1.0572252;
  return vec3(jsRound(srgbGam(rr) * 255.0), jsRound(srgbGam(gg) * 255.0), jsRound(srgbGam(bb) * 255.0));
}
`;

// applyPostProcessing del motor. Con contraste y saturación en cero devuelve
// la entrada intacta: k = 1, s = 1 y el término de luminancia se anula.
const POST = `
uniform float uContrast;
uniform float uSaturation;
vec3 post(vec3 c) {
  float k = 1.0 + uContrast / 100.0, ko = 127.5 * (1.0 - k), s = 1.0 + uSaturation / 100.0;
  vec3 c1 = c * k + ko;
  float lum = 0.213 * (1.0 - s) * c1.r + 0.715 * (1.0 - s) * c1.g + 0.072 * (1.0 - s) * c1.b;
  return u8v(vec3(lum) + s * c1);
}
uniform float uI;
`;

// Arma un filtro de un solo pase: `cuerpo` define vec3 filtro(vec3 c, ivec2 p),
// que devuelve la salida del filtro ya en enteros 0-255.
function filtro(cuerpo: string): string {
  return HEAD + SRC + LAB + POST + cuerpo + `
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  o = vec4(post(filtro(srcAt(p), p)) / 255.0, 1.0);
}`;
}

// --- FILTROS DE UN SOLO PASE ------------------------------------------------

const RED = filtro(`
vec3 filtro(vec3 c, ivec2 p) {
  vec3 lab = rgb2lab(c);
  float L = lab.x, a = lab.y, b = lab.z;
  float a_ = clamp(a * uI, -128.0, 127.0);
  float b_ = clamp(b * (1.0 + (uI - 1.0) * 0.3), -128.0, 127.0);
  float L_ = clamp(L + (a > 0.0 ? (uI - 1.0) * 8.0 : -(uI - 1.0) * 5.0), 0.0, 100.0);
  return clamp(lab2rgb(L_, a_, b_), 0.0, 255.0);
}`);

const L_STATS = `
uniform float uML;
uniform float uStdL;
`;

const WHITE = filtro(L_STATS + `
vec3 filtro(vec3 c, ivec2 p) {
  vec3 lab = rgb2lab(c);
  float Li = lab.x;
  float z = (Li - uML) / uStdL;
  float boost = z > 0.0 ? z * uI * 5.0 : z * uI * 2.0;
  float sf = Li > uML ? 1.0 / (1.0 + (uI - 1.0) * 0.5) : 1.0;
  return clamp(lab2rgb(clamp(Li + boost, 0.0, 100.0), lab.y * sf, lab.z * sf), 0.0, 255.0);
}`);

const BLACK = filtro(L_STATS + `
vec3 filtro(vec3 c, ivec2 p) {
  vec3 lab = rgb2lab(c);
  float Li = lab.x, na = lab.y, nb = lab.z;
  float ch = length(lab.yz), z = (Li - uML) / uStdL;
  float nL;
  if (Li < uML && ch < 20.0) {
    float df = (uML - Li) / (uML != 0.0 ? uML : 1.0);
    nL = Li - df * uI * 18.0;
    float cr = 1.0 / (1.0 + (uI - 1.0) * 0.8);
    na *= cr; nb *= cr;
  } else {
    nL = Li + max(0.0, z) * uI * 3.0;
    na *= (1.0 + (uI - 1.0) * 0.15);
    nb *= (1.0 + (uI - 1.0) * 0.15);
  }
  return clamp(lab2rgb(clamp(nL, 0.0, 100.0), na, nb), 0.0, 255.0);
}`);

const BICHROME = filtro(L_STATS + `
vec3 filtro(vec3 c, ivec2 p) {
  vec3 lab = rgb2lab(c);
  float Li = lab.x, ai = lab.y, bi = lab.z;
  float ch = length(lab.yz);
  float rb = ai > 5.0 ? uI * 1.3 : (ai > 0.0 ? uI : 1.0);
  bool isW = Li > uML && ch < 25.0;
  float wb = isW ? (Li - uML) * uI * 0.15 : 0.0;
  float nL = clamp(Li + wb, 0.0, 100.0);
  bool isR = !isW && ai < 5.0 && Li < uML;
  float rs = isR ? 0.7 : 1.0;
  return clamp(lab2rgb(nL * rs + (1.0 - rs) * (nL * 0.6), ai * rb, bi * (isW ? 0.5 : 1.0)), 0.0, 255.0);
}`);

const MAP = filtro(L_STATS + `
vec3 filtro(vec3 c, ivec2 p) {
  vec3 lab = rgb2lab(c);
  float Li = lab.x, ai = lab.y, ch = length(lab.yz);
  vec3 r;
  if (ai > 8.0 && ch > 12.0) {
    float ri = min(1.0, ai / 40.0);
    r = vec3(255.0 * ri, 80.0 * (1.0 - ri), 0.0);
  } else if (Li < uML - 10.0 && ch < 15.0) {
    float bi = min(1.0, (uML - Li) / (uML * 0.6));
    r = vec3(40.0 * (1.0 - bi), 200.0 + 55.0 * bi, 40.0 * (1.0 - bi));
  } else if (Li > 65.0 && ch < 18.0) {
    float wi = min(1.0, (Li - 65.0) / 35.0);
    r = vec3(100.0 * (1.0 - wi), 200.0 + 55.0 * wi, 220.0 + 35.0 * wi);
  } else {
    r = vec3(min(255.0, Li * 1.2));
  }
  return u8v(r);
}`);

// CRGB y DS-LAB: proyección sobre la base de componentes principales y
// estiramiento de cada componente entre media ± clipStd·σ, calculados fuera.
const PCA = `
uniform vec3 uM;
uniform vec3 uV0;
uniform vec3 uV1;
uniform vec3 uV2;
uniform vec3 uS;
uniform vec3 uLo;
uniform vec3 uHi;
vec3 estirar(vec3 d) {
  vec3 pc = vec3(dot(uV0, d), dot(uV1, d), dot(uV2, d)) / uS;
  vec3 rango = uHi - uLo;
  rango = vec3(rango.x != 0.0 ? rango.x : 1.0, rango.y != 0.0 ? rango.y : 1.0, rango.z != 0.0 ? rango.z : 1.0);
  vec3 v = clamp(pc, uLo, uHi);
  return vec3(jsRound((v.x - uLo.x) / rango.x * 255.0),
              jsRound((v.y - uLo.y) / rango.y * 255.0),
              jsRound((v.z - uLo.z) / rango.z * 255.0));
}
`;

const CRGB = filtro(PCA + `
vec3 filtro(vec3 c, ivec2 p) { return estirar(c - uM); }`);

const DSLAB = filtro(PCA + `
vec3 filtro(vec3 c, ivec2 p) { return estirar(rgb2lab(c) - uM); }`);

// LDS: blanqueo con pesos (σ̄/σk)^γ, reproyección al RGB y normalización con
// ganancia y desplazamiento comunes a los tres canales (v3.5.0).
const LDS = filtro(`
uniform vec3 uM;
uniform vec3 uV0;
uniform vec3 uV1;
uniform vec3 uV2;
uniform vec3 uW;
uniform float uGain;
uniform float uOffset;
vec3 filtro(vec3 c, ivec2 p) {
  vec3 d = c - uM;
  vec3 dz = uV0 * (dot(uV0, d) * uW.x) + uV1 * (dot(uV1, d) * uW.y) + uV2 * (dot(uV2, d) * uW.z);
  return clamp(vec3(jsRound(dz.x * uGain + uM.x + uOffset),
                    jsRound(dz.y * uGain + uM.y + uOffset),
                    jsRound(dz.z * uGain + uM.z + uOffset)), 0.0, 255.0);
}`);

const YBK = filtro(`
uniform float uMY;
uniform float uMCb;
uniform float uMCr;
uniform float uStdCb;
uniform float uStdCr;
vec3 filtro(vec3 c, ivec2 p) {
  float Y = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  float Cb = 128.0 - 0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b;
  float Cr = 128.0 + 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b;
  float chromaBoost = uI * 3.0, lumaContrast = 1.0 + (uI - 1.0) * 0.6;
  float y_ = clamp(uMY + (Y - uMY) * lumaContrast, 0.0, 255.0);
  float cb_ = clamp(128.0 + ((Cb - uMCb) / uStdCb) * 40.0 * chromaBoost, 0.0, 255.0);
  float cr_ = clamp(128.0 + ((Cr - uMCr) / uStdCr) * 40.0 * chromaBoost, 0.0, 255.0);
  float r = y_ + 1.402 * (cr_ - 128.0);
  float g = y_ - 0.344136 * (cb_ - 128.0) - 0.714136 * (cr_ - 128.0);
  float b = y_ + 1.772 * (cb_ - 128.0);
  return u8v(vec3(r, g, b));
}`);

// CLAHE: las 64 curvas (una por mosaico de la grilla de 8x8) llegan en una
// textura de 256 x mosaicos; acá solo se interpola entre los cuatro vecinos.
const CLAHE = filtro(`
uniform sampler2D uLut;
uniform float uTw;
uniform float uTh;
uniform int uNx;
uniform int uNy;
float curva(int mosaico, int v) { return texelFetch(uLut, ivec2(v, mosaico), 0).r; }
vec3 filtro(vec3 c, ivec2 p) {
  float lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  float fxc = clamp((float(p.x) - uTw / 2.0) / uTw, 0.0, float(uNx - 1));
  float fyc = clamp((float(p.y) - uTh / 2.0) / uTh, 0.0, float(uNy - 1));
  int x1 = int(floor(fxc)), x2 = min(uNx - 1, x1 + 1);
  int y1 = int(floor(fyc)), y2 = min(uNy - 1, y1 + 1);
  float fx = fxc - float(x1), fy = fyc - float(y1);
  int v = int(clamp(jsRound(lum), 0.0, 255.0));
  float nl = (1.0 - fx) * (1.0 - fy) * curva(y1 * uNx + x1, v) + fx * (1.0 - fy) * curva(y1 * uNx + x2, v)
           + (1.0 - fx) * fy * curva(y2 * uNx + x1, v) + fx * fy * curva(y2 * uNx + x2, v);
  float ratio = lum > 0.5 ? nl / lum : 1.0;
  return u8v(min(vec3(255.0), c * ratio));
}`);

// --- RELIEVE (tres pases: bordes, máximo por reducción, salida) --------------

const RELIEF_EDGE = HEAD + SRC + `
float lumAt(ivec2 q) { vec3 c = srcAt(q); return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float e = 0.0;
  // Mismo marco que el motor: los dos píxeles del borde quedan en cero.
  if (p.x >= 2 && p.y >= 2 && p.x < uSize.x - 2 && p.y < uSize.y - 2) {
    float a = lumAt(p + ivec2(-1, -1)), b = lumAt(p + ivec2(0, -1)), c = lumAt(p + ivec2(1, -1));
    float d = lumAt(p + ivec2(-1, 0)), f = lumAt(p + ivec2(1, 0));
    float g = lumAt(p + ivec2(-1, 1)), h = lumAt(p + ivec2(0, 1)), k = lumAt(p + ivec2(1, 1));
    float g3x = -a + c - 2.0 * d + 2.0 * f - g + k;
    float g3y = -a - 2.0 * b - c + g + 2.0 * h + k;
    float A = lumAt(p + ivec2(-2, -2)), B = lumAt(p + ivec2(0, -2)), C = lumAt(p + ivec2(2, -2));
    float D = lumAt(p + ivec2(-2, 0)), F = lumAt(p + ivec2(2, 0));
    float G = lumAt(p + ivec2(-2, 2)), H = lumAt(p + ivec2(0, 2)), K = lumAt(p + ivec2(2, 2));
    float g5x = -A + C - 2.0 * D + 2.0 * F - G + K;
    float g5y = -A - 2.0 * B - C + G + 2.0 * H + K;
    e = sqrt(g3x * g3x + g3y * g3y) * 0.65 + sqrt(g5x * g5x + g5y * g5y) * 0.35;
  }
  o = vec4(e, 0.0, 0.0, 1.0);
}`;

const RELIEF = HEAD + SRC + POST + `
uniform sampler2D uEdge;
uniform sampler2D uState;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float mx = texelFetch(uState, ivec2(1, 0), 0).x;
  float x = min(1.0, (texelFetch(uEdge, p, 0).r / (mx != 0.0 ? mx : 1.0)) * uI * 1.2);
  float e = x > 0.0 ? pow(x, 0.7) : 0.0;
  float v = jsRound(e * 255.0);
  vec3 r = vec3(min(255.0, jsRound(v * 1.05)), jsRound(v * 0.92), jsRound(v * 0.78));
  o = vec4(post(r) / 255.0, 1.0);
}`;

// --- MICRO-RELIEVE ------------------------------------------------------------

// L* a resolución completa, para el Sobel y para las medias en caja.
const PETRO_L = HEAD + SRC + LAB + `
void main() { o = vec4(rgb2lab(srcAt(ivec2(gl_FragCoord.xy))).x, 0.0, 0.0, 1.0); }`;

const SOBEL_L = `
uniform sampler2D uL;
float lAt(ivec2 q) { return texelFetch(uL, q, 0).r; }
float sobelL(ivec2 p) {
  if (p.x < 1 || p.y < 1 || p.x >= uSize.x - 1 || p.y >= uSize.y - 1) return 0.0;
  float a = lAt(p + ivec2(-1, -1)), b = lAt(p + ivec2(0, -1)), c = lAt(p + ivec2(1, -1));
  float d = lAt(p + ivec2(-1, 0)), f = lAt(p + ivec2(1, 0));
  float g = lAt(p + ivec2(-1, 1)), h = lAt(p + ivec2(0, 1)), k = lAt(p + ivec2(1, 1));
  float gx = -a + c - 2.0 * d + 2.0 * f - g + k;
  float gy = -a - 2.0 * b - c + g + 2.0 * h + k;
  return sqrt(gx * gx + gy * gy);
}
`;

// Media en caja cuadrada de radio r, como satMean del motor: la ventana se
// recorta en los bordes y se divide por los píxeles que quedan adentro. Llega
// calculada en un nivel reducido por f (f = 1 cuando el radio es chico) y acá
// se interpola entre los cuatro texeles vecinos.
const PETRO = HEAD + SRC + LAB + POST + SOBEL_L + `
uniform sampler2D uBoxS;
uniform sampler2D uBoxL;
uniform int uFS;
uniform int uFL;
uniform sampler2D uState;
float caja(sampler2D t, int f, ivec2 p) {
  if (f == 1) return texelFetch(t, p, 0).r;
  ivec2 sz = textureSize(t, 0);
  vec2 u = clamp((vec2(p) + 0.5) / float(f) - 0.5, vec2(0.0), vec2(sz - 1));
  ivec2 i0 = ivec2(floor(u)), i1 = min(i0 + 1, sz - 1);
  vec2 fr = u - vec2(i0);
  float a = texelFetch(t, i0, 0).r, b = texelFetch(t, ivec2(i1.x, i0.y), 0).r;
  float c = texelFetch(t, ivec2(i0.x, i1.y), 0).r, d = texelFetch(t, i1, 0).r;
  return mix(mix(a, b, fr.x), mix(c, d, fr.x), fr.y);
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 lab = rgb2lab(srcAt(p));
  float L = lab.x;
  vec4 ab = texelFetch(uState, ivec2(0, 0), 0);          // (máx a*, −mín a*, máx b*, −mín b*)
  float maxEdge = texelFetch(uState, ivec2(1, 0), 0).x;
  float midA = (ab.x - ab.y) / 2.0, midB = (ab.z - ab.w) / 2.0;
  float mS = caja(uBoxS, uFS, p), mLg = caja(uBoxL, uFL, p);
  float Lloc = L + (L - mS) * uI * 2.5 * 0.6 + (L - mLg) * uI * 1.2 * 0.4;
  float nL = clamp(Lloc + (sobelL(p) / (maxEdge != 0.0 ? maxEdge : 1.0)) * 20.0 * (uI * 0.25), 0.0, 100.0);
  vec3 r = clamp(lab2rgb(nL, midA + (lab.y - midA) * uI * 3.0, midB + (lab.z - midB) * uI * 3.0), 0.0, 255.0);
  o = vec4(post(r) / 255.0, 1.0);
}`;

// Reducción a la mitad con conteo: cada texel guarda la media de los píxeles
// de su bloque que caen dentro de la imagen (R) y cuántos son (G).
const PYR_DOWN = HEAD + `
uniform sampler2D uIn;
uniform ivec2 uInSize;
uniform bool uFirst;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  float s = 0.0, n = 0.0;
  for (int dy = 0; dy < 2; dy++) for (int dx = 0; dx < 2; dx++) {
    ivec2 p = q * 2 + ivec2(dx, dy);
    if (p.x < uInSize.x && p.y < uInSize.y) {
      vec4 t = texelFetch(uIn, p, 0);
      float c = uFirst ? 1.0 : t.g;
      s += t.r * c; n += c;
    }
  }
  o = vec4(n > 0.0 ? s / n : 0.0, n, 0.0, 1.0);
}`;

// Caja separable (un eje por pase) con peso fraccionario en los texeles de la
// punta: la ventana mide exactamente 2r+1 píxeles aunque el nivel esté
// reducido. Con f = 1 es la caja exacta del motor, recorte de bordes incluido.
const BOX = HEAD + `
uniform sampler2D uIn;
uniform ivec2 uInSize;
uniform ivec2 uDir;
uniform float uR;
uniform bool uFirst;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int n = int(ceil(uR - 0.5));
  float s = 0.0, c = 0.0;
  for (int k = -n; k <= n; k++) {
    ivec2 p = q + uDir * k;
    if (p.x < 0 || p.y < 0 || p.x >= uInSize.x || p.y >= uInSize.y) continue;
    float fk = float(k);
    float w = clamp(min(fk + 0.5, uR) - max(fk - 0.5, -uR), 0.0, 1.0);
    vec4 t = texelFetch(uIn, p, 0);
    float cnt = uFirst ? 1.0 : t.g;
    s += w * t.r * cnt; c += w * cnt;
  }
  o = vec4(c > 0.0 ? s / c : 0.0, c, 0.0, 1.0);
}`;

// --- REDUCCIONES (máximos y mínimos de toda la imagen) -----------------------

// Primer nivel: cada texel es el máximo de un bloque de 4x4 de la magnitud que
// corresponda. Los mínimos viajan como máximos de valores negados.
const REDUCE_FIRST = HEAD + SRC + LAB + SOBEL_L + `
uniform int uMode;          // 0: textura tal cual · 1: a*/b* de la fuente · 2: Sobel sobre L*
uniform sampler2D uIn;
vec4 valor(ivec2 p) {
  if (uMode == 1) { vec3 lab = rgb2lab(srcAt(p)); return vec4(lab.y, -lab.y, lab.z, -lab.z); }
  if (uMode == 2) return vec4(sobelL(p), 0.0, 0.0, 0.0);
  return texelFetch(uIn, p, 0);
}
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec4 m = vec4(-3.0e38);
  for (int dy = 0; dy < 4; dy++) for (int dx = 0; dx < 4; dx++) {
    ivec2 p = q * 4 + ivec2(dx, dy);
    if (p.x < uSize.x && p.y < uSize.y) m = max(m, valor(p));
  }
  o = m;
}`;

const REDUCE = HEAD + `
uniform sampler2D uIn;
uniform ivec2 uInSize;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec4 m = vec4(-3.0e38);
  for (int dy = 0; dy < 4; dy++) for (int dx = 0; dx < 4; dx++) {
    ivec2 p = q * 4 + ivec2(dx, dy);
    if (p.x < uInSize.x && p.y < uInSize.y) m = max(m, texelFetch(uIn, p, 0));
  }
  o = m;
}`;

// Suavizado temporal de las estadísticas que viven en la GPU (texel 0: a*/b*,
// texel 1: máximo de borde). Con uAlpha = 1 se reemplaza el valor anterior.
const STATS_EMA = HEAD + `
uniform sampler2D uPrev;
uniform sampler2D uAB;
uniform sampler2D uE;
uniform float uAlpha;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec4 cur = q.x == 0 ? texelFetch(uAB, ivec2(0), 0) : texelFetch(uE, ivec2(0), 0);
  o = mix(texelFetch(uPrev, q, 0), cur, uAlpha);
}`;

// --- FUENTE, MUESTRA Y RUIDO --------------------------------------------------

// La imagen sin filtrar, a 8 bits: el "original" de la comparación y lo que se
// entrega al capturar un cuadro.
const COPY = HEAD + SRC + `
void main() { o = vec4(srcAt(ivec2(gl_FragCoord.xy)) / 255.0, 1.0); }`;

// Muestra puntual cada `uStride` píxeles para las estadísticas en la CPU.
// Puntual y no promediada: promediar achica el ruido y con él la varianza de
// las componentes chicas, que es justo lo que la decorrelación amplifica.
const SAMPLE = HEAD + `
uniform sampler2D uSrc;
uniform ivec2 uSize;
uniform int uStride;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  ivec2 p = min(q * uStride + uStride / 2, uSize - 1);
  o = vec4(texelFetch(uSrc, p, 0).rgb, 1.0);
}`;

// Reducción de ruido temporal: el acumulado se acerca al cuadro nuevo una
// fracción uAlpha por cuadro (un promedio de los últimos cuadros), salvo donde
// la imagen cambió de verdad. Ahí se toma el cuadro nuevo entero para no dejar
// estelas. El cambio se mide sobre promedios de 3x3, para que el propio ruido
// del sensor no cuente como movimiento.
const DENOISE = HEAD + `
uniform sampler2D uCam;
uniform sampler2D uAcc;
uniform ivec2 uSize;
uniform float uAlpha;
uniform float uT0;
uniform float uT1;
vec3 media3(sampler2D t, ivec2 p) {
  vec3 s = vec3(0.0);
  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++)
    s += texelFetch(t, clamp(p + ivec2(dx, dy), ivec2(0), uSize - 1), 0).rgb;
  return s / 9.0;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 cam = texelFetch(uCam, p, 0).rgb, acc = texelFetch(uAcc, p, 0).rgb;
  vec3 dm = abs(media3(uCam, p) - media3(uAcc, p));
  float a = mix(uAlpha, 1.0, smoothstep(uT0, uT1, max(dm.r, max(dm.g, dm.b))));
  o = vec4(mix(acc, cam, a), 1.0);
}`;

// --- PANTALLA -------------------------------------------------------------------

// Lleva la imagen procesada al lienzo con zoom y desplazamiento. Al achicar
// (la imagen tiene más píxeles que la pantalla) promedia cuatro muestras de un
// nivel de mipmap acorde, para no generar moiré sobre la textura de la roca; al
// ampliar usa interpolación bicúbica, más nítida que la bilineal.
const DISPLAY = HEAD + `
uniform sampler2D uOut;
uniform sampler2D uOrig;
uniform vec2 uImg;
uniform vec2 uCanvas;
uniform vec2 uCenter;
uniform float uScale;
uniform bool uCompare;
uniform float uSplit;
uniform float uLine;
vec3 bicubica(sampler2D t, vec2 u) {
  vec2 q = u - 0.5, i = floor(q), f = q - i;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  ivec2 b = ivec2(i) - 1, mx = ivec2(uImg) - 1;
  vec3 acc = vec3(0.0);
  for (int y = 0; y < 4; y++) {
    float wy = y == 0 ? w0.y : y == 1 ? w1.y : y == 2 ? w2.y : w3.y;
    for (int x = 0; x < 4; x++) {
      float wx = x == 0 ? w0.x : x == 1 ? w1.x : x == 2 ? w2.x : w3.x;
      acc += wx * wy * texelFetch(t, clamp(b + ivec2(x, y), ivec2(0), mx), 0).rgb;
    }
  }
  return clamp(acc, 0.0, 1.0);
}
vec3 muestra(sampler2D t, vec2 u) {
  if (uScale >= 1.0) return bicubica(t, u);
  float lod = max(0.0, log2(0.5 / uScale));
  float d = 0.25 / uScale;
  return 0.25 * (textureLod(t, (u + vec2(-d, -d)) / uImg, lod).rgb + textureLod(t, (u + vec2(d, -d)) / uImg, lod).rgb
               + textureLod(t, (u + vec2(-d, d)) / uImg, lod).rgb + textureLod(t, (u + vec2(d, d)) / uImg, lod).rgb);
}
void main() {
  vec2 X = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 u = uCenter + (X - uCanvas * 0.5) / uScale;
  if (u.x < 0.0 || u.y < 0.0 || u.x >= uImg.x || u.y >= uImg.y) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 c = (uCompare && X.x > uSplit) ? muestra(uOrig, u) : muestra(uOut, u);
  if (uCompare && abs(X.x - uSplit) < uLine) c = vec3(1.0);
  o = vec4(c, 1.0);
}`;

export const FRAGMENTS: Record<string, string> = {
  red: RED,
  white: WHITE,
  black: BLACK,
  bichrome: BICHROME,
  crgb: CRGB,
  dslab: DSLAB,
  lds: LDS,
  ybk: YBK,
  clahe: CLAHE,
  map: MAP,
  relief: RELIEF,
  petro: PETRO,
  reliefEdge: RELIEF_EDGE,
  petroL: PETRO_L,
  pyrDown: PYR_DOWN,
  box: BOX,
  reduceFirst: REDUCE_FIRST,
  reduce: REDUCE,
  statsEma: STATS_EMA,
  copy: COPY,
  sample: SAMPLE,
  denoise: DENOISE,
  display: DISPLAY,
};
