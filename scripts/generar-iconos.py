# -*- coding: utf-8 -*-
"""Genera los íconos de la PWA a partir del logo original.

    python scripts/generar-iconos.py

Fuente:  logo opuntia-movil.png  (cuadrado, el logo sobre su fondo oscuro)
Salida:  public/icon-192.png, icon-512.png, icon-maskable-512.png,
         apple-touch-icon.png, opuntialogo.png
         src/app/favicon.ico  (Next.js lo toma de ahí automáticamente)

Por qué existe este script: los íconos anteriores se habían dibujado a mano y no
había forma de rehacerlos igual. Si el logo cambia, se reemplaza el archivo
fuente y se vuelve a correr esto.

Requiere Pillow:  pip install Pillow
"""

import os
import statistics
import sys

from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
FUENTE = os.path.join(RAIZ, "logo opuntia-movil.png")
DESTINO = os.path.join(RAIZ, "public")

# Cuánto del lado del ícono ocupa el alto del logo.
#
# Un ícono normal se muestra completo, así que puede ir holgado: 0.82 deja un
# margen parejo sin que el dibujo quede chico.
#
# Uno "maskable" lo recorta Android con la forma que use el lanzador (círculo,
# rombo, squircle), y solo garantiza el círculo central del 80% del lado. Para
# que un logo de proporción 0.76 entre completo en ese círculo, su diagonal
# —alto x raíz(1 + 0.76²) = alto x 1.26— tiene que caber ahí: alto <= 0.80/1.26,
# o sea 0.63. Por eso el maskable va notoriamente más chico; no es un error.
ALTO_NORMAL = 0.82
ALTO_MASKABLE = 0.62
# El favicon se ve a 16 px: con el margen normal el dibujo queda ilegible, así
# que va casi al borde.
ALTO_FAVICON = 0.94

SALIDAS = [
    ("icon-192.png", 192, ALTO_NORMAL),
    ("icon-512.png", 512, ALTO_NORMAL),
    ("apple-touch-icon.png", 180, ALTO_NORMAL),
    ("icon-maskable-512.png", 512, ALTO_MASKABLE),
    ("opuntialogo.png", 512, ALTO_NORMAL),
]

# Next.js (App Router) usa src/app/favicon.ico sin que haya que declararlo.
FAVICON = os.path.join(RAIZ, "src", "app", "favicon.ico")
FAVICON_TAMANOS = [(16, 16), (32, 32), (48, 48)]


def color_de_fondo(im):
    """Mediana del marco exterior: el fondo real, sin depender de una esquina."""
    w, h = im.size
    px = im.load()
    muestras = ([px[x, y] for x in range(0, w, 7) for y in (0, 1, 2, h - 3, h - 2, h - 1)] +
                [px[x, y] for y in range(0, h, 7) for x in (0, 1, 2, w - 3, w - 2, w - 1)])
    return tuple(int(statistics.median(c[i] for c in muestras)) for i in range(3))


def luminancia(p):
    return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]


def aplanar_fondo(im, fondo, holgura=8):
    """Deja el fondo en un color plano y no toca el dibujo.

    El original trae una textura de ±3 niveles en las zonas lisas. Se reemplazan
    solo los píxeles que están al ras del fondo, así los bordes del dibujo —que
    son mezclas intermedias— quedan intactos: un recorte por alfa los adelgaza.
    """
    lim = luminancia(fondo) + holgura
    salida = im.copy()
    px, sx = im.load(), salida.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            if luminancia(px[x, y]) <= lim:
                sx[x, y] = fondo
    return salida


def caja_del_contenido(im, fondo, umbral=35):
    """Rectángulo que encierra el dibujo, ignorando el fondo."""
    lim = luminancia(fondo) + umbral
    px = im.load()
    w, h = im.size
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            if luminancia(px[x, y]) > lim:
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
    if x1 < 0:
        raise SystemExit("no se encontró dibujo: ¿el fondo es más claro que el logo?")
    return x0, y0, x1 + 1, y1 + 1


def main():
    if not os.path.exists(FUENTE):
        raise SystemExit("no encuentro el logo en:\n  " + FUENTE)

    original = Image.open(FUENTE).convert("RGB")
    fondo = color_de_fondo(original)
    print("logo:  %dx%d" % original.size)
    print("fondo: #%02X%02X%02X" % fondo)

    limpio = aplanar_fondo(original, fondo)
    x0, y0, x1, y1 = caja_del_contenido(limpio, fondo)
    dibujo = limpio.crop((x0, y0, x1, y1))
    dw, dh = dibujo.size
    print("dibujo: %dx%d  (estaba %d px descentrado; se recentra)" %
          (dw, dh, abs(x0 - (original.size[0] - x1)) // 2))

    os.makedirs(DESTINO, exist_ok=True)
    for nombre, lado, proporcion in SALIDAS:
        alto = round(lado * proporcion)
        ancho = round(alto * dw / dh)
        if ancho > lado * proporcion:            # logos apaisados: acotar por ancho
            ancho = round(lado * proporcion)
            alto = round(ancho * dh / dw)
        escalado = dibujo.resize((ancho, alto), Image.LANCZOS)
        lienzo = Image.new("RGB", (lado, lado), fondo)
        lienzo.paste(escalado, ((lado - ancho) // 2, (lado - alto) // 2))
        ruta = os.path.join(DESTINO, nombre)
        lienzo.save(ruta, "PNG", optimize=True)
        print("  %-24s %dx%d  (dibujo %dx%d)" % (nombre, lado, lado, ancho, alto))

    # --- favicon ---------------------------------------------------------
    lado = 256
    alto = round(lado * ALTO_FAVICON)
    ancho = round(alto * dw / dh)
    escalado = dibujo.resize((ancho, alto), Image.LANCZOS)
    lienzo = Image.new("RGB", (lado, lado), fondo)
    lienzo.paste(escalado, ((lado - ancho) // 2, (lado - alto) // 2))
    lienzo.save(FAVICON, "ICO", sizes=FAVICON_TAMANOS)
    print("  %-24s %s" % ("src/app/favicon.ico",
                          " ".join("%dx%d" % s for s in FAVICON_TAMANOS)))

    print("\nListo. Si cambia el logo, reemplazar el archivo fuente y volver a correr.")


if __name__ == "__main__":
    sys.exit(main())
