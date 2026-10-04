"use client"

/*
 * Visor del modo en vivo: el video de la cámara procesado cuadro a cuadro.
 *
 * Usa el motor de la GPU (src/lib/live-gpu.ts) cuando el equipo lo admite y,
 * si no, el motor de siempre en la CPU, a resolución reducida. Sobre la imagen
 * de la GPU agrega zoom con dos dedos (o la rueda del mouse), desplazamiento
 * con un dedo, doble toque para acercar o volver, y la línea de comparación
 * con el original, que se arrastra.
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { LiveEngine, type Denoise, type LiveView } from '@/lib/live-gpu';
import { applyPostProcessing } from '@/lib/image-processing';
import { cn } from '@/lib/utils';
import { useIdioma } from '@/lib/idioma';

type FilterFn = (img: ImageData, I: number, mask: Uint8Array | null, store: any) => ImageData;

export interface LiveInfo {
  engine: 'gpu' | 'cpu' | null;
  /** Resolución a la que se procesa. */
  width: number;
  height: number;
  /** Lo que entrega la cámara. */
  camW: number;
  camH: number;
  fps: number;
}

export interface LiveViewerHandle {
  /** El cuadro actual sin filtro, a resolución completa. Con la reducción de ruido activa, el acumulado. */
  capture(): ImageData | null;
}

interface Props {
  stream: MediaStream | null;
  filterId: string | null;
  filterLabel: string;
  /** El filtro del motor de referencia, para el respaldo en la CPU. */
  filterFn: FilterFn | null;
  intensity: number;
  contrast: number;
  saturation: number;
  denoise: Denoise;
  lock: boolean;
  paused: boolean;
  compare: boolean;
  /** A pantalla completa: los rótulos propios se corren debajo de la barra superior. */
  immersive: boolean;
  /** Ancho máximo de trabajo del respaldo en la CPU. */
  cpuMaxWidth: number;
  onInfo(info: LiveInfo): void;
  onEngineError(message: string): void;
  children?: React.ReactNode;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export const LiveViewer = forwardRef<LiveViewerHandle, Props>(function LiveViewer(props, ref) {
  const { stream, compare, filterLabel, immersive, children } = props;
  // Los avisos de falla salen de callbacks armados al montar: leen el idioma
  // vigente por ref, no el que había al crearlos.
  const { tr } = useIdioma();
  const trRef = useRef(tr);
  useEffect(() => { trRef.current = tr; });
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const cpuRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<LiveEngine | null>(null);
  const [engineKind, setEngineKind] = useState<'gpu' | 'cpu' | null>(null);

  // El bucle de cuadros lee siempre las props más recientes por este ref: si
  // las capturara al arrancar, cambiar de filtro no tendría efecto.
  const propsRef = useRef(props);
  useEffect(() => { propsRef.current = props; });

  const viewRef = useRef<LiveView>({ zoom: 1, cx: 0, cy: 0, split: null });
  const dimsRef = useRef({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [split, setSplit] = useState(0.5);
  const splitRef = useRef(0.5);
  const dirtyRef = useRef(true);
  const rafRef = useRef(0);
  const cpuSrcRef = useRef<ImageData | null>(null);

  // --- Motor ----------------------------------------------------------------------

  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    const crear = () => {
      const eng = LiveEngine.create(canvas);
      if (!eng) { setEngineKind('cpu'); return; }
      eng.onContextLost = () => {
        if (engineRef.current === eng) engineRef.current = null;
        eng.dispose();
        setEngineKind('cpu');
        propsRef.current.onEngineError(trRef.current(
          'El sistema le quitó la GPU a la página (suele pasar por memoria o al ir a segundo plano). Mientras tanto sigue en la CPU; si con 4K se repite, probá Full HD.',
          'The system took the GPU away from the page (usually because of memory, or when going to the background). Meanwhile it keeps running on the CPU; if it happens again in 4K, try Full HD.'));
      };
      engineRef.current = eng;
      setEngineKind('gpu');
    };
    // Si el sistema devuelve el contexto gráfico (Android lo hace al volver de
    // segundo plano), se arma el motor de nuevo y se vuelve a la GPU.
    const alRestaurar = () => { if (!engineRef.current) crear(); };
    canvas.addEventListener('webglcontextrestored', alRestaurar);
    crear();
    return () => {
      canvas.removeEventListener('webglcontextrestored', alRestaurar);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Reasignar el mismo stream reinicia la carga y corta el play() anterior.
    if (video.srcObject !== stream) video.srcObject = stream;
    // play() explícito: en Android autoPlay solo no siempre alcanza. Un
    // AbortError solo dice que una carga nueva reemplazó a la anterior.
    if (stream) video.play().catch(err => {
      if ((err as DOMException)?.name !== 'AbortError') console.error('No se pudo reproducir el video:', err);
    });
  }, [stream]);

  // La pantalla no se apaga mientras se explora: nadie toca el teléfono
  // mientras mira el panel a través de él, y a los treinta segundos se
  // bloqueaba solo. El sistema suelta el bloqueo al pasar a segundo plano, así
  // que se vuelve a pedir al regresar.
  useEffect(() => {
    if (!stream) return;
    const wl = (navigator as any).wakeLock;
    if (!wl) return;
    let lock: any = null, activo = true;
    const pedir = async () => {
      try {
        const l = await wl.request('screen');
        if (activo) lock = l; else l.release().catch(() => {});
      } catch { /* sin permiso: la pantalla se comporta como siempre */ }
    };
    const alVolver = () => { if (document.visibilityState === 'visible') pedir(); };
    pedir();
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      activo = false;
      document.removeEventListener('visibilitychange', alVolver);
      lock?.release().catch(() => {});
    };
  }, [stream]);

  // --- Vista: zoom y desplazamiento -------------------------------------------------

  const geom = () => {
    const eng = engineRef.current, box = boxRef.current;
    if (!eng || !box || !eng.width) return null;
    const cw = box.clientWidth, ch = box.clientHeight;
    return { W: eng.width, H: eng.height, cw, ch, fit: Math.min(cw / eng.width, ch / eng.height) };
  };

  // Con el zoom en 1 la imagen queda centrada; con más, no se puede correr más
  // allá del borde de la imagen.
  const clampView = (v: LiveView) => {
    const g = geom();
    if (!g) return;
    const s = g.fit * v.zoom, hw = g.cw / (2 * s), hh = g.ch / (2 * s);
    v.cx = g.W * s <= g.cw ? g.W / 2 : clamp(v.cx, hw, g.W - hw);
    v.cy = g.H * s <= g.ch ? g.H / 2 : clamp(v.cy, hh, g.H - hh);
  };

  // Hasta que un píxel de la imagen ocupe unos seis píxeles de la pantalla:
  // más que eso ya no muestra nada nuevo.
  const maxZoom = () => {
    const g = geom();
    if (!g) return 4;
    return clamp(6 / (g.fit * (window.devicePixelRatio || 1)), 4, 24);
  };

  const render = useCallback(() => {
    const p = propsRef.current;
    const eng = engineRef.current, box = boxRef.current;
    dirtyRef.current = false;
    if (eng) {
      if (!eng.ready || !box) return;
      if (eng.width !== dimsRef.current.w || eng.height !== dimsRef.current.h) {
        // Cambió la resolución (otra calidad, o se giró el equipo): vista entera.
        dimsRef.current = { w: eng.width, h: eng.height };
        viewRef.current = { zoom: 1, cx: eng.width / 2, cy: eng.height / 2, split: null };
        setZoom(1);
      }
      try {
        eng.process({ filter: p.filterId, intensity: p.intensity, contrast: p.contrast, saturation: p.saturation, lock: p.lock }, performance.now() / 1000);
        const v = viewRef.current;
        clampView(v);
        v.split = p.compare ? splitRef.current : null;
        eng.display(v, box.clientWidth, box.clientHeight, window.devicePixelRatio || 1);
      } catch (err) {
        console.error('Falla del motor en vivo por GPU:', err);
        eng.dispose();
        engineRef.current = null;
        setEngineKind('cpu');
        p.onEngineError(trRef.current(
          'La GPU de este equipo falló con el filtro elegido. Sigue en la CPU, a menor resolución.',
          'This device’s GPU failed with the chosen filter. It continues on the CPU, at a lower resolution.'));
      }
      return;
    }
    // Respaldo en la CPU: el motor de referencia sobre el último cuadro.
    const canvas = cpuRef.current, src = cpuSrcRef.current;
    if (!canvas || !src) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.width !== src.width || canvas.height !== src.height) { canvas.width = src.width; canvas.height = src.height; }
    const res = p.filterFn ? p.filterFn(src, p.intensity, null, {}) : src;
    ctx.putImageData(p.filterFn ? applyPostProcessing(res, p.contrast, p.saturation) : res, 0, 0);
  }, []);

  const scheduleRender = useCallback(() => {
    dirtyRef.current = true;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (dirtyRef.current) render();
    });
  }, [render]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  useEffect(() => { scheduleRender(); },
    [props.filterId, props.intensity, props.contrast, props.saturation, props.denoise, props.lock, props.paused, compare, engineKind, scheduleRender]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => scheduleRender());
    ro.observe(box);
    return () => ro.disconnect();
  }, [scheduleRender]);

  // --- Bucle de cuadros ----------------------------------------------------------------

  useEffect(() => {
    const video = videoRef.current;
    if (!engineKind || !stream || !video) return;
    // requestVideoFrameCallback avisa una vez por cuadro nuevo de la cámara:
    // ni se procesa dos veces el mismo cuadro ni se pierde uno. Donde no
    // existe, requestAnimationFrame.
    const conRVFC = typeof (video as any).requestVideoFrameCallback === 'function';
    let vivo = true, handle = 0, cuadros = 0, desde = performance.now();

    const tomar = (): boolean => {
      const p = propsRef.current;
      const eng = engineRef.current;
      if (eng) {
        eng.setDenoise(p.denoise);
        return eng.pushFrame(video);
      }
      const canvas = cpuRef.current;
      if (!canvas || video.readyState < 2 || !video.videoWidth) return false;
      const tw = Math.min(p.cpuMaxWidth, video.videoWidth);
      const th = Math.round(video.videoHeight / video.videoWidth * tw);
      if (canvas.width !== tw || canvas.height !== th) { canvas.width = tw; canvas.height = th; }
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      ctx.drawImage(video, 0, 0, tw, th);
      cpuSrcRef.current = ctx.getImageData(0, 0, tw, th);
      return true;
    };

    const tick = () => {
      if (!vivo) return;
      const p = propsRef.current;
      // Un cuadro que falla no puede cortar el bucle: el siguiente se reintenta.
      try {
        const nuevo = !p.paused && tomar();
        if (nuevo) cuadros++;
        if (nuevo || dirtyRef.current) render();
      } catch (err) {
        console.error('Cuadro en vivo:', err);
      }
      const t = performance.now();
      if (t - desde >= 1000) {
        const eng = engineRef.current;
        p.onInfo({
          engine: eng ? 'gpu' : 'cpu',
          width: eng ? eng.width : cpuRef.current?.width ?? 0,
          height: eng ? eng.height : cpuRef.current?.height ?? 0,
          camW: video.videoWidth,
          camH: video.videoHeight,
          fps: (cuadros * 1000) / (t - desde),
        });
        cuadros = 0;
        desde = t;
      }
      handle = conRVFC ? (video as any).requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };
    handle = conRVFC ? (video as any).requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    return () => {
      vivo = false;
      if (conRVFC) (video as any).cancelVideoFrameCallback(handle); else cancelAnimationFrame(handle);
    };
  }, [engineKind, stream, render]);

  useImperativeHandle(ref, () => ({
    capture() {
      const eng = engineRef.current;
      if (eng) return eng.readSource();
      const v = videoRef.current;
      if (!v || !v.videoWidth) return null;
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(v, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height);
    },
  }), []);

  // --- Gestos ---------------------------------------------------------------------------

  const gesto = useRef<{
    modo: 'nada' | 'mover' | 'pinza' | 'linea';
    pts: Map<number, { x: number; y: number }>;
    ini: { x: number; y: number; cx: number; cy: number; zoom: number; dist: number };
    toque: { t: number; x: number; y: number } | null;
  }>({ modo: 'nada', pts: new Map(), ini: { x: 0, y: 0, cx: 0, cy: 0, zoom: 1, dist: 1 }, toque: null });

  const local = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Cambia el zoom dejando quieto el punto de la imagen que está bajo (x, y).
  const zoomEn = (nuevo: number, x: number, y: number) => {
    const g = geom();
    if (!g) return;
    const v = viewRef.current, s0 = g.fit * v.zoom;
    const ux = v.cx + (x - g.cw / 2) / s0, uy = v.cy + (y - g.ch / 2) / s0;
    v.zoom = clamp(nuevo, 1, maxZoom());
    const s1 = g.fit * v.zoom;
    v.cx = ux - (x - g.cw / 2) / s1;
    v.cy = uy - (y - g.ch / 2) / s1;
    clampView(v);
    setZoom(v.zoom);
    scheduleRender();
  };

  const moverLinea = (x: number) => {
    const cw = boxRef.current?.clientWidth || 1;
    splitRef.current = clamp(x / cw, 0, 1);
    setSplit(splitRef.current);
    scheduleRender();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!engineRef.current?.ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const G = gesto.current, P = local(e), v = viewRef.current;
    G.pts.set(e.pointerId, P);
    if (G.pts.size === 1) {
      const t = performance.now();
      if (G.toque && t - G.toque.t < 320 && Math.hypot(P.x - G.toque.x, P.y - G.toque.y) < 30) {
        // Doble toque: acerca al punto tocado, o vuelve a la imagen entera.
        G.toque = null;
        G.modo = 'nada';
        zoomEn(v.zoom > 1.05 ? 1 : Math.min(maxZoom(), 3), P.x, P.y);
        return;
      }
      G.toque = { t, x: P.x, y: P.y };
      const cw = boxRef.current!.clientWidth;
      if (propsRef.current.compare && Math.abs(P.x - splitRef.current * cw) < 28) {
        G.modo = 'linea';
        moverLinea(P.x);
        return;
      }
      G.modo = 'mover';
      G.ini = { x: P.x, y: P.y, cx: v.cx, cy: v.cy, zoom: v.zoom, dist: 1 };
    } else if (G.pts.size === 2) {
      const [a, b] = [...G.pts.values()];
      G.modo = 'pinza';
      G.ini = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, cx: v.cx, cy: v.cy, zoom: v.zoom, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const G = gesto.current;
    if (!G.pts.has(e.pointerId)) return;
    const P = local(e);
    G.pts.set(e.pointerId, P);
    const g = geom();
    if (!g) return;
    const v = viewRef.current, I = G.ini;
    if (G.modo === 'linea') {
      moverLinea(P.x);
    } else if (G.modo === 'mover' && v.zoom > 1) {
      const s = g.fit * v.zoom;
      v.cx = I.cx - (P.x - I.x) / s;
      v.cy = I.cy - (P.y - I.y) / s;
      clampView(v);
      scheduleRender();
    } else if (G.modo === 'pinza' && G.pts.size >= 2) {
      const [a, b] = [...G.pts.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      // El punto de la imagen que estaba bajo el centro de los dos dedos
      // acompaña al centro actual: se puede acercar y correr a la vez.
      const s0 = g.fit * I.zoom;
      const ux = I.cx + (I.x - g.cw / 2) / s0, uy = I.cy + (I.y - g.ch / 2) / s0;
      v.zoom = clamp(I.zoom * Math.hypot(a.x - b.x, a.y - b.y) / I.dist, 1, maxZoom());
      const s1 = g.fit * v.zoom;
      v.cx = ux - (mx - g.cw / 2) / s1;
      v.cy = uy - (my - g.ch / 2) / s1;
      clampView(v);
      setZoom(v.zoom);
      scheduleRender();
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const G = gesto.current;
    G.pts.delete(e.pointerId);
    if (G.pts.size === 1 && G.modo === 'pinza') {
      // Al levantar un dedo de la pinza se sigue moviendo con el otro.
      const [P] = [...G.pts.values()], v = viewRef.current;
      G.modo = 'mover';
      G.ini = { x: P.x, y: P.y, cx: v.cx, cy: v.cy, zoom: v.zoom, dist: 1 };
    } else if (G.pts.size === 0) {
      G.modo = 'nada';
    }
  };

  // La rueda del mouse va por un oyente propio: el de React es pasivo y no
  // puede impedir que, además de acercar, se desplace la página.
  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      if (!engineRef.current?.ready) return;
      e.preventDefault();
      const P = local(e);
      zoomEn(viewRef.current.zoom * Math.exp(-e.deltaY * 0.0015), P.x, P.y);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  });

  const volverAEntera = () => {
    const eng = engineRef.current;
    if (!eng) return;
    viewRef.current.zoom = 1;
    clampView(viewRef.current);
    setZoom(1);
    scheduleRender();
  };

  const gpu = engineKind === 'gpu';
  // Rótulos de la comparación: arriba, debajo de la insignia (o de la barra
  // superior a pantalla completa), para no chocar con los botones de abajo.
  const rotulosTop = immersive ? 'calc(max(env(safe-area-inset-top), 12px) + 64px)' : '44px';

  return (
    <div ref={boxRef} className="relative w-full h-full bg-black overflow-hidden select-none">
      {/* El video tiene que estar en la página y visible para que el navegador
          lo decodifique; queda debajo del lienzo, que lo tapa entero. */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        style={{ opacity: 0.05 }}
      />
      <canvas
        ref={glRef}
        className={cn('absolute inset-0 w-full h-full touch-none', !gpu && 'hidden')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <canvas ref={cpuRef} className={cn('absolute inset-0 w-full h-full object-contain', engineKind !== 'cpu' && 'hidden')} />

      {gpu && compare && (
        <>
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-white border-2 border-primary shadow-lg pointer-events-none"
            style={{ left: `${split * 100}%` }}
          >
            <div className="flex gap-0.5">
              <div className="w-0.5 h-3 bg-primary/40 rounded-full" />
              <div className="w-0.5 h-3 bg-primary/40 rounded-full" />
            </div>
          </div>
          <div className="absolute left-3 z-10 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[9px] text-white font-code uppercase tracking-widest border border-white/10 pointer-events-none" style={{ top: rotulosTop }}>
            {filterLabel}
          </div>
          <div className="absolute right-3 z-10 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[9px] text-white font-code uppercase tracking-widest border border-white/10 pointer-events-none" style={{ top: rotulosTop }}>
            Original
          </div>
        </>
      )}

      {gpu && zoom > 1.01 && (
        <button
          onClick={volverAEntera}
          className="absolute left-1/2 -translate-x-1/2 z-40 bg-black/60 text-white text-[10px] font-code font-bold px-2.5 py-1 rounded-full border border-white/20 shadow-lg whitespace-nowrap"
          style={{ top: immersive ? 'calc(max(env(safe-area-inset-top), 12px) + 4px)' : '12px' }}
          title={tr("Volver a la imagen entera", "Back to the whole image")}
        >
          {zoom.toFixed(1)}&times; &middot; {tr("ver entera", "see all")}
        </button>
      )}

      {children}
    </div>
  );
});
