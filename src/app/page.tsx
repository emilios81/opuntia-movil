
"use client"

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Upload, 
  Download, 
  RefreshCw, 
  Maximize2,
  FileImage,
  Zap,
  MapPin,
  Copy,
  Sun,
  Moon,
  PlusCircle,
  Infinity as StackingIcon,
  Trash2,
  Square,
  Circle as CircleIcon,
  Pencil,
  X,
  FileText,
  Info,
  Camera,
  Play,
  Pause,
  Lock,
  LockOpen,
  Maximize,
  Minimize,
  Columns2,
  Flashlight,
  FlashlightOff,
  Aperture,
  Video
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CompareSlider } from '@/components/CompareSlider';
import { OpuntiaLogo } from '@/components/OpuntiaLogo';
import { LiveViewer, type LiveInfo, type LiveViewerHandle } from '@/components/LiveViewer';
import type { Denoise } from '@/lib/live-gpu';
import * as OPC from '@/lib/image-processing';
import { extractMetadata, type ImageMetadata } from '@/lib/exif-utils';
import { generateReport } from '@/lib/pdf-report';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type SelectionType = 'rect' | 'circle' | 'freehand' | null;

interface Selection {
  type: SelectionType;
  points: { x: number; y: number }[];
}

const FILTERS = [
  { id: "red", name: "Rojo", icon: "🔴", desc: "Pinturas y pigmentos rojos / ocres", fn: OPC.red },
  { id: "white", name: "Blanco", icon: "⚪", desc: "Pinturas y pigmentos blancos / claros", fn: OPC.white },
  { id: "black", name: "Negro", icon: "⚫", desc: "Pigmentos oscuros / negros / carbones", fn: OPC.black },
  { id: "bichrome", name: "Bicromo", icon: "◑", desc: "Combina realce rojo + blanco", fn: OPC.bichrome },
  { id: "crgb", name: "CRGB", icon: "🌈", desc: "Decorrelación pura RGB / variabilidad espectral", fn: OPC.crgb },
  { id: "dslab", name: "DS-LAB", icon: "🔵", desc: "Decorrelación perceptual CIE-LAB / pigmentos sutiles", fn: OPC.dslab },
  { id: "lds", name: "LDS", icon: "🟣", desc: "Decorrelation Stretch RGB / análisis general", fn: OPC.lds },
  { id: "petro", name: "Micro-relieve", icon: "🪨", desc: "Pátina + textura + bordes / grabados y surcos", fn: OPC.petro },
  { id: "relief", name: "Relieve", icon: "🗺", desc: "Mapa de bordes multi-escala / calco digital", fn: OPC.relief },
  { id: "ybk", name: "YBK", icon: "🟡", desc: "Crominancia YCbCr / separación cromática", fn: OPC.ybk },
  { id: "clahe", name: "CLAHE", icon: "◐", desc: "Ecualización adaptativa de histograma / sombras", fn: OPC.clahe },
  { id: "map", name: "Mapa pigmentos", icon: "🗺️", desc: "Falso color por tipo de pigmento detectado", fn: OPC.map },
];

const SELECTION_TOOLS: { id: Exclude<SelectionType, null>; name: string; Icon: typeof Square }[] = [
  { id: "rect", name: "Rectángulo", Icon: Square },
  { id: "circle", name: "Círculo", Icon: CircleIcon },
  { id: "freehand", name: "Mano alzada", Icon: Pencil },
];

// EXIF guarda la fecha como "2026:08:07 12:30:45", que no es lo que espera
// Date.parse ni lo que nadie quiere leer. Si viene con otro formato se muestra
// tal cual: mejor el dato crudo que un hueco.
function formatearCaptura(raw?: string): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : raw;
}

// exif-js devuelve los racionales como objetos Number, no como primitivos.
function aNumero(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const PRESETS = [
  { label: "Sutil", value: 0.4 },
  { label: "Suave", value: 1.0 },
  { label: "Medio", value: 1.8 },
  { label: "Fuerte", value: 3.0 },
  { label: "Extremo", value: 4.5 },
];

// Calidades del modo en vivo: lo que se le pide a la cámara. Con el motor de
// la GPU se procesa a la resolución que la cámara entregue de verdad, sin
// achicar; "ideal" es una sugerencia, y si el equipo no llega a 4K da lo más
// cercano que tenga (se muestra en pantalla).
type LiveTier = 'hd' | 'fhd' | '4k';
const LIVE_TIERS: { id: LiveTier; label: string; detalle: string; w: number; h: number }[] = [
  { id: 'hd', label: 'HD', detalle: '1280 × 720', w: 1280, h: 720 },
  { id: 'fhd', label: 'Full HD', detalle: '1920 × 1080', w: 1920, h: 1080 },
  { id: '4k', label: '4K', detalle: '3840 × 2160', w: 3840, h: 2160 },
];

const DENOISE_OPTIONS: { valor: Denoise; etiqueta: string }[] = [
  { valor: 0, etiqueta: 'No' },
  { valor: 1, etiqueta: 'Media' },
  { valor: 2, etiqueta: 'Alta' },
];

// Respaldo sin GPU: el motor de siempre, en la CPU, no da para más de 720 px
// por cuadro en un celular.
const CPU_LIVE_MAX_WIDTH = 720;

// Preferencias del modo en vivo que vale la pena recordar entre sesiones: son
// decisiones sobre el equipo, no sobre la foto. Envueltas en try porque el
// almacenamiento puede no estar disponible (navegación privada, permisos).
function leerPreferencia(clave: string): string | null {
  try { return window.localStorage.getItem(clave); } catch { return null; }
}
function guardarPreferencia(clave: string, valor: string) {
  try { window.localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}

// Fecha en el formato de EXIF ("2026:10:04 15:30:12"), para que un cuadro
// capturado en vivo muestre su momento igual que una foto.
function fechaExif(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Insignia del visor en vivo: rojo, como en cualquier transmisión; ámbar en
// pausa. Colores fijos y no los del tema: en el modo de campo el acento es
// blanco y la insignia quedaba blanco sobre blanco.
function EstadoEnVivo({ pausado }: { pausado: boolean }) {
  return (
    <div className={cn(
      "text-white text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-lg",
      pausado ? "bg-amber-600" : "bg-red-600"
    )}>
      {pausado
        ? <><Pause className="w-3 h-3" /> PAUSADO</>
        : <><span className="w-2 h-2 bg-white rounded-full animate-pulse" /> EN VIVO</>}
    </div>
  );
}

// Botón chico sobre el visor (comparar, pantalla completa).
function BotonVisor({ activo, onClick, titulo, children }: {
  activo?: boolean; onClick: () => void; titulo: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      aria-pressed={activo}
      className={cn(
        "w-9 h-9 rounded-full flex items-center justify-center shadow-lg border transition-colors",
        activo ? "bg-white text-black border-white" : "bg-black/60 text-white border-white/25"
      )}
    >
      {children}
    </button>
  );
}

// Botón con rótulo de la barra inferior a pantalla completa.
function BotonRedondo({ activo, onClick, etiqueta, deshabilitado, children }: {
  activo?: boolean; onClick: () => void; etiqueta: string; deshabilitado?: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={deshabilitado} aria-pressed={activo} className="flex flex-col items-center gap-1 w-14 disabled:opacity-50">
      <span className={cn(
        "w-11 h-11 rounded-full flex items-center justify-center border transition-colors",
        activo ? "bg-white text-black border-white" : "bg-black/50 text-white border-white/25"
      )}>
        {children}
      </span>
      <span className="text-[9px] font-bold text-white/85 leading-none text-center">{etiqueta}</span>
    </button>
  );
}

export default function OpuntiaColor() {
  // Sin Firebase: la app no guarda nada en la nube ni necesita identificar a
  // nadie. El inicio de sesión anónimo que traía el andamiaje era la única
  // llamada a la red al arrancar, y ningún componente usaba ese usuario.
  const { toast } = useToast();
  
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [processedSrc, setProcessedSrc] = useState<string | null>(null);
  const [filteredImageData, setFilteredImageData] = useState<ImageData | null>(null);
  const [activeFilterId, setActiveFilterId] = useState<string | null>(null);
  const [intensity, setIntensity] = useState(1.5);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [isStacking, setIsStacking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState("");
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 });
  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);
  const [isFieldMode, setIsFieldMode] = useState(false);

  // Modo en vivo
  const [isLiveMode, setIsLiveMode] = useState(false);
  // El stream vive también en un ref: hay que poder cortarlo aunque el visor
  // ya esté desmontado, si no la cámara queda tomada.
  const liveStreamRef = useRef<MediaStream | null>(null);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const liveViewerRef = useRef<LiveViewerHandle>(null);
  const [liveTier, setLiveTier] = useState<LiveTier>('4k');
  const [liveDenoise, setLiveDenoise] = useState<Denoise>(1);
  const [liveLock, setLiveLock] = useState(false);
  const [livePaused, setLivePaused] = useState(false);
  const [liveCompare, setLiveCompare] = useState(false);
  const [liveImmersive, setLiveImmersive] = useState(false);
  // Lo que informa el visor una vez por segundo: motor, resolución de trabajo,
  // lo que entrega la cámara y cuadros por segundo. Se muestra en pantalla
  // para poder consignarlo al reportar.
  const [liveInfo, setLiveInfo] = useState<LiveInfo>({ engine: null, width: 0, height: 0, camW: 0, camH: 0, fps: 0 });
  const [torch, setTorch] = useState({ disponible: false, encendida: false });
  const [isCapturing, setIsCapturing] = useState(false);
  // La imagen cargada salió de la cámara en vivo: es un PNG sin EXIF.
  const [origenEnVivo, setOrigenEnVivo] = useState(false);
  // Filtro con el que se abre un cuadro recién capturado.
  const pendingFilterRef = useRef<string | null>(null);

  // Selection state
  const [selectionTool, setSelectionTool] = useState<SelectionType>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Stacking pipeline
  const [frozenStore, setFrozenStore] = useState<any>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Preferencias guardadas: se leen después de montar, porque al compilar el
  // sitio estático no existe localStorage.
  useEffect(() => {
    const c = leerPreferencia('opc_envivo_calidad');
    if (c === 'hd' || c === 'fhd' || c === '4k') setLiveTier(c);
    const r = leerPreferencia('opc_envivo_ruido');
    if (r === '0' || r === '1' || r === '2') setLiveDenoise(Number(r) as Denoise);
  }, []);

  const stopLiveMode = useCallback(() => {
    liveStreamRef.current?.getTracks().forEach(track => track.stop());
    liveStreamRef.current = null;
    if (typeof document !== 'undefined' && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setLiveStream(null);
    setIsLiveMode(false);
    setLivePaused(false);
    setLiveImmersive(false);
    setTorch({ disponible: false, encendida: false });
    setLiveInfo({ engine: null, width: 0, height: 0, camW: 0, camH: 0, fps: 0 });
    setImageSrc(null);
  }, []);

  const abrirCamara = async (tier: LiveTier) => {
    const t = LIVE_TIERS.find(x => x.id === tier) ?? LIVE_TIERS[2];
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: t.w },
        height: { ideal: t.h },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
    liveStreamRef.current = stream;
    setLiveStream(stream);
    // Linterna: solo si la cámara la ofrece (Chrome en Android, sobre todo).
    const track = stream.getVideoTracks()[0];
    // Cortarla nosotros (stop) no dispara 'ended': si llega, la cortó otra app
    // o el sistema al pasar a segundo plano, y el video quedaría congelado.
    track?.addEventListener('ended', () => {
      if (liveStreamRef.current !== stream) return;
      toast({ title: "Se cortó la cámara", description: "Otra aplicación la tomó o el sistema la suspendió. Tocá En vivo para retomar." });
      stopLiveMode();
    });
    const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
    setTorch({ disponible: !!caps.torch, encendida: false });
  };

  const errorDeCamara = (err: unknown) => {
    console.error("Error al abrir la cámara:", err);
    const name = (err as DOMException)?.name;
    toast({
      title: "Error de cámara",
      description: name === "NotAllowedError"
        ? "Permiso denegado. Habilitá la cámara para este sitio."
        : name === "NotFoundError"
        ? "No se encontró ninguna cámara."
        : name === "NotReadableError"
        ? "La cámara está ocupada por otra aplicación."
        : "No se pudo abrir la cámara.",
      variant: "destructive"
    });
  };

  const startLiveMode = async () => {
    if (isLiveMode) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ title: "Cámara no disponible", description: "El navegador no expone la cámara. Requiere HTTPS o localhost.", variant: "destructive" });
      return;
    }

    try {
      await abrirCamara(liveTier);
      setProcessedSrc(null);
      setImageSrc("LIVE_STREAM");
      setActiveFilterId(prev => prev ?? "crgb");
      setLivePaused(false);
      setIsLiveMode(true);
    } catch (err) {
      errorDeCamara(err);
    }
  };

  // Cambiar de calidad es pedirle otra resolución a la cámara: se corta el
  // stream y se abre uno nuevo (el permiso ya está dado, no vuelve a
  // preguntar). Primero se corta, porque varios celulares no abren la misma
  // cámara dos veces a la vez.
  const cambiarCalidad = async (tier: LiveTier) => {
    if (tier === liveTier && isLiveMode) return;
    setLiveTier(tier);
    guardarPreferencia('opc_envivo_calidad', tier);
    if (!isLiveMode) return;
    liveStreamRef.current?.getTracks().forEach(track => track.stop());
    liveStreamRef.current = null;
    setLiveStream(null);
    setLivePaused(false);
    try {
      await abrirCamara(tier);
    } catch (err) {
      errorDeCamara(err);
      stopLiveMode();
    }
  };

  const cambiarRuido = (d: Denoise) => {
    setLiveDenoise(d);
    guardarPreferencia('opc_envivo_ruido', String(d));
  };

  const alternarLinterna = async () => {
    const track = liveStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const encendida = !torch.encendida;
    try {
      await track.applyConstraints({ advanced: [{ torch: encendida } as MediaTrackConstraintSet] });
      setTorch(t => ({ ...t, encendida }));
    } catch {
      toast({ title: "No se pudo usar la linterna", variant: "destructive" });
    }
  };

  // Pantalla completa. En Android se le pide además al navegador que oculte
  // sus barras; el iPhone no lo permite para nada que no sea un video, así que
  // ahí el visor se expande dentro de la página (instalada como app, igual
  // ocupa la pantalla entera).
  const entrarPantallaCompleta = () => {
    setLiveImmersive(true);
    const el = containerRef.current;
    if (el?.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
  };

  const salirPantallaCompleta = () => {
    setLiveImmersive(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };

  // Si se sale de la pantalla completa con el gesto de volver o con Esc, el
  // visor vuelve también a su lugar.
  useEffect(() => {
    const alCambiar = () => { if (!document.fullscreenElement) setLiveImmersive(false); };
    document.addEventListener('fullscreenchange', alCambiar);
    return () => document.removeEventListener('fullscreenchange', alCambiar);
  }, []);

  // A pantalla completa, la tira de filtros arranca mostrando el que está en
  // uso: si quedaba fuera de la vista no había forma de saber cuál era.
  const tiraRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!liveImmersive) return;
    const activo = tiraRef.current?.querySelector('[data-activo="true"]') as HTMLElement | null;
    activo?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [liveImmersive, activeFilterId]);

  // Con el visor a pantalla completa, la página de abajo no se desplaza.
  useEffect(() => {
    if (!liveImmersive) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = antes; };
  }, [liveImmersive]);

  // Al salir de la pantalla se suelta la cámara sí o sí.
  useEffect(() => stopLiveMode, [stopLiveMode]);

  const handleClearStack = () => {
    setProcessedSrc(null);
    setFilteredImageData(null);
    setActiveFilterId(null);
    setFrozenStore({});
    toast({ title: "Memoria de Filtros Limpia" });
  };

  const handleFile = useCallback(async (file: File, opciones?: { filtro?: string | null; enVivo?: { fecha: Date; equipo: string } }) => {
    if (!file || !file.type.startsWith("image/")) return;
    stopLiveMode();
    setFileName(file.name);
    // Un cuadro capturado en vivo es un PNG sin EXIF: la fecha y la cámara se
    // completan a mano, que el panel de metadatos y el reporte las necesitan.
    const meta = opciones?.enVivo
      ? { date: fechaExif(opciones.enVivo.fecha), model: opciones.enVivo.equipo || undefined }
      : await extractMetadata(file);
    setMetadata(meta);
    setOrigenEnVivo(!!opciones?.enVivo);
    pendingFilterRef.current = opciones?.filtro ?? null;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 2000;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        setImageSize({ w, h });
        setImage(img);
        setImageSrc(e.target?.result as string);
        setProcessedSrc(null);
        setFilteredImageData(null);
        setActiveFilterId(null);
        setSelection(null);
        setSelectionTool(null);
        setFrozenStore({});
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, [stopLiveMode]);

  // Capturar: el cuadro actual (ya limpio de ruido si la reducción está
  // activa) pasa a la vista de foto y se procesa con el motor de referencia,
  // el mismo del escritorio. Desde ahí se puede marcar zona, acumular,
  // descargar y armar el reporte.
  const capturarEnVivo = async () => {
    if (isCapturing) return;
    const img = liveViewerRef.current?.capture();
    if (!img) {
      toast({ title: "Todavía no hay imagen para capturar", variant: "destructive" });
      return;
    }
    setIsCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d')!.putImageData(img, 0, 0);
      // PNG y no JPEG: la compresión con pérdida deja bloques y franjas de
      // color que la decorrelación después amplifica.
      const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('No se pudo codificar el cuadro');
      const ahora = new Date();
      const p2 = (n: number) => String(n).padStart(2, '0');
      const nombre = `en-vivo_${ahora.getFullYear()}-${p2(ahora.getMonth() + 1)}-${p2(ahora.getDate())}_${p2(ahora.getHours())}-${p2(ahora.getMinutes())}-${p2(ahora.getSeconds())}.png`;
      // Para el registro: que salió del video, a qué resolución y con qué
      // cámara. La etiqueta de la cámara solo si es legible ("camera2 0,
      // facing back", "Back Camera"): algunos navegadores ponen un
      // identificador al azar.
      const etiqueta = liveStreamRef.current?.getVideoTracks()[0]?.label || '';
      const legible = /[\s,]/.test(etiqueta) && etiqueta.length <= 60;
      const equipo = `Video en vivo · ${img.width}×${img.height}` + (legible ? ` · ${etiqueta}` : '');
      await handleFile(new File([blob], nombre, { type: 'image/png' }), { filtro: activeFilterId, enVivo: { fecha: ahora, equipo } });
    } catch (err) {
      console.error(err);
      toast({ title: "No se pudo capturar el cuadro", variant: "destructive" });
    } finally {
      setIsCapturing(false);
    }
  };

  const runFilter = useCallback(async (filterId: string, int: number) => {
    if (!image || isLiveMode) return;
    setIsProcessing(true);
    setActiveFilterId(filterId);

    const filter = FILTERS.find(f => f.id === filterId);
    if (!filter) { setIsProcessing(false); return; }

    setTimeout(() => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        canvas.width = imageSize.w;
        canvas.height = imageSize.h;

        let sourceData: ImageData;
        if (isStacking && processedSrc) {
          ctx.putImageData(filteredImageData!, 0, 0);
          sourceData = ctx.getImageData(0, 0, imageSize.w, imageSize.h);
        } else {
          ctx.drawImage(image, 0, 0, imageSize.w, imageSize.h);
          sourceData = ctx.getImageData(0, 0, imageSize.w, imageSize.h);
        }

        const mask = selection ? getMaskArray(selection) : null;
        const currentStore = { frozen: frozenStore[filterId] || null };
        const result = filter.fn(sourceData, int, mask, currentStore);
        
        if (currentStore.frozen) {
          setFrozenStore((prev: any) => ({ ...prev, [filterId]: currentStore.frozen }));
        }

        // El PNG lo genera el efecto que observa filteredImageData: llamarlo
        // también acá codificaba la imagen dos veces por cada pasada.
        setFilteredImageData(result);
        setIsProcessing(false);
      } catch (err) {
        console.error(err);
        toast({ title: "Error de procesamiento", variant: "destructive" });
        setIsProcessing(false);
      }
    }, 50);
  }, [image, imageSize, processedSrc, isStacking, selection, filteredImageData, frozenStore, isLiveMode]);

  const getMaskArray = (sel: Selection): Uint8Array => {
    const { w, h } = imageSize;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new Uint8Array(w * h).fill(1);
    
    ctx.fillStyle = 'white';
    ctx.beginPath();
    if (sel.type === 'rect' && sel.points.length >= 2) {
      ctx.rect(
        Math.min(sel.points[0].x, sel.points[1].x) * w, 
        Math.min(sel.points[0].y, sel.points[1].y) * h, 
        Math.abs(sel.points[1].x - sel.points[0].x) * w, 
        Math.abs(sel.points[1].y - sel.points[0].y) * h
      );
    } else if (sel.type === 'circle' && sel.points.length >= 2) {
      // La elipse queda INSCRIPTA en el rectángulo que define el arrastre,
      // igual que en la versión de escritorio. Tomar el punto inicial como
      // centro daba una zona del doble de tamaño para el mismo gesto, y con
      // eso las estadísticas por zona no coincidían entre las dos versiones.
      const p1 = sel.points[0], p2 = sel.points[1];
      const cx = (p1.x + p2.x) / 2 * w, cy = (p1.y + p2.y) / 2 * h;
      const rx = Math.abs(p2.x - p1.x) / 2 * w, ry = Math.abs(p2.y - p1.y) / 2 * h;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    } else if (sel.type === 'freehand' && sel.points.length > 2) {
      ctx.moveTo(sel.points[0].x * w, sel.points[0].y * h);
      sel.points.forEach(p => ctx.lineTo(p.x * w, p.y * h));
      ctx.closePath();
    }
    ctx.fill();
    
    const data = ctx.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4] > 0 ? 1 : 0;
    return mask;
  };

  const applyPost = (base: ImageData) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = imageSize.w;
    canvas.height = imageSize.h;
    const res = OPC.applyPostProcessing(base, contrast, saturation);
    ctx.putImageData(res, 0, 0);
    setProcessedSrc(canvas.toDataURL("image/png"));
  };

  // Reaplicación automática al mover la intensidad o terminar una selección.
  // runFilter va por ref y NO figura en las dependencias a propósito: su
  // identidad cambia con cada resultado, así que tenerlo acá encadenaba un
  // reprocesado tras otro sin fin. Por el mismo motivo tampoco está
  // activeFilterId: elegir un filtro ya dispara runFilter desde el botón.
  const runFilterRef = useRef(runFilter);
  useEffect(() => { runFilterRef.current = runFilter; });

  // Un cuadro capturado en vivo se abre ya procesado con el filtro que se
  // estaba usando, ahora con el motor de referencia.
  useEffect(() => {
    const f = pendingFilterRef.current;
    if (!image || !f) return;
    pendingFilterRef.current = null;
    runFilterRef.current(f, intensity);
  }, [image]);

  useEffect(() => {
    if (!activeFilterId || !image || isLiveMode || isStacking || isDrawing) return;
    const timer = setTimeout(() => runFilterRef.current(activeFilterId, intensity), 250);
    return () => clearTimeout(timer);
  }, [intensity, selection, isDrawing, image, isLiveMode, isStacking]);

  useEffect(() => {
    if (filteredImageData && !isLiveMode) applyPost(filteredImageData);
  }, [contrast, saturation, isLiveMode, filteredImageData]);

  // Cambiar de zona invalida las estadísticas congeladas: en CRGB, DS-LAB, LDS
  // e YBK la decorrelación se calcula CON LOS DATOS de la zona marcada, así que
  // reusar las de la zona anterior daría un realce que no corresponde a lo que
  // se ve seleccionado.
  const pickSelectionTool = (tool: Exclude<SelectionType, null>) => {
    setSelectionTool(prev => (prev === tool ? null : tool));
    setSelection(null);
    setFrozenStore({});
  };

  const clearSelection = () => {
    setSelectionTool(null);
    setSelection(null);
    setFrozenStore({});
  };

  const handleStartDraw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!selectionTool || !containerRef.current || !image || isLiveMode) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    setIsDrawing(true);
    setFrozenStore({});
    setSelection({ type: selectionTool, points: [{ x, y }] });
  };

  useEffect(() => {
    if (!isDrawing || !selectionTool) return;
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      setSelection(prev => {
        if (!prev) return null;
        if (selectionTool === 'freehand') return { ...prev, points: [...prev.points, { x, y }] };
        return { ...prev, points: [prev.points[0], { x, y }] };
      });
    };
    const handleUp = () => {
      setIsDrawing(false);
      // La herramienta se apaga sola al soltar, como en escritorio: si quedara
      // activa, el deslizador de comparación seguiría sin responder y el
      // siguiente toque borraría la zona recién marcada.
      setSelectionTool(null);
      // Un toque sin arrastre no es una zona. Sin este descarte la máscara sale
      // vacía, el filtro deja de verse y parece que la app se rompió.
      setSelection(prev => {
        if (!prev || prev.points.length < 2) return null;
        if (prev.type === 'freehand' && prev.points.length < 3) return null;
        const xs = prev.points.map(p => p.x), ys = prev.points.map(p => p.y);
        const ancho = Math.max(...xs) - Math.min(...xs);
        const alto = Math.max(...ys) - Math.min(...ys);
        return ancho * alto < 0.0001 ? null : prev;
      });
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [isDrawing, selectionTool]);

  const handleReset = () => {
    stopLiveMode();
    setImage(null);
    setImageSrc(null);
    setProcessedSrc(null);
    setActiveFilterId(null);
    setSelection(null);
    setSelectionTool(null);
    setFrozenStore({});
    setMetadata(null);
  };

  // Los metadatos ya se leían para el reporte PDF, pero solo se veían al
  // abrirlo. En el campo hace falta saber ANTES si la foto trae coordenadas:
  // si no las trae y todavía estás en el sitio, se puede repetir la toma.
  const lat = aNumero(metadata?.lat), lng = aNumero(metadata?.lng);
  const hayGPS = lat !== null && lng !== null;
  const altitud = aNumero(metadata?.altitude);
  const captura = formatearCaptura(metadata?.date);
  const equipo = [metadata?.make, metadata?.model].filter(Boolean).join(" ").trim();

  const copiarCoordenadas = async () => {
    if (!hayGPS) return;
    const texto = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    try {
      await navigator.clipboard.writeText(texto);
      toast({ title: "Coordenadas copiadas", description: texto });
    } catch {
      // Sin permiso de portapapeles el dato sigue estando a la vista.
      toast({ title: "No se pudo copiar", description: texto, variant: "destructive" });
    }
  };

  return (
    <div className={`min-h-screen flex flex-col font-body ${isFieldMode ? 'field-mode' : ''}`}>
      {/* Alto fijo (h-16 = 4rem) porque el visor se ancla justo debajo con top-16. */}
      <header className="bg-primary text-primary-foreground h-16 px-4 sm:px-6 flex justify-between items-center shadow-lg sticky top-0 z-50">
        <div className="flex flex-col">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            {/* El logo estaba escrito y sin usar en ningún lado desde el
                principio. Es la misma identidad que el icono de la PWA. */}
            <OpuntiaLogo className="w-7 h-7 shrink-0" />
            OpuntiaColor <span className="bg-accent text-white text-[10px] px-1.5 py-0.5 rounded-full">v3.6.0</span>
          </h1>
        </div>
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="border-white/20 text-white hover:bg-white/10 h-8 w-8 p-0">
                <Info className="w-4 h-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>OPC v3.6.0 — Motor de Campo</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 text-sm py-4">
                <p>· <strong>En vivo</strong> — Los doce filtros sobre la cámara, calculados en la GPU a la resolución que entregue (hasta 4K), con reducción de ruido, zoom, comparación con el original y pantalla completa. Capturar pasa el cuadro al motor de referencia.</p>
                <p>· <strong>Algoritmos Precisos</strong> — Alineación científica total con la referencia de escritorio v3.6.0: la salida de las fotos coincide byte a byte.</p>
                <p>· <strong>Estadísticas por zona</strong> — Con una zona marcada, la decorrelación (CRGB, DS-LAB, LDS, YBK) se calcula con los datos de esa zona: mejor separación de pigmentos locales, como en DStretch.</p>
                <p>· <strong>Modo PWA</strong> — Funcionamiento 100% offline tras la instalación.</p>
                {/* Aviso legal de la GPL: la licencia pide que una interfaz
                    interactiva muestre de dónde salió el programa, bajo qué
                    términos y que no tiene garantía. */}
                <p className="pt-4 border-t border-border text-[10px] opacity-70 text-center leading-relaxed">
                  Software libre bajo{" "}
                  <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noreferrer" className="underline">GPL-3.0-or-later</a>
                  , sin garantía de ningún tipo. Código fuente en{" "}
                  <a href="https://github.com/emilios81/opuntia-movil" target="_blank" rel="noreferrer" className="underline">github.com/emilios81/opuntia-movil</a>.
                </p>
                <div className="text-[10px] opacity-70 italic text-center">
                  Dr. Emilio A. Villafañez · LATDAA · Fund. Félix de Azara · Universidad Nacional de Catamarca (UNCA), Argentina
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="outline" className="border-white/20 text-white hover:bg-white/10 h-8 w-8 p-0" onClick={() => setIsFieldMode(!isFieldMode)}>
            {isFieldMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
          {processedSrc && !isLiveMode && (
            <Button size="sm" className="bg-accent hover:bg-accent/90 text-white border-none h-8 px-3" onClick={() => generateReport(imageSrc!, processedSrc!, metadata!, FILTERS.find(f => f.id === activeFilterId)?.name || "Original", intensity, imageSize.w, imageSize.h)}>
              <FileText className="w-3 h-3 mr-2" /> Reporte
            </Button>
          )}
        </div>
      </header>

      {/* Columna en celular (no grilla): así el visor puede quedar anclado
          respecto de toda la página y no solo de su propia fila. */}
      <main className="flex-1 p-4 flex flex-col lg:grid lg:grid-cols-4 gap-4 max-w-[1600px] mx-auto w-full">
        {/* A pantalla completa el visor tiene que quedar por encima de la
            cabecera (z-50): este contenedor anclado arma su propio contexto de
            apilamiento, así que sube él también. */}
        <div className={cn(
          "lg:col-span-3 space-y-4 order-1 sticky top-16 -mx-4 px-4 -mt-4 pt-4 pb-2 bg-background lg:static lg:mx-0 lg:px-0 lg:mt-0 lg:pt-0 lg:pb-0 lg:bg-transparent",
          liveImmersive ? "z-[60] lg:z-[60]" : "z-30 lg:z-auto"
        )}>
          <div className="bg-card border border-border rounded-2xl p-2 flex flex-col shadow-sm relative overflow-hidden">
            {!imageSrc ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground py-20">
                <FileImage className="w-16 h-16 opacity-10 mb-4" />
                <p className="text-sm font-bold uppercase tracking-widest">OpuntiaColor v3.6.0</p>
                <p className="text-[10px] opacity-60">Subí una imagen o abrí la cámara en vivo</p>
              </div>
            ) : (
              <>
                <div 
                  ref={containerRef}
                  className={cn(
                    "relative mx-auto bg-black rounded-xl overflow-hidden shadow-2xl",
                    selectionTool && !isLiveMode && "cursor-crosshair ring-2 ring-accent",
                    isLiveMode && liveImmersive && "fixed inset-0 z-[70] rounded-none shadow-none"
                  )}
                  onMouseDown={handleStartDraw}
                  onTouchStart={handleStartDraw}
                  style={{
                    touchAction: (selectionTool && !isLiveMode) ? 'none' : 'auto',
                    width: '100%',
                    // El visor nunca pasa de --viewer-max-h. Con imagen fija se
                    // acota el ANCHO al que corresponde a ese alto, para que la
                    // caja conserve exactamente la proporción de la foto: de eso
                    // depende que la zona seleccionada caiga donde uno la dibuja.
                    // A pantalla completa la caja va fija de borde a borde y
                    // el alto lo dan top y bottom.
                    ...(isLiveMode
                      ? (liveImmersive ? {} : { height: 'var(--viewer-max-h)' })
                      : {
                          aspectRatio: imageSize.w / imageSize.h,
                          maxWidth: `calc(var(--viewer-max-h) * ${imageSize.h ? imageSize.w / imageSize.h : 1})`,
                          maxHeight: 'var(--viewer-max-h)',
                        }),
                  }}
                >
                  {isLiveMode ? (
                    <LiveViewer
                      ref={liveViewerRef}
                      stream={liveStream}
                      filterId={activeFilterId}
                      filterLabel={FILTERS.find(f => f.id === activeFilterId)?.name || "Original"}
                      filterFn={FILTERS.find(f => f.id === activeFilterId)?.fn ?? null}
                      intensity={intensity}
                      contrast={contrast}
                      saturation={saturation}
                      denoise={liveDenoise}
                      lock={liveLock}
                      paused={livePaused}
                      compare={liveCompare}
                      immersive={liveImmersive}
                      cpuMaxWidth={CPU_LIVE_MAX_WIDTH}
                      onInfo={setLiveInfo}
                      onEngineError={(m) => toast({ title: "Motor en vivo", description: m, variant: "destructive" })}
                    >
                      {!liveImmersive ? (
                        <>
                          <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 pointer-events-none">
                            <EstadoEnVivo pausado={livePaused} />
                            {liveLock && (
                              <div className="bg-black/60 text-white text-[9px] font-bold px-2 py-1 rounded-full flex items-center gap-1 border border-white/20">
                                <Lock className="w-3 h-3" /> COLORES FIJOS
                              </div>
                            )}
                          </div>
                          {/* Como en una app de cámara: pausa y captura a la
                              izquierda, vistas a la derecha. Así la barra de
                              abajo no se encima en un celular angosto. */}
                          <div className="absolute bottom-3 left-3 z-20 flex gap-2">
                            <BotonVisor activo={livePaused} onClick={() => setLivePaused(p => !p)} titulo={livePaused ? "Seguir" : "Pausar"}>
                              {livePaused ? <Play className="w-4 h-4 ml-0.5" /> : <Pause className="w-4 h-4" />}
                            </BotonVisor>
                            <BotonVisor onClick={capturarEnVivo} titulo="Capturar este cuadro">
                              <Aperture className={cn("w-4 h-4", isCapturing && "animate-spin")} />
                            </BotonVisor>
                          </div>
                          <div className="absolute bottom-3 right-3 z-20 flex gap-2">
                            <BotonVisor activo={liveCompare} onClick={() => setLiveCompare(c => !c)} titulo="Comparar con el original">
                              <Columns2 className="w-4 h-4" />
                            </BotonVisor>
                            <BotonVisor onClick={entrarPantallaCompleta} titulo="Pantalla completa">
                              <Maximize className="w-4 h-4" />
                            </BotonVisor>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Pantalla completa: los controles van sobre la imagen. */}
                          <div
                            className="absolute top-0 inset-x-0 z-30 flex items-start justify-between gap-2 px-3 pb-8 bg-gradient-to-b from-black/75 to-transparent pointer-events-none"
                            style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}
                          >
                            <div className="flex flex-col items-start gap-1.5">
                              <div className="flex items-center gap-1.5">
                                <EstadoEnVivo pausado={livePaused} />
                                {liveLock && (
                                  <div className="bg-black/60 text-white text-[9px] font-bold px-2 py-1 rounded-full flex items-center gap-1 border border-white/20">
                                    <Lock className="w-3 h-3" /> COLORES FIJOS
                                  </div>
                                )}
                              </div>
                              {liveInfo.width > 0 && (
                                <span className="text-[9px] font-code text-white/80 bg-black/40 px-2 py-0.5 rounded">
                                  {liveInfo.width}&times;{liveInfo.height} &middot; {Math.round(liveInfo.fps)} fps{liveInfo.engine === 'cpu' ? ' · CPU' : ''}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={salirPantallaCompleta}
                              className="pointer-events-auto w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center border border-white/25 shadow-lg"
                              title="Salir de pantalla completa"
                            >
                              <Minimize className="w-5 h-5" />
                            </button>
                          </div>
                          <div
                            className="absolute bottom-0 inset-x-0 z-30 px-3 pt-10 space-y-3 bg-gradient-to-t from-black/85 via-black/60 to-transparent"
                            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
                          >
                            {activeFilterId && (
                              <div className="flex items-center gap-3">
                                <span className="text-[9px] font-bold uppercase text-white/70 tracking-widest">Intensidad</span>
                                <Slider value={[intensity]} onValueChange={v => setIntensity(v[0])} min={0.2} max={5.0} step={0.1} className="flex-1" />
                                <span className="text-[11px] font-code font-bold text-white w-9 text-right">{intensity.toFixed(1)}&times;</span>
                              </div>
                            )}
                            <div ref={tiraRef} className="flex gap-1.5 overflow-x-auto -mx-3 px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                              {[{ id: null as string | null, name: 'Original', icon: '◻' }, ...FILTERS].map(f => (
                                <button
                                  key={f.id ?? 'original'}
                                  data-activo={activeFilterId === f.id}
                                  onClick={() => setActiveFilterId(f.id)}
                                  className={cn(
                                    "shrink-0 flex items-center gap-1.5 pl-2 pr-3 h-9 rounded-full border text-[11px] font-bold whitespace-nowrap transition-colors",
                                    activeFilterId === f.id ? "bg-white text-black border-white" : "bg-black/50 text-white border-white/25"
                                  )}
                                >
                                  <span className="text-sm leading-none">{f.icon}</span>{f.name}
                                </button>
                              ))}
                            </div>
                            <div className="flex items-center justify-between px-1">
                              <BotonRedondo activo={liveCompare} onClick={() => setLiveCompare(c => !c)} etiqueta="Comparar">
                                <Columns2 className="w-5 h-5" />
                              </BotonRedondo>
                              <BotonRedondo activo={liveLock} onClick={() => setLiveLock(l => !l)} etiqueta={liveLock ? "Colores fijos" : "Fijar colores"}>
                                {liveLock ? <Lock className="w-5 h-5" /> : <LockOpen className="w-5 h-5" />}
                              </BotonRedondo>
                              <button
                                onClick={() => setLivePaused(p => !p)}
                                className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-xl border-4 border-white/40"
                                title={livePaused ? "Seguir" : "Pausar"}
                              >
                                {livePaused ? <Play className="w-7 h-7 ml-0.5" /> : <Pause className="w-7 h-7" />}
                              </button>
                              <BotonRedondo onClick={capturarEnVivo} etiqueta="Capturar" deshabilitado={isCapturing}>
                                <Aperture className={cn("w-5 h-5", isCapturing && "animate-spin")} />
                              </BotonRedondo>
                              {torch.disponible ? (
                                <BotonRedondo activo={torch.encendida} onClick={alternarLinterna} etiqueta="Linterna">
                                  {torch.encendida ? <Flashlight className="w-5 h-5" /> : <FlashlightOff className="w-5 h-5" />}
                                </BotonRedondo>
                              ) : (
                                <BotonRedondo onClick={stopLiveMode} etiqueta="Detener">
                                  <X className="w-5 h-5" />
                                </BotonRedondo>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </LiveViewer>
                  ) : (
                    <CompareSlider 
                      originalSrc={imageSrc} 
                      processedSrc={processedSrc} 
                      aspectRatio={imageSize.w / imageSize.h}
                      filterLabel={FILTERS.find(f => f.id === activeFilterId)?.name || "Original"}
                      className={selectionTool ? "pointer-events-none opacity-80" : ""}
                    />
                  )}
                  {selection && !isLiveMode && (
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none z-40">
                      <defs>
                        <mask id="selection-mask">
                          <rect width="100" height="100" fill="white" />
                          {selection.type === 'rect' && selection.points.length >= 2 && (
                            <rect 
                              x={Math.min(selection.points[0].x, selection.points[1].x) * 100}
                              y={Math.min(selection.points[0].y, selection.points[1].y) * 100}
                              width={Math.abs(selection.points[1].x - selection.points[0].x) * 100}
                              height={Math.abs(selection.points[1].y - selection.points[0].y) * 100}
                              fill="black"
                            />
                          )}
                          {selection.type === 'circle' && selection.points.length >= 2 && (
                            <ellipse
                              cx={(selection.points[0].x + selection.points[1].x) / 2 * 100}
                              cy={(selection.points[0].y + selection.points[1].y) / 2 * 100}
                              rx={Math.abs(selection.points[1].x - selection.points[0].x) / 2 * 100}
                              ry={Math.abs(selection.points[1].y - selection.points[0].y) / 2 * 100}
                              fill="black"
                            />
                          )}
                          {selection.type === 'freehand' && selection.points.length >= 2 && (
                            <path 
                              d={`M ${selection.points[0].x * 100} ${selection.points[0].y * 100} ` + selection.points.slice(1).map(p => `L ${p.x * 100} ${p.y * 100}`).join(' ') + (isDrawing ? '' : ' Z')}
                              fill="black"
                            />
                          )}
                        </mask>
                      </defs>
                      <rect width="100" height="100" fill="black" fillOpacity="0.45" mask="url(#selection-mask)" />
                    </svg>
                  )}
                  {selectionTool && !isLiveMode && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 bg-accent text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg pointer-events-none whitespace-nowrap">
                      Dibujá la zona · {SELECTION_TOOLS.find(t => t.id === selectionTool)?.name}
                    </div>
                  )}
                  {isProcessing && (
                    <div className="absolute inset-0 bg-background/60 backdrop-blur-sm z-50 flex items-center justify-center rounded-xl">
                      <div className="bg-white text-black px-5 py-3 rounded-full shadow-xl flex items-center gap-3 border border-border">
                        <RefreshCw className="w-4 h-4 animate-spin text-accent" />
                        <span className="text-xs font-bold uppercase tracking-wider">Analizando pigmentos...</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between px-2 py-1">
                  <div className="flex items-center gap-3 text-[10px] font-code text-muted-foreground uppercase tracking-widest min-w-0">
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      <Maximize2 className="w-3 h-3" />
                      {isLiveMode
                        ? (liveInfo.width ? `${liveInfo.width} x ${liveInfo.height} PX` : "—")
                        : `${imageSize.w} x ${imageSize.h} PX`}
                    </span>
                    {isLiveMode && liveInfo.fps > 0 && (
                      <span className="whitespace-nowrap">{Math.round(liveInfo.fps)} FPS{liveInfo.engine === 'cpu' ? ' · CPU' : ''}</span>
                    )}
                    <span className="hidden sm:flex items-center gap-1"><Zap className="w-3 h-3 text-accent" /> Motor v3.6.0</span>
                    {isStacking && processedSrc && <span className="flex items-center gap-1 text-accent font-bold animate-pulse"><StackingIcon className="w-3 h-3" /> STACK ACTIVO</span>}
                  </div>
                  {(processedSrc || isLiveMode) && (
                    <div className="flex gap-1.5 shrink-0">
                      {isLiveMode && (
                        <Button size="sm" variant="destructive" className="h-7 px-2.5 text-[10px] font-bold" onClick={stopLiveMode}><X className="w-3 h-3 mr-1" /> Detener</Button>
                      )}
                      {!isLiveMode && processedSrc && (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 text-[10px] text-destructive hover:bg-destructive/10" onClick={handleClearStack}><Trash2 className="w-3 h-3 mr-1" /> Limpiar</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-[10px] hover:bg-accent/10" onClick={() => {
                            const link = document.createElement('a');
                            link.href = processedSrc || "";
                            link.download = `${fileName.split('.')[0]}_OPC_${activeFilterId}.png`;
                            link.click();
                          }}><Download className="w-3 h-3 mr-1" /> Descargar</Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <aside className="lg:col-span-1 space-y-4 order-2 h-fit">
          {!imageSrc ? (
            <Card className="border-dashed border-2 border-primary/20 bg-muted/5 p-8 flex flex-col items-center text-center gap-6 shadow-inner">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary shadow-inner"><Upload className="w-8 h-8" /></div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold">Captura e Inspección</h3>
                <p className="text-xs text-muted-foreground">Recorré el panel con la cámara en vivo, o subí una foto para analizarla en detalle.</p>
              </div>
              <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => e.target.files && handleFile(e.target.files[0])} accept="image/*" />
              <input type="file" ref={cameraInputRef} className="hidden" onChange={(e) => e.target.files && handleFile(e.target.files[0])} accept="image/*" capture="environment" />
              <div className="grid grid-cols-1 gap-3 w-full">
                <Button onClick={startLiveMode} className="w-full h-12 bg-accent hover:bg-accent/90 text-white font-bold shadow-lg transform transition-transform active:scale-95"><Video className="w-4 h-4 mr-2" /> EN VIVO</Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => cameraInputRef.current?.click()} className="w-full h-10 shadow-sm"><Camera className="w-4 h-4 mr-2" /> Foto</Button>
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full h-10 shadow-sm"><Upload className="w-4 h-4 mr-2" /> Archivo</Button>
                </div>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="w-full h-10 border-accent text-accent hover:bg-accent hover:text-white font-bold shadow-sm" onClick={isLiveMode ? stopLiveMode : startLiveMode}>
                  {isLiveMode ? <><X className="w-4 h-4 mr-2" /> Detener</> : <><Video className="w-4 h-4 mr-2" /> En vivo</>}
                </Button>
                <Button variant="outline" className="w-full h-10 border-accent text-accent hover:bg-accent hover:text-white font-bold shadow-sm" onClick={handleReset}><PlusCircle className="w-4 h-4 mr-2" /> Nuevo</Button>
              </div>

              {isLiveMode && (
                <Card className="p-4 space-y-3 shadow-inner bg-muted/10 border-border">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Calidad en vivo</label>
                    {liveInfo.width > 0 && (
                      <span className="text-[10px] font-code font-bold bg-accent/10 text-accent px-2 py-0.5 rounded border border-accent/20">
                        {liveInfo.width}&times;{liveInfo.height}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {LIVE_TIERS.map(t => (
                      <button
                        key={t.id}
                        onClick={() => cambiarCalidad(t.id)}
                        className={cn(
                          "flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg border font-bold transition-all",
                          liveTier === t.id
                            ? "bg-accent border-accent text-white shadow-sm"
                            : "bg-card border-border text-muted-foreground hover:bg-muted"
                        )}
                      >
                        <span className="text-[11px]">{t.label}</span>
                        <span className="text-[8px] font-normal opacity-70">{t.detalle}</span>
                      </button>
                    ))}
                  </div>
                  {liveInfo.camW > 0 && (
                    <dl className="text-[9px] font-code text-muted-foreground border-t border-border pt-2 space-y-1">
                      <div className="flex justify-between gap-3">
                        <dt>C&aacute;mara entrega</dt>
                        <dd className="font-bold">{liveInfo.camW}&times;{liveInfo.camH}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt>Procesa</dt>
                        <dd className="font-bold">
                          {liveInfo.engine === 'gpu' ? 'GPU · resolución completa' : 'CPU · reducida'} &middot; {Math.round(liveInfo.fps)} fps
                        </dd>
                      </div>
                    </dl>
                  )}
                  {liveInfo.camW > 0 && (() => {
                    // Lo que se pidió contra lo que llegó: si la cámara no da
                    // la calidad elegida, que se sepa (y que conste en notas).
                    const pedido = LIVE_TIERS.find(t => t.id === liveTier)!;
                    const mayor = Math.max(liveInfo.camW, liveInfo.camH);
                    return mayor < pedido.w ? (
                      <p className="text-[9px] text-accent leading-snug font-bold">
                        Tu c&aacute;mara no entrega {pedido.label} por esta v&iacute;a: lo m&aacute;ximo que da es {liveInfo.camW}&times;{liveInfo.camH}, y se trabaja a eso.
                      </p>
                    ) : null;
                  })()}
                  {liveInfo.engine === 'gpu' && liveInfo.fps > 0 && liveInfo.fps < 12 && liveTier !== 'hd' && !livePaused && (
                    <p className="text-[9px] text-accent leading-snug font-bold">
                      El video va a {Math.round(liveInfo.fps)} cuadros por segundo. Si se entrecorta, baj&aacute; a {liveTier === '4k' ? 'Full HD' : 'HD'}: este equipo no da para m&aacute;s a esta resoluci&oacute;n.
                    </p>
                  )}
                  {liveInfo.engine === 'cpu' && (
                    <p className="text-[9px] text-accent leading-snug font-bold">
                      Este equipo no ofrece procesamiento por GPU (WebGL2): el video se procesa en la CPU, achicado a {CPU_LIVE_MAX_WIDTH} px, y sin zoom ni reducci&oacute;n de ruido.
                    </p>
                  )}
                  <p className="text-[9px] text-muted-foreground leading-snug">
                    La imagen en vivo se calcula en la GPU con los mismos filtros. Para el registro, <strong>Capturar</strong> pasa el cuadro a la vista de foto y lo procesa con el motor de referencia.
                  </p>
                </Card>
              )}

              {isLiveMode && (
                <Card className="p-4 space-y-4 shadow-inner bg-muted/10 border-border">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Reducci&oacute;n de ruido</label>
                    <div className="grid grid-cols-3 gap-2">
                      {DENOISE_OPTIONS.map(o => (
                        <button
                          key={o.valor}
                          onClick={() => cambiarRuido(o.valor)}
                          disabled={liveInfo.engine === 'cpu'}
                          className={cn(
                            "py-1.5 rounded-lg border text-[10px] font-bold transition-all disabled:opacity-40",
                            liveDenoise === o.valor
                              ? "bg-accent border-accent text-white shadow-sm"
                              : "bg-card border-border text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {o.etiqueta}
                        </button>
                      ))}
                    </div>
                    <p className="text-[9px] text-muted-foreground leading-snug">
                      Promedia los &uacute;ltimos cuadros donde la imagen est&aacute; quieta. La decorrelaci&oacute;n amplifica el granulado de color del sensor: con el equipo firme o apoyado, Media lo baja a menos de la mitad y Alta a la cuarta parte. Al mover la c&aacute;mara, Alta deja una estela breve en los detalles tenues.
                    </p>
                  </div>
                  <div className="space-y-2 pt-3 border-t border-border">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="fijar-colores" className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest cursor-pointer">
                        Fijar colores
                      </Label>
                      <Switch id="fijar-colores" checked={liveLock} onCheckedChange={setLiveLock} />
                    </div>
                    <p className="text-[9px] text-muted-foreground leading-snug">
                      {liveLock
                        ? "Las estadísticas de la decorrelación quedan congeladas: el mismo pigmento conserva su color aunque muevas la cámara."
                        : "Apuntá a una zona representativa del panel y fijá: los colores dejan de cambiar con cada encuadre."}
                    </p>
                  </div>
                  {torch.disponible && (
                    <div className="flex items-center justify-between gap-3 pt-3 border-t border-border">
                      <Label htmlFor="linterna" className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest cursor-pointer">
                        Linterna
                      </Label>
                      <Switch id="linterna" checked={torch.encendida} onCheckedChange={alternarLinterna} />
                    </div>
                  )}
                </Card>
              )}

              {/* En celular la lista se muestra entera y se recorre con el
                  desplazamiento de la página, con la cámara siempre a la vista. */}
              <Card className="bg-card shadow-lg border-border lg:overflow-y-auto lg:max-h-[400px] p-1 space-y-1 custom-scrollbar">
                {isLiveMode && (
                  <button
                    onClick={() => setActiveFilterId(null)}
                    className={cn(
                      "w-full flex items-center gap-2 p-3 rounded-xl transition-all text-left",
                      activeFilterId === null ? "bg-accent text-white shadow-md ring-2 ring-accent/20" : "hover:bg-muted bg-transparent text-foreground"
                    )}
                  >
                    <span className="text-base bg-background/10 w-10 h-10 flex items-center justify-center rounded-xl shadow-sm">◻</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold truncate leading-tight uppercase tracking-tighter">Original</p>
                      <p className={cn("text-[9px] truncate opacity-60 font-medium", activeFilterId === null ? "text-white" : "text-muted-foreground")}>La c&aacute;mara sin filtro, para encuadrar</p>
                    </div>
                  </button>
                )}
                {FILTERS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => isLiveMode ? setActiveFilterId(f.id) : runFilter(f.id, intensity)}
                    className={cn(
                      "w-full flex items-center gap-2 p-3 rounded-xl transition-all text-left",
                      activeFilterId === f.id ? "bg-accent text-white shadow-md ring-2 ring-accent/20" : "hover:bg-muted bg-transparent text-foreground"
                    )}
                  >
                    <span className="text-base bg-background/10 w-10 h-10 flex items-center justify-center rounded-xl shadow-sm">{f.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold truncate leading-tight uppercase tracking-tighter">{f.name}</p>
                      <p className={cn("text-[9px] truncate opacity-60 font-medium", activeFilterId === f.id ? "text-white" : "text-muted-foreground")}>{f.desc}</p>
                    </div>
                  </button>
                ))}
              </Card>

              {/* Zona y acumulación no tienen sentido sobre el video en vivo:
                  ahí cada cuadro se procesa entero y de cero. */}
              {!isLiveMode && (
                <Card className="p-4 space-y-3 shadow-inner bg-muted/10 border-border">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Selección</label>
                    {(selection || selectionTool) && (
                      <button
                        onClick={clearSelection}
                        className="flex items-center gap-1 text-[9px] font-bold text-destructive hover:bg-destructive/10 px-2 py-0.5 rounded transition-colors"
                      >
                        <X className="w-3 h-3" /> Quitar
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {SELECTION_TOOLS.map(t => (
                      <button
                        key={t.id}
                        onClick={() => pickSelectionTool(t.id)}
                        className={cn(
                          "flex flex-col items-center gap-1 py-2 px-1 rounded-lg border font-bold transition-all active:scale-95",
                          selectionTool === t.id
                            ? "bg-accent border-accent text-white shadow-sm"
                            : "bg-card border-border text-muted-foreground hover:bg-muted"
                        )}
                      >
                        <t.Icon className="w-4 h-4" />
                        <span className="text-[8px] leading-none text-center">{t.name}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[9px] text-muted-foreground leading-snug">
                    {selectionTool
                      ? "Arrastrá sobre la imagen para marcar la zona. Al soltar se aplica el filtro."
                      : selection
                      ? "Zona marcada: el filtro —y las estadísticas de decorrelación— se calculan solo ahí."
                      : "Sin zona: el filtro va sobre toda la imagen."}
                  </p>
                </Card>
              )}

              {!isLiveMode && (
                <Card className="p-4 space-y-3 shadow-inner bg-muted/10 border-border">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="acumular" className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest cursor-pointer">
                      Acumular filtros
                    </Label>
                    <Switch id="acumular" checked={isStacking} onCheckedChange={setIsStacking} />
                  </div>
                  <p className="text-[9px] text-muted-foreground leading-snug">
                    {isStacking
                      ? "Cada filtro se aplica sobre el resultado anterior. La intensidad deja de reaplicarse sola: elegí el valor y volvé a tocar el filtro."
                      : "Cada filtro parte siempre de la imagen original."}
                  </p>
                </Card>
              )}

              {!isLiveMode && metadata && (
                <Card className="p-4 space-y-3 shadow-inner bg-muted/10 border-border">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Metadatos de la foto</label>
                    {hayGPS && (
                      <button
                        onClick={copiarCoordenadas}
                        className="flex items-center gap-1 text-[9px] font-bold text-accent hover:bg-accent/10 px-2 py-0.5 rounded transition-colors"
                      >
                        <Copy className="w-3 h-3" /> Copiar
                      </button>
                    )}
                  </div>
                  {hayGPS ? (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-code text-[11px] font-bold leading-tight break-all">
                          {lat.toFixed(6)}, {lng.toFixed(6)}
                        </p>
                        {altitud !== null && (
                          <p className="font-code text-[9px] text-muted-foreground">{Math.round(altitud)} m s. n. m.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-muted-foreground leading-snug">
                        {origenEnVivo
                          ? "Cuadro capturado en vivo: el video de la cámara no lleva coordenadas. Para dejar el sitio registrado, sacá también una Foto."
                          : "La foto no trae coordenadas. Suele pasar con el GPS de la cámara apagado, o si el archivo pasó por una app de mensajería que borra los metadatos."}
                      </p>
                    </div>
                  )}
                  <dl className="text-[9px] font-code space-y-1 border-t border-border pt-2">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground shrink-0">Captura</dt>
                      <dd className="text-right truncate">{captura ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground shrink-0">Equipo</dt>
                      <dd className="text-right truncate">{equipo || "—"}</dd>
                    </div>
                  </dl>
                </Card>
              )}

              {activeFilterId && (
                <Card className="p-4 space-y-5 shadow-inner bg-muted/10 border-border">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Intensidad</label>
                      <span className="text-[10px] font-code font-bold bg-accent/10 text-accent px-2 py-0.5 rounded border border-accent/20">{intensity.toFixed(1)}x</span>
                    </div>
                    <Slider value={[intensity]} onValueChange={v => setIntensity(v[0])} min={0.2} max={5.0} step={0.1} className="py-2" />
                    <div className="flex flex-wrap gap-1 justify-between">
                      {PRESETS.map(p => (
                        <button key={p.label} onClick={() => setIntensity(p.value)} className={cn("text-[9px] px-2 py-1 rounded-md border font-bold transition-all", intensity === p.value ? "bg-accent border-accent text-white shadow-sm scale-105" : "bg-card border-border text-muted-foreground hover:bg-muted")}>{p.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="pt-3 border-t border-border space-y-4">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Contraste</label>
                        <span className="text-[10px] font-code font-bold opacity-70">{(contrast > 0 ? "+" : "") + contrast}</span>
                      </div>
                      <Slider value={[contrast]} onValueChange={v => setContrast(v[0])} min={-80} max={80} step={5} />
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Saturación</label>
                        <span className="text-[10px] font-code font-bold opacity-70">{(saturation > 0 ? "+" : "") + saturation}</span>
                      </div>
                      <Slider value={[saturation]} onValueChange={v => setSaturation(v[0])} min={-100} max={100} step={5} />
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}
        </aside>
      </main>

      <footer className="py-8 px-6 border-t border-border bg-card/50 text-center mt-auto">
        <div className="space-y-2 text-[10px] text-muted-foreground tracking-tight font-medium max-w-2xl mx-auto">
          <p>Dr. Emilio A. Villafañez · LATDAA · Fund. Félix de Azara · Universidad Nacional de Catamarca (UNCA), Argentina</p>
          <div className="flex items-center justify-center gap-4 pt-4 border-t border-border/50">
            <span className="opacity-60 font-code uppercase tracking-widest font-bold">OpuntiaColor v3.6.0</span>
            <span className="bg-accent/10 text-accent px-2 py-0.5 rounded-full font-bold">OFFLINE READY</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
