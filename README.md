# OpuntiaColor v3.4.0 — versión móvil

Procesamiento de arte rupestre para arqueología profesional. PWA (Progressive
Web App) pensada para funcionar sin conexión en el campo, instalable en celular
o tablet.

Versión de escritorio: <https://emilios81.github.io/opuntiacolor/>

## Características

- **Doce filtros alineados con la referencia v3.4.0** — Rojo, Blanco, Negro,
  Bicromo, CRGB, DS-LAB, LDS, Micro-relieve, Relieve, YBK, CLAHE y Mapa de
  pigmentos. La salida coincide píxel a píxel con la versión de escritorio.
- **Modo Live** — decorrelación en tiempo real sobre la cámara, para explorar
  un panel antes de fotografiarlo.
- **Selección de zona** — rectángulo, círculo o mano alzada: las estadísticas
  del filtro se calculan solo sobre lo seleccionado, como en DStretch.
- **Sin conexión** — tras la primera visita la app queda completa en el
  dispositivo: código, tipografías e iconos. No pide nada a la red para
  procesar.
- **Reportes PDF** con metadatos EXIF y GPS de la foto original.

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

## Nota metodológica

La intensidad significa cosas distintas en cada filtro y no es comparable entre
ellos: al publicar resultados hay que consignar el filtro y la intensidad. En
LDS la intensidad es el exponente de blanqueo γ = intensidad / 1.5, de modo que
el valor por defecto (1.5) reproduce exactamente la salida de v3.3.0.

---
*Dr. Emilio A. Villafañez · LATDAA · Fund. Félix de Azara · Universidad Nacional de Catamarca (UNCA), Argentina*
