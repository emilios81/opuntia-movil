/*
 * OPC móvil — verificación de alineación con la versión de escritorio
 *
 * Copyright (C) 2025-2026  Emilio A. Villafañez
 * LATDAA – Universidad Nacional de Catamarca (UNCa), Argentina
 * GNU General Public License v3.0 o posterior. Ver LICENSE.
 *
 *   npm run verificar
 *   node tests/comparar-con-escritorio.js [ruta/a/OpuntiaColor/src/app.jsx]
 *
 * La móvil y el escritorio son dos implementaciones distintas del mismo motor
 * (TypeScript contra JSX). La alineación NO se ve leyendo el código: hay que
 * correr las dos sobre las mismas imágenes y comparar byte a byte. Así
 * aparecieron desvíos que la lectura no mostraba (YBK sin acotar Y/Cb/Cr, CLAHE
 * con pesos negativos en los bordes, LDS con los pesos de blanqueo congelados).
 *
 * Toda modificación del motor tiene que pasar por acá ANTES de publicar: si las
 * dos apps divergen, dos fotos del mismo panel dan resultados distintos según el
 * aparato y el dato deja de ser comparable.
 *
 * Requiere el motor ya compilado a CommonJS:
 *   npx tsc src/lib/image-processing.ts --outDir <tmp> --module commonjs \
 *           --target es2017 --skipLibCheck
 * (`npm run verificar` lo hace solo.)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const RAIZ = path.join(__dirname, "..");
const ESCRITORIO = process.argv[2] ||
  process.env.OPC_ESCRITORIO ||
  path.join(RAIZ, "..", "OpuntiaColor", "src", "app.jsx");

if (!fs.existsSync(ESCRITORIO)) {
  console.error("\nNo encuentro el fuente del escritorio en:\n  " + ESCRITORIO +
    "\n\nPasalo como argumento o en la variable OPC_ESCRITORIO:\n" +
    "  node tests/comparar-con-escritorio.js \"D:/ruta/OpuntiaColor/src/app.jsx\"\n");
  process.exit(2);
}

// ---------------------------------------------------------------- ImageData
class ImageData {
  constructor(data, width, height) {
    if (typeof data === "number") { height = width; width = data; data = new Uint8ClampedArray(width * height * 4); }
    this.data = data; this.width = width; this.height = height;
  }
}
global.ImageData = ImageData;

// ------------------------------------------------- el motor de la móvil
// Se compila a un directorio temporal: la prueba corre siempre contra el
// TypeScript actual, nunca contra un compilado que quedó viejo.
const salida = fs.mkdtempSync(path.join(os.tmpdir(), "opc-movil-"));
try {
  execFileSync("npx", ["tsc", path.join("src", "lib", "image-processing.ts"),
    "--outDir", salida, "--module", "commonjs", "--target", "es2017", "--skipLibCheck"],
    { cwd: RAIZ, stdio: "pipe", shell: true });
} catch (e) {
  console.error("\nNo compila src/lib/image-processing.ts:\n" + (e.stdout || e.message).toString());
  process.exit(2);
}
const movil = require(path.join(salida, "image-processing.js"));

// --------------------------------------------- el núcleo del escritorio
// src/app.jsx es JSX y desestructura React en el nivel superior, así que no se
// puede requerir: se extraen por nombre las funciones puras del núcleo, todas
// declaradas en el nivel superior y con la llave de cierre en la columna 0.
const fuente = fs.readFileSync(ESCRITORIO, "utf8").replace(/\r\n/g, "\n");

function extraer(nombre) {
  const marca = "\nfunction " + nombre + "(";
  const ini = fuente.indexOf(marca);
  if (ini === -1) throw new Error("no se encontró la función " + nombre + " en el fuente del escritorio");
  const fin = fuente.indexOf("\n}\n", ini);
  if (fin === -1) throw new Error("no se encontró el cierre de " + nombre);
  return fuente.slice(ini + 1, fin + 3);
}

const NUCLEO = ["rgb2lab", "lab2rgb", "rgb2ycbcr", "ycbcr2rgb",
                "meanCov3", "meanStd1", "jacobiEigen3", "tukeyFences",
                "crgbEnhance", "dsLabEnhance", "ldsEnhance", "ybkEnhance"];

const caja = {
  Math, Float64Array, Float32Array, Int32Array, Uint8ClampedArray, Uint8Array,
  Array, Number, Object, Infinity, console, ImageData,
};
vm.createContext(caja);
const CONSTANTES = ["LDS_TUKEY_K"].map(n => {
  const m = fuente.match(new RegExp("^const " + n + " = .+;$", "m"));
  if (!m) throw new Error("no se encontró la constante " + n + " en el fuente del escritorio");
  return m[0];
}).join("\n");
vm.runInContext(CONSTANTES + "\n" + NUCLEO.map(extraer).join("\n"), caja);

// Qué filtro de la móvil se compara contra qué función del escritorio.
const PARES = [
  ["LDS",     movil.lds,   caja.ldsEnhance],
  ["CRGB",    movil.crgb,  caja.crgbEnhance],
  ["DS-LAB",  movil.dslab, caja.dsLabEnhance],
  ["YBK",     movil.ybk,   caja.ybkEnhance],
];

// -------------------------------------------------- imágenes sintéticas
// Deterministas y sin archivos de entrada: la prueba da lo mismo en cualquier
// máquina y no depende de fotos que puedan faltar.
let semilla = 12345;
const rnd = () => { semilla = (semilla * 1103515245 + 12345) & 0x7fffffff; return semilla / 0x7fffffff; };

function generar(w, h, fn) {
  semilla = 12345;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fn(x, y, w, h);
    const i = (y * w + x) * 4;
    d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = 255;
  }
  return new ImageData(d, w, h);
}

function panel(conTarjeta) {
  return generar(120, 90, (x, y, w, h) => {
    const base = 110 + 30 * Math.sin(x / 17) + 20 * Math.cos(y / 13);
    let r = base * 1.15, g = base * 0.92, b = base * 0.70;              // roca marrón: R > G > B
    const dx = x - w / 2, dy = y - h / 2;
    if (dx * dx / 400 + dy * dy / 150 < 1) { r += 14; g -= 4; b -= 6; } // pigmento rojo tenue
    if (conTarjeta && x < 22 && y < 22) {
      const p = (x < 11 ? 0 : 1) + (y < 11 ? 0 : 2);
      return [[255,0,0],[0,255,0],[0,0,255],[255,255,0]][p];
    }
    return [r + rnd() * 3, g + rnd() * 3, b + rnd() * 3];
  });
}

// `degenerado` marca las entradas para las que la decorrelación no está
// definida: con varianza cero no hay componentes principales que ordenar ni
// dispersión que ecualizar, así que cada implementación puede caer en un valor
// distinto sin que ninguna esté mal. Esas diferencias se informan pero no
// cuentan como regresión: si contaran, la prueba quedaría siempre en rojo y
// dejaría de servir para detectar desvíos reales.
const CASOS = [
  { nombre: "panel de roca con motivo tenue", img: panel(false) },
  { nombre: "el mismo panel con tarjeta de color en el encuadre", img: panel(true) },
  { nombre: "brillo especular puntual", img: generar(80, 60, (x, y) => {
      if (x === 40 && y === 30) return [255, 255, 255];
      const base = 100 + 15 * Math.sin(x / 9);
      return [base * 1.1, base * 0.95, base * 0.8];
    }) },
  { nombre: "ruido a pleno rango", img: generar(64, 64, () => [rnd() * 255, rnd() * 255, rnd() * 255]) },
  { nombre: "imagen plana (varianza cero)", img: generar(40, 40, () => [128, 100, 80]), degenerado: true },
];

const INTENSIDADES = [0.5, 1.0, 1.5, 2.0, 3.0];

// ------------------------------------------------------------ comparación
let corridas = 0, iguales = 0;
const regresiones = [], degeneradas = [];

console.log("\n\x1b[1mOPC móvil contra escritorio — salida byte a byte\x1b[0m");
console.log("escritorio: " + ESCRITORIO + "\n");

for (const [filtro, fnMovil, fnEscritorio] of PARES) {
  console.log("\x1b[1m" + filtro + "\x1b[0m");
  for (const caso of CASOS) {
    for (const I of INTENSIDADES) {
      corridas++;
      const base = caso.img;
      const copia = () => new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
      const a = fnEscritorio(copia(), I, null, null).data;
      const b = fnMovil(copia(), I, null, {}).data;

      let distintos = 0, maxDif = 0, primero = -1;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d !== 0) { distintos++; if (primero < 0) primero = i; if (d > maxDif) maxDif = d; }
      }
      const etiqueta = caso.nombre + "  I=" + I.toFixed(1);
      const detalle = distintos + "/" + a.length + " bytes distintos, dif. máx " + maxDif +
        ", primero en el byte " + primero + " (escritorio " + a[primero] + " vs móvil " + b[primero] + ")";

      if (distintos === 0) {
        iguales++;
        console.log("  \x1b[32m✓\x1b[0m " + etiqueta);
      } else if (caso.degenerado) {
        degeneradas.push(filtro + " · " + etiqueta);
        console.log("  \x1b[33m~\x1b[0m " + etiqueta + "  \x1b[33m(degenerado, informativo)\x1b[0m");
        console.log("    \x1b[33m" + detalle + "\x1b[0m");
      } else {
        regresiones.push(filtro + " · " + etiqueta + " — " + detalle);
        console.log("  \x1b[31m✗\x1b[0m " + etiqueta);
        console.log("    \x1b[31m" + detalle + "\x1b[0m");
      }
    }
  }
}

fs.rmSync(salida, { recursive: true, force: true });

console.log("\n\x1b[1mResumen\x1b[0m — " + corridas + " comparaciones");
console.log("  idénticas byte a byte: " + iguales);
if (degeneradas.length) console.log("  \x1b[33mdistintas en entradas degeneradas (no cuentan): " + degeneradas.length + "\x1b[0m");
if (regresiones.length) {
  console.log("  \x1b[31mdivergencias reales: " + regresiones.length + "\x1b[0m");
  for (const r of regresiones) console.log("    \x1b[31m- " + r + "\x1b[0m");
  console.log("\n\x1b[31mHay divergencias sobre imágenes normales: no publicar así.\x1b[0m\n");
} else {
  console.log("\n\x1b[32mSobre imágenes normales los dos motores dan la misma salida.\x1b[0m\n");
}
process.exit(regresiones.length === 0 ? 0 : 1);
