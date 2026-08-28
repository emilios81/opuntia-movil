# OpuntiaColor v3.5.0 — versión móvil

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

## Instalación en el celular o la tablet

No está en Google Play ni en la App Store, y no hay que descargar ningún archivo:
se abre el enlace y se instala desde el menú del propio navegador.

**Antes de salir al campo:** abrila una vez con señal y dejá que cargue del todo.
Esa primera visita es la que guarda la aplicación en el equipo; a partir de ahí
funciona entera sin conexión.

**Android (Chrome)**
1. Abrir <https://emilios81.github.io/opuntia-movil/> en Chrome.
2. Tocar el menú de tres puntos, arriba a la derecha.
3. Elegir «Instalar aplicación» o «Agregar a la pantalla principal» y confirmar.

**iPhone y iPad (Safari)**
1. Abrir el mismo enlace en Safari (otros navegadores pueden no ofrecer la opción).
2. Tocar el botón Compartir, el cuadrado con la flecha hacia arriba.
3. Deslizar y elegir «Añadir a pantalla de inicio», después «Añadir».

En Chrome o Edge de escritorio aparece un ícono de instalar al final de la barra
de direcciones, pero en la computadora conviene usar la
[versión de escritorio](https://emilios81.github.io/opuntiacolor/), que es más
completa.

La primera vez que se abre el Modo Live el equipo pide permiso para la cámara;
hace falta solo para ese modo. Si no aparece la opción de instalar, verificar que
la dirección empiece con `https://`: la cámara y la instalación requieren HTTPS.
Aun sin instalarla, la app funciona abriéndola en el navegador.

## Características

- **Doce filtros alineados con la referencia v3.5.0** — Rojo, Blanco, Negro,
  Bicromo, CRGB, DS-LAB, LDS, Micro-relieve, Relieve, YBK, CLAHE y Mapa de
  pigmentos. La salida coincide píxel a píxel con la versión de escritorio, y hay
  una prueba que lo comprueba: `npm run verificar`.
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

## v3.5.0 — LDS deja de virar a violeta

**Cambia los resultados de LDS.** Las imágenes procesadas con v3.4.0 o anteriores
**no son reproducibles** con esta versión: para compararlas hay que reprocesarlas.
Los demás filtros no se tocaron.

Hasta v3.4.0 la normalización final de LDS tomaba el **mínimo y el máximo
absolutos de cada canal**, y de ahí salían dos defectos encadenados:

1. *Un solo píxel extremo definía el rango.* El blanqueo amplifica la componente
   principal más chica —la cromática—, así que cualquier valor extremo queda
   disparado. Con una tarjeta de color, una mano o un brillo especular en el
   encuadre, esos píxeles fijaban el rango y **toda la superficie rupestre
   quedaba comprimida en una fracción de la escala**.
2. *Estirar cada canal por separado destruye el tono.* Una roca marrón (R > G > B)
   podía salir azul violácea (B > G > R), justo lo contrario de lo que LDS
   promete.

Ahora el rango sale de las **vallas de Tukey** (`Q1 − 3·IQR`, `Q3 + 3·IQR`), que
no se mueven por más extremo que sea un objeto del encuadre, y la salida se arma
con una ganancia y un desplazamiento **comunes a los tres canales**, de modo que
el orden de los canales no puede invertirse.

Es el mismo cambio que la versión de escritorio introdujo en su v3.5.0; acá está
portado y verificado byte a byte con `npm run verificar`.

### Doble precisión en los filtros de decorrelación

Junto con lo anterior, CRGB, DS-LAB, LDS e YBK pasaron a calcularse en
`Float64Array` donde antes usaban `Float32Array`, que es lo que hace el
escritorio. Sobre valores fraccionarios —L\*a\*b\*, Y/Cb/Cr, componentes
principales— el error de ~1e-5 de la simple precisión alcanzaba para que algún
píxel cayera del otro lado del redondeo final.

**El efecto es mínimo pero no es nulo:** sobre el juego de pruebas cambia 1 byte
de cada 297.920 (0,0003%), y siempre en 1 nivel. CRGB no cambia en absoluto,
porque parte de valores enteros. **No invalida material publicado** —a diferencia
del cambio de LDS de más arriba—, pero conviene consignarlo.

Lo que sí destraba es la comparación: con esto `npm run verificar` da las 100
comparaciones idénticas byte a byte. Un nivel en un píxel suelto no cambia
ninguna lectura arqueológica, pero rompía la única garantía de que una foto
procesada en el celular y otra en la computadora sean exactamente el mismo dato.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:9002
npm run build      # sitio estático en out/
npm run verificar  # compara el motor contra la versión de escritorio
```

`npm run verificar` compila `src/lib/image-processing.ts` y corre sus filtros y
los de `../OpuntiaColor/src/app.jsx` sobre las mismas imágenes sintéticas,
comparando byte a byte. Son dos implementaciones distintas —TypeScript contra
JSX—, así que la alineación no se ve leyendo el código. **Toda modificación del
motor tiene que pasar por ahí antes de publicar:** si las dos apps divergen, dos
fotos del mismo panel dan resultados distintos según el aparato y el dato deja de
ser comparable. Si el proyecto de escritorio está en otra carpeta:

```bash
node tests/comparar-con-escritorio.js "D:/ruta/OpuntiaColor/src/app.jsx"
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
[10.5281/zenodo.21845134](https://doi.org/10.5281/zenodo.21845134); el de v3.5.0
lo asigna Zenodo al publicar la versión. Los datos
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
