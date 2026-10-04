/*
 * OPC móvil — verificación del motor en vivo (GPU) contra el motor de referencia
 *
 * Copyright (C) 2025-2026  Emilio A. Villafañez
 * LATDAA – Universidad Nacional de Catamarca (UNCa), Argentina
 * GNU General Public License v3.0 o posterior. Ver LICENSE.
 *
 *   npm run verificar-gpu
 *
 * El motor en vivo corre en la GPU, así que no se puede probar desde Node como
 * `npm run verificar`: hace falta un navegador con WebGL2. Este script compila
 * los dos motores, los sirve en http://localhost:9013 y deja la página de
 * prueba lista para abrir. La página pasa los doce filtros por los dos motores
 * sobre las mismas imágenes y muestra, para cada caso, qué fracción de los
 * valores difiere y por cuánto.
 *
 * A diferencia de `npm run verificar`, acá NO se espera igualdad byte a byte:
 * la GPU calcula en precisión simple y en vivo las estadísticas salen de una
 * muestra del cuadro. Lo que la prueba fija es cuánto se apartan, y avisa si
 * algún filtro se aparta más de lo razonable para explorar en pantalla.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");

const RAIZ = path.join(__dirname, "..");
const PUERTO = Number(process.env.PUERTO || 9013);

const salida = fs.mkdtempSync(path.join(os.tmpdir(), "opc-gpu-"));
const fuentes = ["image-processing.ts", "live-stats.ts", "live-shaders.ts", "live-gpu.ts"]
  .map(f => path.join("src", "lib", f));
try {
  execFileSync("npx", ["tsc", ...fuentes, "--outDir", salida, "--module", "es2020", "--target", "es2020",
    "--lib", "es2020,dom", "--skipLibCheck"], { cwd: RAIZ, stdio: "pipe", shell: true });
} catch (e) {
  console.error("\nNo compila el motor:\n" + (e.stdout || e.message).toString());
  process.exit(2);
}

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8" };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let archivo = null;
  if (url === "/") archivo = path.join(__dirname, "gpu", "verificar-gpu.html");
  else if (url === "/pagina.mjs") archivo = path.join(__dirname, "gpu", "verificar-gpu.mjs");
  else if (url.startsWith("/motor/")) {
    // Los import de TypeScript no llevan extensión: acá se le agrega.
    const base = path.join(salida, path.basename(url));
    archivo = fs.existsSync(base) ? base : base + ".js";
  }
  if (!archivo || !fs.existsSync(archivo)) { res.writeHead(404); res.end("no existe"); return; }
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo)] || "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
  fs.createReadStream(archivo).pipe(res);
}).listen(PUERTO, () => {
  console.log("\nMotor compilado en " + salida);
  console.log("Abrí en un navegador con WebGL2:\n\n  http://localhost:" + PUERTO + "/\n");
  console.log("(Ctrl+C para cerrar)\n");
});

process.on("SIGINT", () => { fs.rmSync(salida, { recursive: true, force: true }); process.exit(0); });
