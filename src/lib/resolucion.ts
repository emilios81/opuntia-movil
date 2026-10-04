/*
 * OPC móvil — tamaño de trabajo de una foto
 *
 * Copyright (C) 2025-2026  Emilio A. Villafañez
 * LATDAA – Universidad Nacional de Catamarca (UNCa), Argentina
 * GNU General Public License v3.0 o posterior. Ver LICENSE.
 *
 * Es el mismo cálculo que `computeSize` de la versión de escritorio
 * (OpuntiaColor/src/app.jsx): el lado mayor se lleva al tope y el otro se
 * redondea con Math.round. Lo único que cambia es el tope de la resolución
 * completa. El escritorio llega a 8192 px; el celular, a 4096, porque CRGB,
 * DS-LAB y LDS piden unos 52 bytes por píxel: una foto de 12 MP ocupa ~700 MB y
 * una de 24 MP ~1,35 GB, que en un celular cierra la pestaña. Hasta 4096 px
 * (las fotos normales de celular y las capturas 4K del modo en vivo) el tamaño
 * es el mismo que en el escritorio y la salida coincide byte a byte; por
 * encima, la foto se reduce y la interfaz lo avisa.
 *
 * tests/comparar-con-escritorio.js compara esta función con la del escritorio.
 */

export const TOPE_ESCRITORIO = 8192;
export const TOPE_CELULAR = 4096;
export const LADO_REDUCIDO = 2000;

export function tamanoDeTrabajo(ancho: number, alto: number, completa: boolean, tope: number = TOPE_CELULAR) {
  const mx = completa ? tope : LADO_REDUCIDO;
  let w = ancho, h = alto;
  if (w > mx || h > mx) { const s = mx / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
  return { w, h };
}
