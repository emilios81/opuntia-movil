# OpuntiaColor v3.6.2 — versión móvil

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

La primera vez que se abre la cámara **En vivo** el equipo pide permiso para
usarla; hace falta solo para ese modo. Si no aparece la opción de instalar, verificar que
la dirección empiece con `https://`: la cámara y la instalación requieren HTTPS.
Aun sin instalarla, la app funciona abriéndola en el navegador.

## Características

- **Doce filtros alineados con la referencia v3.6.0** — Rojo, Blanco, Negro,
  Bicromo, CRGB, DS-LAB, LDS, Micro-relieve, Relieve, YBK, CLAHE y Mapa de
  pigmentos. La salida coincide píxel a píxel con la versión de escritorio, y hay
  una prueba que lo comprueba: `npm run verificar`.
- **Fotos a resolución completa** — se procesan a su tamaño real, como en el
  escritorio, hasta 4096 px de lado, que es lo que aguanta la memoria de un
  celular. Con 2000 px va más rápido.
- **En vivo** — los doce filtros sobre la cámara, para recorrer un panel antes
  de fotografiarlo. Se calculan en la GPU a la resolución que entregue la
  cámara: **Full HD o 4K**.
- **Reducción de ruido, zoom y comparación en vivo** — promedio de cuadros con
  detección de movimiento, zoom con dos dedos hasta ver el píxel, línea
  divisoria contra el original y pantalla completa, con intensidad, contraste y
  saturación a mano.
- **Fijar colores** — congela las estadísticas de la decorrelación para que un
  pigmento conserve su color al mover la cámara.
- **Capturar** — el cuadro en vivo pasa a la vista de foto y se procesa con el
  motor de referencia, con todo lo demás: zona, acumulación, descarga y
  reporte.
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
- **Español e inglés** — la interfaz completa en los dos idiomas, con un botón
  en la cabecera.

## v3.6.2 — Interfaz en inglés y logo original

**No cambia ningún resultado.** El motor y el tamaño de trabajo no se tocaron:
`npm run verificar` sigue dando las 142 comparaciones idénticas.

- **Interfaz en español e inglés.** El botón **EN / ES** de la cabecera cambia
  el idioma. La primera vez se toma el del navegador y después se recuerda. Usa
  la misma convención y los mismos nombres de filtros que la versión de
  escritorio, y también la misma preferencia guardada: las dos apps viven en el
  mismo dominio, así que elegir inglés en una lo elige en la otra. El nombre de
  los archivos descargados no cambia con el idioma, porque lleva el id interno
  del filtro. El reporte PDF sigue en inglés, como antes.
- **El logo original en la cabecera**, el mismo del ícono de la app instalada.
  Hasta ahora la cabecera llevaba otro dibujo, hecho a mano.
- **Cabecera reordenada para el celular.** El nombre y la versión van uno debajo
  del otro, y el botón del reporte dice *PDF*. Con el botón de idioma no entraban
  en una pantalla angosta; ya antes el de *Reporte* quedaba cortado contra el
  borde.
- **En vivo, a pantalla completa:** la intensidad pasa adentro de **Ajustes**,
  junto con contraste y saturación, y la pantalla queda limpia hasta que se la
  llama. Los deslizadores se pintan para fondo oscuro, con la parte recorrida en
  blanco: con los colores de antes esa parte se perdía contra el negro y parecían
  avanzar al revés.
- **Modo de campo legible.** Lo seleccionado quedaba blanco sobre blanco: el
  botón EN VIVO, la versión, el filtro elegido y las opciones activas. Además, el
  fondo de la página seguía beige debajo de los textos blancos. Ahora todo se lee.
  Los botones de la cabecera dejan de ser blancos sobre beige.

### Numeración

Desde esta versión, el número del medio acompaña al de la versión de escritorio
con la que la móvil está alineada (3.6.x ↔ escritorio 3.6.0), y cada tanda de
cambios sube el último. Por eso la versión anterior, que estuvo publicada unas
horas como 3.7.0, pasó a llamarse 3.6.1. Si una tanda cambia resultados, se avisa
en su sección, en negrita, como en v3.6.1.

## v3.6.1 — Las fotos a resolución completa

*Estuvo publicada unas horas como 3.7.0 y se renumeró: ver la numeración en
v3.6.2.*

**Cambia los resultados con los valores por defecto.** Hasta v3.6.0 toda foto se
achicaba a 2000 px de lado antes de procesarla. Ahora se procesa a su resolución
real, como hace el escritorio desde su v3.6.0. Micro-relieve, Relieve y CLAHE
dependen de la escala, así que lo procesado con v3.6.0 o anteriores no es
comparable sin reprocesar. **Para reproducirlo, elegir 2000 px:** con esa opción
el cálculo es el mismo de antes y la salida, idéntica.

### Por qué

Con el tope de 2000 px la misma foto daba un resultado en el celular y otro en la
computadora, y se perdía lo que justifica tener dos versiones: que el dato no
dependa del aparato. Además el modo en vivo filma en 4K, pero Capturar achicaba
el cuadro a 2000 px antes de analizarlo.

### El tope del celular: 4096 px

El escritorio llega a 8192 px y el celular a 4096. Se midió cuánta memoria pide
el motor según el tamaño de la foto. Los filtros de decorrelación (CRGB, DS-LAB y
LDS) son los que más piden, unos 52 bytes por píxel:

| Foto | Píxeles | Pico de memoria medido |
|---|---|---|
| 2000 × 1500 (el tope anterior) | 3 MP | ~200 MB |
| 4032 × 3024 (celular típico) | 12 MP | ~700 MB |
| 5712 × 4284 (iPhone 15 en adelante) | 24 MP | ~1,35 GB |
| 8160 × 6120 (modo de 50 MP) | 50 MP | ~2,7 GB |

Pasado el giga, lo más probable es que el sistema del celular cierre la pestaña.
Con 4096 px entran enteras las fotos de 12 MP, que es lo que guarda por defecto
la mayoría de los celulares, y las capturas 4K del modo en vivo. Para esas fotos
el tamaño de trabajo es el mismo que en el escritorio y la salida coincide byte a
byte. Una foto más grande se reduce a 4096 px y el panel lo avisa en rojo; para
procesarla entera está el escritorio.

### En el panel

- **Resolución de trabajo**, arriba de todo, antes de los filtros: *Completa* o
  *2000 px*, y debajo el tamaño que se va a procesar. Mientras se trabaja por
  debajo de la resolución real, sea por elección o por el tope, el recuadro queda
  en rojo. Aparece solo si la foto pasa de 2000 px.
- A resolución completa cada filtro tarda más: en un celular, varios segundos.
  La imagen resultante se codifica sin congelar la pantalla, y al mover contraste
  o saturación un aviso indica que se está aplicando.
- El **reporte PDF** lleva la imagen procesada a 2000 px como máximo. En la hoja
  ocupa unos 8 cm, y con 12 MP el PDF se volvía lento e inmanejable. La imagen a
  resolución completa se baja con *Descargar*.

### En vivo

- Sale **HD**: en el celular no se distinguía de Full HD. Quedan **Full HD** y
  **4K**, que sigue siendo la opción por defecto. Quien tenía HD elegido pasa a
  Full HD.
- A pantalla completa, el botón **Ajustes**, al costado derecho, cambia la tira
  de filtros por los deslizadores de **intensidad, contraste y saturación**. Va al
  costado porque en la fila de abajo no entraba otro botón sin achicarlos a todos.

### Textos

Las explicaciones de los paneles (Fijar colores, Reducción de ruido, Selección,
Acumular…) pasan de 9 a 10,5 px, y otros rótulos chicos suben un punto: en el
celular no se leían.

### Verificación

`npm run verificar` suma la comparación del tamaño de trabajo contra
`computeSize` del escritorio: son 142 comparaciones, todas idénticas. El motor de
filtros no se tocó.

## v3.6.0 — En vivo: la cámara a resolución completa, en la GPU

**No cambia ningún resultado de las fotos.** El motor de referencia
(`src/lib/image-processing.ts`) no se tocó, y `npm run verificar` sigue dando las
100 comparaciones idénticas byte a byte con el escritorio.

Lo que cambia es el modo en vivo, que además deja de llamarse *Live*.

### Por qué las dos calidades de antes se veían iguales

Hasta v3.5.0 cada cuadro pasaba por el mismo motor que las fotos: JavaScript en
el procesador, un píxel detrás de otro. Para que el video no se arrastrara había
que achicarlo a 480 o 720 px de ancho, y en un visor que ocupa media pantalla de
celular las dos opciones quedaban prácticamente del tamaño de la pantalla: no
había diferencia que ver. Además la decorrelación amplifica el granulado de color
del sensor, y en video ese ruido estaba siempre a la vista.

### Qué hay ahora

- **Los doce filtros corren en la GPU** (WebGL2), que procesa miles de píxeles a
  la vez. El video se procesa a la resolución que entrega la cámara, sin achicar.
  Se elige **HD** (1280 × 720), **Full HD** (1920 × 1080) o **4K**
  (3840 × 2160); si la cámara no llega a lo pedido, se trabaja con lo máximo que
  dé y la pantalla lo dice. La elección se recuerda.
- **Pantalla completa**, con los controles sobre la imagen: tira de filtros,
  intensidad, pausa, captura y comparación.
- **Zoom con dos dedos** (o rueda del mouse), desplazamiento con un dedo y doble
  toque para acercar o volver. Es donde el 4K se nota: a pantalla entera un
  celular no muestra más de unos 1.200 px de ancho, y el resto del detalle
  aparece al acercarse.
- **Reducción de ruido temporal** (No / Media / Alta): promedia los últimos
  cuadros donde la imagen está quieta y toma el cuadro nuevo entero donde hubo
  movimiento, para no dejar estelas. Con el equipo firme, Media baja el ruido a
  menos de la mitad y Alta a la cuarta parte (medido: de 5,0 a 2,1 y a 1,3
  niveles).
- **Comparar con el original**: línea divisoria arrastrable, como en las fotos.
- **Fijar colores**: congela las estadísticas de la decorrelación. Sin esto,
  cada encuadre recalcula la base y el mismo pigmento puede cambiar de color al
  mover la cámara.
- **Pausar** congela el cuadro: se puede acercar, comparar y probar filtros sobre
  él.
- **Capturar** pasa el cuadro a la vista de foto (en PNG, sin compresión con
  pérdida) y lo procesa con el **motor de referencia**. Como un cuadro de video
  no trae EXIF, se anotan la fecha, la resolución y la cámara; las coordenadas
  no, y la app lo avisa.
- **La pantalla no se apaga** mientras el modo en vivo está abierto.
- **Linterna**, en los equipos que la ofrecen al navegador (Chrome en Android).

Si el equipo no tiene WebGL2 con texturas flotantes, el modo en vivo sigue
funcionando como antes, en la CPU, a 720 px como máximo.

### Qué tan igual es el video al motor de referencia

La GPU calcula en precisión simple y, en vivo, las estadísticas de la
decorrelación salen de una muestra de unos 130.000 píxeles del cuadro, tomada a
intervalos regulares de la grilla. `npm run verificar-gpu` mide la diferencia con
el motor de referencia sobre imágenes sintéticas de hasta 4K, filtro por filtro:

- **Con las estadísticas de todos los píxeles**, los doce filtros coinciden salvo
  por diferencias de un nivel en una fracción mínima de los valores (como mucho
  el 2 %, casi siempre menos del 0,1 %).
- **Con la muestra que se usa en vivo**, la diferencia media queda por debajo de
  un nivel en los doce filtros (la mayor, DS-LAB a intensidad 3, 0,93).

Alcanza y sobra para explorar en pantalla, pero no es igualdad byte a byte. Por
eso **el registro sale de Capturar**, que procesa el cuadro con el motor de
referencia: el mismo resultado que daría el escritorio sobre esa imagen.

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
npm run verificar-gpu  # compara el motor en vivo (GPU) contra el de referencia
```

`npm run verificar` compila `src/lib/image-processing.ts` y corre sus filtros y
los de `../OpuntiaColor/src/app.jsx` sobre las mismas imágenes sintéticas,
comparando byte a byte. También compara el tamaño de trabajo de las fotos
(`src/lib/resolucion.ts`) con el que calcula el escritorio. Son dos
implementaciones distintas —TypeScript contra JSX—, así que la alineación no se
ve leyendo el código. **Toda modificación del
motor tiene que pasar por ahí antes de publicar:** si las dos apps divergen, dos
fotos del mismo panel dan resultados distintos según el aparato y el dato deja de
ser comparable. Si el proyecto de escritorio está en otra carpeta:

```bash
node tests/comparar-con-escritorio.js "D:/ruta/OpuntiaColor/src/app.jsx"
```

`npm run verificar-gpu` no termina solo: compila los dos motores, los sirve en
<http://localhost:9013> y deja una página para abrir en un navegador con WebGL2,
que corre los doce filtros en la GPU y en el motor de referencia y muestra cuánto
se apartan. Toda modificación de `live-shaders.ts`, `live-stats.ts` o
`live-gpu.ts` tiene que pasar por ahí.

El motor de filtros está en `src/lib/image-processing.ts` y la interfaz en
`src/app/page.tsx`. No hay servidor: todo el procesamiento ocurre en el
navegador, sobre `canvas` las fotos y sobre WebGL2 el video en vivo.

## Publicación

Cada push a `main` dispara `.github/workflows/deploy.yml`, que compila y publica
en GitHub Pages. En **Settings → Pages** del repositorio, *Source* tiene que
estar en **GitHub Actions**.

El sitio vive en una subcarpeta (`/opuntia-movil/`), definida por `basePath` en
`next.config.ts`. Si se publica en la raíz de un dominio propio, compilar con
`NEXT_PUBLIC_BASE_PATH=""`.

> La cámara y la instalación como app requieren HTTPS. GitHub Pages lo provee;
> abrir el sitio por IP de red local (http://) deja la cámara en vivo sin funcionar.

## Estructura

```
src/lib/image-processing.ts   motor de los doce filtros (el de referencia)
src/lib/resolucion.ts         tamaño de trabajo de las fotos (el cálculo del escritorio)
src/lib/idioma.ts             español e inglés: tr(es, en), la misma convención del escritorio
src/lib/version.ts            la versión, en un solo lugar para todo el código
src/lib/live-shaders.ts       los doce filtros portados a la GPU (GLSL)
src/lib/live-stats.ts         estadísticas del video en vivo, con el mismo motor
src/lib/live-gpu.ts           motor en vivo: cuadros, ruido, filtros y pantalla
src/lib/exif-utils.ts         lectura de EXIF y GPS
src/lib/pdf-report.ts         armado del reporte
src/app/page.tsx              interfaz completa
src/components/               visor en vivo, CompareSlider, registro de la PWA
src/components/ui/            los ocho componentes de shadcn que se usan
public/sw.js                  service worker (el que da el modo offline)
tests/                        las dos verificaciones contra el motor de referencia
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

Los DOI de cada versión son: v3.4.0
[10.5281/zenodo.21845134](https://doi.org/10.5281/zenodo.21845134), v3.5.0
[10.5281/zenodo.22145677](https://doi.org/10.5281/zenodo.22145677) y v3.6.2
[10.5281/zenodo.23147164](https://doi.org/10.5281/zenodo.23147164). La v3.6.2
cubre también la 3.6.0 y la 3.6.1, que no tienen DOI propio: la 3.6.0 da las
mismas fotos que la 3.5.0, y la 3.6.1 las mismas que la 3.6.2. Los datos
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
