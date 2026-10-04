"use client"

/*
 * Idioma de la interfaz: español o inglés, con la misma convención que la
 * versión de escritorio. El español es la fuente y la traducción va al lado,
 * en el mismo lugar del código: tr("Intensidad", "Intensity"). Todo texto de
 * interfaz nuevo tiene que llevar los dos.
 *
 * La elección se guarda con la misma clave que el escritorio (opc_lang). Las
 * dos apps viven en el mismo dominio (emilios81.github.io), así que comparten
 * la preferencia. En la primera visita sale del idioma del navegador.
 *
 * Traducir no toca ningún resultado: los archivos que se descargan se nombran
 * con el id interno del filtro (lds, red, petro…), no con la etiqueta visible.
 */
import { createContext, useContext } from 'react';

export type Idioma = 'es' | 'en';

export const IdiomaContext = createContext<Idioma>('es');

export function traductor(lang: Idioma) {
  return (es: string, en: string) => (lang === 'en' ? en : es);
}

export function useIdioma() {
  const lang = useContext(IdiomaContext);
  return { lang, tr: traductor(lang) };
}

export function idiomaGuardado(): Idioma {
  try {
    const v = window.localStorage.getItem('opc_lang');
    if (v === 'es' || v === 'en') return v;
  } catch { /* sin almacenamiento */ }
  try {
    return /^es/i.test(navigator.language || '') ? 'es' : 'en';
  } catch { /* sin navigator */ }
  return 'es';
}

export function guardarIdioma(lang: Idioma) {
  try { window.localStorage.setItem('opc_lang', lang); } catch { /* sin almacenamiento */ }
}
