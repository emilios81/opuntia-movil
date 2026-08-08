# OpuntiaColor v3.4.0 — versión móvil

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21845133.svg)](https://doi.org/10.5281/zenodo.21845133)
[![Licencia: GPL v3+](https://img.shields.io/badge/licencia-GPL--3.0--or--later-blue.svg)](LICENSE)

Realce de arte rupestre en el campo. Doce filtros de decorrelación —el mismo
motor que la versión de escritorio— sobre fotos o sobre la cámara en vivo, con
selección de zona y reportes PDF con EXIF y GPS.

Es una PWA: se instala en el celular o la tablet y, después de la primera
visita, **funciona entera sin conexión**. Todo el procesamiento ocurre en el
dispositivo sobre `canvas`; no hay servidor, no se sube ninguna imagen a ningún
lado y no hace falta señal para trabajar.

**App:** <https://emilios81.github.io/opuntia-movil/>
**Versión de escritorio:** <https://emilios81.github.io/opuntiacolor/>

## Características

- **Doce filtros alineados con la referencia v3.4.0** — Rojo, Blanco, Negro,
  Bicromo, CRGB, DS-LAB, LDS, Micro-relieve, Relieve, YBK, CLAHE y Mapa de
  pigmentos. La salida coincide píxel a píxel con la versión de escritorio.
- **Modo Live** — decorrelación en tiempo real sobre la cámara, para explorar
  un panel antes de fotografiarlo.
- **Modo Live con resolución elegible** — 480 px o 720 px por cuadro, según lo
  que aguante el equipo, sin ampliar nunca por encima de lo que da la cámara.
- **Selección de zona** — rectángulo, círculo o mano alzada sobre la imagen. El
  filtro se aplica solo ahí y, en los filtros de decorrelación (CRGB, DS-LAB,
  LDS, YBK), las estadísticas se calculan con los datos de esa zona: mejor
  separación de pigmentos locales, como en DStretch.
- **Acumular filtros** — cada filtro se aplica sobre el resultado del anterior
  en vez de partir siempre de la imagen original.
- **Sin conexión** — tras la primera visita la app queda completa en el
  dispositivo: código, tipografías e iconos. No pide nada a la red para
  procesar.
- **Metadatos a la vista** — coordenadas, altitud, fecha de captura y equipo se
  leen del EXIF y se muestran en pantalla, con las coordenadas copiables al
  portapapeles. Si la foto no las trae, lo dice: estando todavía en el sitio se
  puede repetir la toma.
- **Reportes PDF** con esos mismos metadatos y las dos imágenes.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:9002
npm run build      # sitio estático en out/
```

El motor de filtros está en `src/lib/image-processing.ts` y la interfaz en
`src/app/page.tsx`. No hay servidor: todo el procesamiento ocurre en el
navegador sobre `canvas`.

## Publicación

Cada push a `main` dispara `.github/workflows/deploy.yml`, que compila y publica
en GitHub Pages. En **Settings → Pages** del repositorio, *Source* tiene que
estar en **GitHub Actions**.

El sitio vive en una subcarpeta (`/opuntia-movil/`), definida por `basePath` en
`next.config.ts`. Si se publica en la raíz de un dominio propio, compilar con
`NEXT_PUBLIC_BASE_PATH=""`.

> La cámara y la instalación como app requieren HTTPS. GitHub Pages lo provee;
> abrir el sitio por IP de red local (http://) deja el Modo Live sin funcionar.

## Estructura

```
src/lib/image-processing.ts   motor de los doce filtros
src/lib/exif-utils.ts         lectura de EXIF y GPS
src/lib/pdf-report.ts         armado del reporte
src/app/page.tsx              interfaz completa
src/components/               CompareSlider, logo, registro de la PWA
src/components/ui/            los ocho componentes de shadcn que se usan
public/sw.js                  service worker (el que da el modo offline)
```

El proyecto nació de un andamiaje de Firebase Studio que arrastraba Firestore,
Auth, flujos de genkit y treinta y tantos componentes de shadcn que nunca se
usaron. Nada de eso quedó: la app no habla con ninguna red en tiempo de
ejecución, y las dependencias son solo las que el código importa de verdad.

## Licencia y cita

**GPL-3.0-or-later**, la misma que la versión de escritorio: esta app porta su
motor de filtros, así que es obra derivada y comparte licencia. Ver
[LICENSE](LICENSE).

Si la usás en una publicación, citá el **DOI de concepto**, que resuelve siempre
a la última versión:

> [10.5281/zenodo.21845133](https://doi.org/10.5281/zenodo.21845133)

El DOI de la versión 3.4.0 en particular es
[10.5281/zenodo.21845134](https://doi.org/10.5281/zenodo.21845134). Los datos
completos de cita están en [CITATION.cff](CITATION.cff), y GitHub los ofrece ya
formateados en el botón *Cite this repository*.

El depósito declara `isDerivedFrom` sobre
[10.5281/zenodo.21796290](https://doi.org/10.5281/zenodo.21796290), el DOI del
proyecto de escritorio del que porta el motor.

## Nota metodológica

La intensidad significa cosas distintas en cada filtro y no es comparable entre
ellos: al publicar resultados hay que consignar el filtro y la intensidad. En
LDS la intensidad es el exponente de blanqueo γ = intensidad / 1.5, de modo que
el valor por defecto (1.5) reproduce exactamente la salida de v3.3.0.

---
*Dr. Emilio A. Villafañez · LATDAA · Fund. Félix de Azara · Universidad Nacional de Catamarca (UNCA), Argentina*
