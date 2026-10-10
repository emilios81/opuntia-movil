// Versión de la app, en un solo lugar para todo el código (cabecera,
// información, pie, reporte PDF y título). Fuera del código también hay que
// cambiarla en package.json, public/manifest.json, public/sw.js (CACHE_NAME),
// CITATION.cff, .zenodo.json y el título del README.
//
// Numeración: el número del medio acompaña al de la versión de escritorio con
// la que la móvil está alineada (3.7.x ↔ escritorio 3.7.0), y cada tanda de
// cambios sube el último. Si una tanda cambia resultados, lo dice el README.
export const VERSION = "3.7.0";
