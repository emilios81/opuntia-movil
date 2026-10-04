
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
  Video,
  SlidersHorizontal
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
import { LiveViewer, type LiveInfo, type LiveViewerHandle } from '@/components/LiveViewer';
import type { Denoise } from '@/lib/live-gpu';
import * as OPC from '@/lib/image-processing';
import { extractMetadata, type ImageMetadata } from '@/lib/exif-utils';
import { generateReport } from '@/lib/pdf-report';
import { tamanoDeTrabajo, LADO_REDUCIDO, TOPE_CELULAR, TOPE_ESCRITORIO } from '@/lib/resolucion';
import { VERSION } from '@/lib/version';
import { IdiomaContext, useIdioma, traductor, idiomaGuardado, guardarIdioma, type Idioma } from '@/lib/idioma';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type SelectionType = 'rect' | 'circle' | 'freehand' | null;

interface Selection {
  type: SelectionType;
  points: { x: number; y: number }[];
}

// Nombres y descripciones en inglés: los mismos que usa la versión de
// escritorio, para que un filtro se llame igual en las dos apps.
const FILTERS = [
  { id: "red", name: "Rojo", nameEn: "Red", icon: "🔴", desc: "Pinturas y pigmentos rojos / ocres", descEn: "Red paints and pigments / ochres", fn: OPC.red },
  { id: "white", name: "Blanco", nameEn: "White", icon: "⚪", desc: "Pinturas y pigmentos blancos / claros", descEn: "White and light paints / pigments", fn: OPC.white },
  { id: "black", name: "Negro", nameEn: "Black", icon: "⚫", desc: "Pigmentos oscuros / negros / carbones", descEn: "Dark pigments / blacks / charcoal", fn: OPC.black },
  { id: "bichrome", name: "Bicromo", nameEn: "Bichrome", icon: "◑", desc: "Combina realce rojo + blanco", descEn: "Combines red + white enhancement", fn: OPC.bichrome },
  { id: "crgb", name: "CRGB", nameEn: "CRGB", icon: "🌈", desc: "Decorrelación pura RGB / variabilidad espectral", descEn: "Pure RGB decorrelation / spectral variability", fn: OPC.crgb },
  { id: "dslab", name: "DS-LAB", nameEn: "DS-LAB", icon: "🔵", desc: "Decorrelación perceptual CIE-LAB / pigmentos sutiles", descEn: "Perceptual CIE-LAB decorrelation / subtle pigments", fn: OPC.dslab },
  { id: "lds", name: "LDS", nameEn: "LDS", icon: "🟣", desc: "Decorrelation Stretch RGB / análisis general", descEn: "RGB Decorrelation Stretch / general analysis", fn: OPC.lds },
  { id: "petro", name: "Micro-relieve", nameEn: "Micro-relief", icon: "🪨", desc: "Pátina + textura + bordes / grabados y surcos", descEn: "Patina + texture + edges / engravings and grooves", fn: OPC.petro },
  { id: "relief", name: "Relieve", nameEn: "Relief", icon: "🗺", desc: "Mapa de bordes multi-escala / calco digital", descEn: "Multi-scale edge map / digital tracing", fn: OPC.relief },
  { id: "ybk", name: "YBK", nameEn: "YBK", icon: "🟡", desc: "Crominancia YCbCr / separación cromática", descEn: "YCbCr chrominance / chromatic separation", fn: OPC.ybk },
  { id: "clahe", name: "CLAHE", nameEn: "CLAHE", icon: "◐", desc: "Ecualización adaptativa de histograma / sombras", descEn: "Adaptive histogram equalization / shadows", fn: OPC.clahe },
  { id: "map", name: "Mapa pigmentos", nameEn: "Pigment map", icon: "🗺️", desc: "Falso color por tipo de pigmento detectado", descEn: "False color by detected pigment type", fn: OPC.map },
];

const SELECTION_TOOLS: { id: Exclude<SelectionType, null>; name: string; nameEn: string; Icon: typeof Square }[] = [
  { id: "rect", name: "Rectángulo", nameEn: "Rectangle", Icon: Square },
  { id: "circle", name: "Círculo", nameEn: "Circle", Icon: CircleIcon },
  { id: "freehand", name: "Mano alzada", nameEn: "Freehand", Icon: Pencil },
];

// EXIF guarda la fecha como "2026:08:07 12:30:45", que no es lo que espera
// Date.parse ni lo que nadie quiere leer. Si viene con otro formato se muestra
// tal cual: mejor el dato crudo que un hueco. En inglés va AAAA-MM-DD: el
// 04/10 nuestro allá se lee 10 de abril.
function formatearCaptura(raw: string | undefined, lang: Idioma): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return raw;
  return lang === 'en' ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}

// exif-js devuelve los racionales como objetos Number, no como primitivos.
function aNumero(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const PRESETS = [
  { label: "Sutil", labelEn: "Subtle", value: 0.4 },
  { label: "Suave", labelEn: "Mild", value: 1.0 },
  { label: "Medio", labelEn: "Medium", value: 1.8 },
  { label: "Fuerte", labelEn: "Strong", value: 3.0 },
  { label: "Extremo", labelEn: "Extreme", value: 4.5 },
];

// Calidades del modo en vivo: lo que se le pide a la cámara. Con el motor de
// la GPU se procesa a la resolución que la cámara entregue de verdad, sin
// achicar; "ideal" es una sugerencia, y si el equipo no llega a 4K da lo más
// cercano que tenga (se muestra en pantalla). HD (1280 × 720) salió en v3.6.1:
// en el celular no se distinguía de Full HD y no aportaba nada para analizar.
type LiveTier = 'fhd' | '4k';
const LIVE_TIERS: { id: LiveTier; label: string; detalle: string; w: number; h: number }[] = [
  { id: 'fhd', label: 'Full HD', detalle: '1920 × 1080', w: 1920, h: 1080 },
  { id: '4k', label: '4K', detalle: '3840 × 2160', w: 3840, h: 2160 },
];

const DENOISE_OPTIONS: { valor: Denoise; etiqueta: string; etiquetaEn: string }[] = [
  { valor: 0, etiqueta: 'No', etiquetaEn: 'Off' },
  { valor: 1, etiqueta: 'Media', etiquetaEn: 'Medium' },
  { valor: 2, etiqueta: 'Alta', etiquetaEn: 'High' },
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

// Las imágenes de public/ no pasan por el router de Next: llevan el prefijo de
// la ruta a mano, como en layout.tsx.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

// Las explicaciones de los paneles. Eran de 9 px y en el celular no se leían:
// 10,5 px las hace legibles sin agrandar los paneles más de la cuenta.
const AYUDA = "text-[10.5px] leading-snug";

// Insignia del visor en vivo: rojo, como en cualquier transmisión; ámbar en
// pausa. Colores fijos y no los del tema: en el modo de campo el acento es
// blanco y la insignia quedaba blanco sobre blanco.
function EstadoEnVivo({ pausado }: { pausado: boolean }) {
  const { tr } = useIdioma();
  return (
    <div className={cn(
      "text-white text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-lg",
      pausado ? "bg-amber-600" : "bg-red-600"
    )}>
      {pausado
        ? <><Pause className="w-3 h-3" /> {tr("PAUSADO", "PAUSED")}</>
        : <><span className="w-2 h-2 bg-white rounded-full animate-pulse" /> {tr("EN VIVO", "LIVE")}</>}
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
      <span className="text-[10px] font-bold text-white/85 leading-none text-center">{etiqueta}</span>
    </button>
  );
}

// Fila de ajuste a pantalla completa: rótulo, deslizador y valor. El rótulo
// tiene ancho fijo para que los tres deslizadores arranquen a la misma altura y
// el de intensidad no salte al abrir o cerrar Ajustes.
function FilaAjuste({ etiqueta, valor, children }: { etiqueta: string; valor: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[80px] shrink-0 text-[10px] font-bold uppercase text-white/75 tracking-wider">{etiqueta}</span>
      {children}
      <span className="w-10 shrink-0 text-[11px] font-code font-bold text-white text-right">{valor}</span>
    </div>
  );
}

// Resolución de trabajo de las fotos. Va arriba de los filtros, como en el
// escritorio, porque es una decisión que se toma ANTES de procesar: al fondo
// del panel pasaba inadvertida. Las dos opciones se muestran juntas para que se
// vea cuál está activa, y el recuadro queda en rojo mientras se trabaja a menos
// que la resolución real (elegido 2000 px, o la foto pasa el tope del celular).
function ResolucionDeTrabajo({ completa, natW, natH, w, h, onCambiar }: {
  completa: boolean; natW: number; natH: number; w: number; h: number; onCambiar(completa: boolean): void;
}) {
  const { tr } = useIdioma();
  const topada = completa && Math.max(natW, natH) > TOPE_CELULAR;
  const reducida = !completa || topada;
  return (
    <Card className={cn("p-4 space-y-2 shadow-inner bg-muted/10", reducida ? "border-accent" : "border-border")}>
      <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">{tr("Resolución de trabajo", "Working resolution")}</label>
      <div className="grid grid-cols-2 gap-2">
        {[{ v: true, l: tr("Completa", "Full") }, { v: false, l: `${LADO_REDUCIDO} px` }].map(o => (
          <button
            key={String(o.v)}
            onClick={() => onCambiar(o.v)}
            aria-pressed={completa === o.v}
            className={cn(
              "py-1.5 rounded-lg border text-[11px] font-bold transition-all",
              completa === o.v ? "bg-accent border-accent text-accent-foreground shadow-sm" : "bg-card border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {o.l}
          </button>
        ))}
      </div>
      <p className={cn("text-[10px] font-code", reducida ? "text-accent font-bold" : "text-muted-foreground")}>
        {w} &times; {h} px{" "}
        {!completa
          ? tr(`· reducida de ${natW}×${natH}`, `· reduced from ${natW}×${natH}`)
          : topada
            ? tr(`· tope del celular (orig. ${natW}×${natH})`, `· phone limit (orig. ${natW}×${natH})`)
            : tr("· la resolución real de la foto", "· the photo’s real resolution")}
      </p>
      <p className={cn(AYUDA, "text-muted-foreground")}>
        {!completa
          ? tr("Más rápido, pero se procesa menos detalle.", "Faster, but less detail is processed.")
          : topada
            ? tr(`Más de ${TOPE_CELULAR} px no entra en la memoria de un celular. El escritorio la procesa entera, hasta ${TOPE_ESCRITORIO} px.`,
                 `More than ${TOPE_CELULAR} px does not fit in a phone’s memory. The desktop version processes it whole, up to ${TOPE_ESCRITORIO} px.`)
            : tr("La misma foto da el mismo resultado que en el escritorio.", "The same photo gives the same result as in the desktop version.")}
      </p>
    </Card>
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
  // Idioma de la interfaz (ver src/lib/idioma.ts). Se lee después de montar,
  // como las demás preferencias: al compilar el sitio estático no hay
  // localStorage ni navigator. Los avisos que se disparan más tarde (la cámara
  // que se corta, una falla de la GPU) leen el idioma por trRef, el vigente.
  const [lang, setLang] = useState<Idioma>('es');
  const tr = traductor(lang);
  const trRef = useRef(tr);
  useEffect(() => { trRef.current = tr; });
  useEffect(() => { setLang(idiomaGuardado()); }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const cambiarIdioma = () => {
    const nuevo: Idioma = lang === 'es' ? 'en' : 'es';
    setLang(nuevo);
    guardarIdioma(nuevo);
  };
  const nombreFiltro = (id: string | null) => {
    const f = FILTERS.find(x => x.id === id);
    return f ? tr(f.name, f.nameEn) : 'Original';
  };
  // Resolución de trabajo de las fotos: completa por defecto, como en el
  // escritorio, o 2000 px. Dura lo que dura la sesión.
  const [fullRes, setFullRes] = useState(true);
  // Se está codificando la imagen con un contraste o saturación nuevos.
  const [aplicandoAjustes, setAplicandoAjustes] = useState(false);
  // Número de la última pasada de ajustes (ver applyPost) y el resultado del
  // filtro vigente, para descartar codificaciones que quedaron viejas.
  const postSeqRef = useRef(0);
  const filteredRef = useRef<ImageData | null>(null);
  useEffect(() => { filteredRef.current = filteredImageData; }, [filteredImageData]);

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
  // A pantalla completa: los deslizadores de intensidad, contraste y
  // saturación en lugar de la tira de filtros.
  const [liveAjustes, setLiveAjustes] = useState(false);
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
    if (c === 'fhd' || c === '4k') setLiveTier(c);
    // Quien había elegido HD lo hizo para aliviar el equipo: pasa a la más
    // liviana de las que quedan.
    else if (c === 'hd') { setLiveTier('fhd'); guardarPreferencia('opc_envivo_calidad', 'fhd'); }
    const r = leerPreferencia('opc_envivo_ruido');
    if (r === '0' || r === '1' || r === '2') setLiveDenoise(Number(r) as Denoise);
  }, []);

  // Deja la vista sin resultado y anula una codificación en curso, que si no
  // terminaría mostrando la imagen anterior (ver applyPost).
  const descartarProcesado = () => {
    postSeqRef.current++;
    setProcessedSrc(null);
    setFilteredImageData(null);
    setAplicandoAjustes(false);
    setIsProcessing(false);
  };

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
    const t = LIVE_TIERS.find(x => x.id === tier) ?? LIVE_TIERS[LIVE_TIERS.length - 1];
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
      const t = trRef.current;
      toast({
        title: t("Se cortó la cámara", "The camera stopped"),
        description: t("Otra aplicación la tomó o el sistema la suspendió. Tocá En vivo para retomar.",
                       "Another app took it or the system suspended it. Tap Live to resume."),
      });
      stopLiveMode();
    });
    const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
    setTorch({ disponible: !!caps.torch, encendida: false });
  };

  const errorDeCamara = (err: unknown) => {
    console.error("Error al abrir la cámara:", err);
    const name = (err as DOMException)?.name;
    toast({
      title: tr("Error de cámara", "Camera error"),
      description: name === "NotAllowedError"
        ? tr("Permiso denegado. Habilitá la cámara para este sitio.", "Permission denied. Allow the camera for this site.")
        : name === "NotFoundError"
        ? tr("No se encontró ninguna cámara.", "No camera was found.")
        : name === "NotReadableError"
        ? tr("La cámara está ocupada por otra aplicación.", "The camera is in use by another app.")
        : tr("No se pudo abrir la cámara.", "Could not open the camera."),
      variant: "destructive"
    });
  };

  const startLiveMode = async () => {
    if (isLiveMode) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      toast({
        title: tr("Cámara no disponible", "Camera not available"),
        description: tr("El navegador no expone la cámara. Requiere HTTPS o localhost.", "The browser does not expose the camera. It requires HTTPS or localhost."),
        variant: "destructive",
      });
      return;
    }

    try {
      await abrirCamara(liveTier);
      descartarProcesado();
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
      toast({ title: tr("No se pudo usar la linterna", "Could not use the flashlight"), variant: "destructive" });
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
  // Lo mismo al cerrar Ajustes, que vuelve a mostrar la tira.
  useEffect(() => {
    if (!liveImmersive || liveAjustes) return;
    const activo = tiraRef.current?.querySelector('[data-activo="true"]') as HTMLElement | null;
    activo?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [liveImmersive, liveAjustes, activeFilterId]);

  // Al volver a la pantalla completa se arranca otra vez con la tira de filtros.
  useEffect(() => { if (!liveImmersive) setLiveAjustes(false); }, [liveImmersive]);

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
    descartarProcesado();
    setActiveFilterId(null);
    setFrozenStore({});
    toast({ title: tr("Memoria de filtros limpia", "Filter memory cleared") });
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
        // Hasta v3.6.0 toda foto se achicaba a 2000 px. Desde v3.6.1 se
        // trabaja a la resolución real, como en el escritorio, con el tope del
        // celular (ver src/lib/resolucion.ts).
        setImageSize(tamanoDeTrabajo(img.naturalWidth, img.naturalHeight, fullRes));
        setImage(img);
        setImageSrc(e.target?.result as string);
        descartarProcesado();
        setActiveFilterId(null);
        setSelection(null);
        setSelectionTool(null);
        setFrozenStore({});
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, [stopLiveMode, fullRes]);

  // Cambiar la resolución de trabajo con una foto abierta la vuelve a su
  // estado inicial, como en el escritorio: un resultado calculado a otra escala
  // ya no corresponde, y la zona marcada se pierde con él.
  const cambiarResolucion = (completa: boolean) => {
    if (completa === fullRes) return;
    setFullRes(completa);
    if (!image) return;
    setImageSize(tamanoDeTrabajo(image.naturalWidth, image.naturalHeight, completa));
    descartarProcesado();
    setActiveFilterId(null);
    setSelection(null);
    setSelectionTool(null);
    setFrozenStore({});
  };

  // Capturar: el cuadro actual (ya limpio de ruido si la reducción está
  // activa) pasa a la vista de foto y se procesa con el motor de referencia,
  // el mismo del escritorio. Desde ahí se puede marcar zona, acumular,
  // descargar y armar el reporte.
  const capturarEnVivo = async () => {
    if (isCapturing) return;
    const img = liveViewerRef.current?.capture();
    if (!img) {
      toast({ title: tr("Todavía no hay imagen para capturar", "There is no image to capture yet"), variant: "destructive" });
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
      const equipo = `${tr("Video en vivo", "Live video")} · ${img.width}×${img.height}` + (legible ? ` · ${etiqueta}` : '');
      await handleFile(new File([blob], nombre, { type: 'image/png' }), { filtro: activeFilterId, enVivo: { fecha: ahora, equipo } });
    } catch (err) {
      console.error(err);
      toast({ title: tr("No se pudo capturar el cuadro", "Could not capture the frame"), variant: "destructive" });
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
        if (!ctx) throw new Error("Sin contexto 2D");
        canvas.width = imageSize.w;
        canvas.height = imageSize.h;

        let sourceData: ImageData;
        if (isStacking && filteredImageData) {
          ctx.putImageData(filteredImageData, 0, 0);
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
        // también acá codificaba la imagen dos veces por cada pasada. El aviso
        // de "Analizando" lo levanta ese efecto cuando la imagen ya está lista:
        // a resolución completa la codificación también tarda.
        setFilteredImageData(result);
      } catch (err) {
        console.error(err);
        // A resolución completa lo más probable es que no haya alcanzado la
        // memoria del equipo: el motor pide unos 52 bytes por píxel.
        const grande = Math.max(imageSize.w, imageSize.h) > LADO_REDUCIDO;
        toast({
          title: tr("Error de procesamiento", "Processing error"),
          description: grande ? tr("Puede faltar memoria para esta resolución. Probá con 2000 px.", "There may not be enough memory for this resolution. Try 2000 px.") : undefined,
          variant: "destructive",
        });
        setIsProcessing(false);
      }
    }, 50);
  }, [image, imageSize, isStacking, selection, filteredImageData, frozenStore, isLiveMode]);

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

  // La imagen procesada se codifica como PNG en un blob y no en una data URL:
  // toBlob no congela la pantalla mientras codifica (a resolución completa son
  // segundos en un celular) y el blob no duplica la imagen como texto base64.
  // Cada pasada lleva un número: si mientras codificaba llegó otro ajuste, otro
  // resultado u otra foto, su imagen ya no corresponde y se descarta.
  const applyPost = async (base: ImageData) => {
    const seq = ++postSeqRef.current;
    setAplicandoAjustes(true);
    let blob: Blob | null = null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = base.width;
      canvas.height = base.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Sin contexto 2D");
      ctx.putImageData(OPC.applyPostProcessing(base, contrast, saturation), 0, 0);
      blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/png"));
    } catch (err) {
      console.error(err);
    }
    if (seq !== postSeqRef.current || filteredRef.current !== base) return;
    if (blob) setProcessedSrc(URL.createObjectURL(blob));
    else toast({ title: trRef.current("No se pudo mostrar el resultado", "Could not display the result"), description: trRef.current("Probá con 2000 px.", "Try 2000 px."), variant: "destructive" });
    setAplicandoAjustes(false);
    setIsProcessing(false);
  };

  // Cada imagen procesada vive en un blob: al reemplazarla se suelta la
  // anterior, si no cada pasada dejaba retenida una copia en la memoria.
  useEffect(() => {
    const url = processedSrc;
    return () => { if (url?.startsWith("blob:")) URL.revokeObjectURL(url); };
  }, [processedSrc]);

  // El reporte lleva la imagen procesada a 2000 px como máximo: en la hoja
  // ocupa unos 8 cm, y jsPDF tarda mucho y agota la memoria del celular si
  // tiene que recomprimir un PNG de 12 megapíxeles. La imagen a resolución
  // completa se baja con Descargar.
  const imagenParaReporte = (): string | null => {
    if (!filteredImageData) return null;
    const completa = document.createElement("canvas");
    completa.width = filteredImageData.width;
    completa.height = filteredImageData.height;
    const c1 = completa.getContext("2d");
    if (!c1) return null;
    c1.putImageData(OPC.applyPostProcessing(filteredImageData, contrast, saturation), 0, 0);
    const { w, h } = tamanoDeTrabajo(completa.width, completa.height, false);
    if (w === completa.width && h === completa.height) return completa.toDataURL("image/png");
    const chica = document.createElement("canvas");
    chica.width = w;
    chica.height = h;
    const c2 = chica.getContext("2d");
    if (!c2) return null;
    c2.imageSmoothingQuality = "high";
    c2.drawImage(completa, 0, 0, w, h);
    return chica.toDataURL("image/png");
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

  // Un resultado nuevo del filtro se muestra enseguida; contraste y saturación
  // esperan a que el deslizador se aquiete un poco, si no cada paso dispararía
  // una codificación entera.
  const ultimoBaseRef = useRef<ImageData | null>(null);
  useEffect(() => {
    if (!filteredImageData || isLiveMode) return;
    const nuevo = ultimoBaseRef.current !== filteredImageData;
    ultimoBaseRef.current = filteredImageData;
    const t = setTimeout(() => applyPost(filteredImageData), nuevo ? 0 : 150);
    return () => clearTimeout(t);
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
    descartarProcesado();
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
  const captura = formatearCaptura(metadata?.date, lang);
  const equipo = [metadata?.make, metadata?.model].filter(Boolean).join(" ").trim();

  const copiarCoordenadas = async () => {
    if (!hayGPS) return;
    const texto = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    try {
      await navigator.clipboard.writeText(texto);
      toast({ title: tr("Coordenadas copiadas", "Coordinates copied"), description: texto });
    } catch {
      // Sin permiso de portapapeles el dato sigue estando a la vista.
      toast({ title: tr("No se pudo copiar", "Could not copy"), description: texto, variant: "destructive" });
    }
  };

  return (
    <IdiomaContext.Provider value={lang}>
    {/* Fondo y texto propios: el modo de campo redefine los colores en este
        div, y sin pintar su fondo quedaba el beige del body debajo de los
        textos blancos del modo oscuro. */}
    <div className={`min-h-screen flex flex-col font-body bg-background text-foreground ${isFieldMode ? 'field-mode' : ''}`}>
      {/* Alto fijo (h-16 = 4rem) porque el visor se ancla justo debajo con top-16. */}
      <header className="bg-primary text-primary-foreground h-16 px-4 sm:px-6 flex justify-between items-center gap-3 shadow-lg sticky top-0 z-50">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* El logo original, el mismo del ícono de la app instalada
              (public/icon-192.png, que sale de "logo opuntia-movil.png" con
              scripts/generar-iconos.py). Hasta v3.6.1 la cabecera llevaba otro
              dibujo, hecho a mano en SVG, que no era el logo. */}
          <img src={`${BASE}/icon-192.png`} alt="" className="w-9 h-9 rounded-[22%] shrink-0 shadow-md" />
          {/* Nombre y versión uno debajo del otro: en un renglón no entraban
              junto a los botones en un celular angosto. */}
          <div className="flex flex-col items-start leading-none min-w-0">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight">OpuntiaColor</h1>
            <span className="mt-1 bg-accent text-accent-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full">v{VERSION}</span>
          </div>
        </div>
        <div className="flex gap-1.5 sm:gap-2 shrink-0">
          {/* Los botones de la cabecera van transparentes y con el color de texto
              del tema: blancos sobre el fondo beige del botón no se leían, y
              text-white desaparecía en el modo de campo, que pone la cabecera
              blanca. */}
          {/* Muestra el idioma al que se pasa, como el botón del escritorio. */}
          <Button
            size="sm"
            variant="outline"
            className="bg-transparent border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground h-8 px-2 text-[11px] font-bold tracking-wider"
            onClick={cambiarIdioma}
            title={lang === 'es' ? "Switch the interface to English" : "Cambiar la interfaz al español"}
            aria-label={lang === 'es' ? "Switch the interface to English" : "Cambiar la interfaz al español"}
          >
            {lang === 'es' ? 'EN' : 'ES'}
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="bg-transparent border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground h-8 w-8 p-0" aria-label={tr("Información", "About")}>
                <Info className="w-4 h-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{tr(`OPC v${VERSION} — Motor de campo`, `OPC v${VERSION} — Field engine`)}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 text-sm py-4">
                {lang === 'es' ? (<>
                  <p>· <strong>Resolución completa</strong> — Las fotos se procesan a su tamaño real, como en el escritorio, hasta {TOPE_CELULAR} px de lado: más no entra en la memoria de un celular. Con 2000 px va más rápido y se reproduce el resultado de v3.6.0, que achicaba toda foto a ese tamaño.</p>
                  <p>· <strong>En vivo</strong> — Los doce filtros sobre la cámara, calculados en la GPU a la resolución que entregue (Full HD o 4K), con reducción de ruido, zoom, comparación con el original y pantalla completa, donde Ajustes da intensidad, contraste y saturación. Capturar pasa el cuadro al motor de referencia.</p>
                  <p>· <strong>Algoritmos precisos</strong> — Alineación científica con la referencia de escritorio v3.6.0: a la misma resolución, la salida de las fotos coincide byte a byte.</p>
                  <p>· <strong>Estadísticas por zona</strong> — Con una zona marcada, la decorrelación (CRGB, DS-LAB, LDS, YBK) se calcula con los datos de esa zona: mejor separación de pigmentos locales, como en DStretch.</p>
                  <p>· <strong>Modo PWA</strong> — Funcionamiento 100% offline tras la instalación.</p>
                </>) : (<>
                  <p>· <strong>Full resolution</strong> — Photos are processed at their real size, as in the desktop version, up to {TOPE_CELULAR} px per side: more than that does not fit in a phone’s memory. 2000 px is faster and reproduces the results of v3.6.0, which scaled every photo down to that size.</p>
                  <p>· <strong>Live</strong> — The twelve filters on the camera feed, computed on the GPU at whatever resolution the camera delivers (Full HD or 4K), with noise reduction, zoom, comparison with the original and full screen, where Adjust gives intensity, contrast and saturation. Capture sends the frame to the reference engine.</p>
                  <p>· <strong>Precise algorithms</strong> — Scientific alignment with the desktop reference v3.6.0: at the same resolution, photo output matches byte for byte.</p>
                  <p>· <strong>Per-area statistics</strong> — With an area selected, the decorrelation (CRGB, DS-LAB, LDS, YBK) is computed from that area’s data: better separation of local pigments, as in DStretch.</p>
                  <p>· <strong>PWA mode</strong> — Works 100% offline once installed.</p>
                </>)}
                {/* Aviso legal de la GPL: la licencia pide que una interfaz
                    interactiva muestre de dónde salió el programa, bajo qué
                    términos y que no tiene garantía. */}
                <p className="pt-4 border-t border-border text-[10px] opacity-70 text-center leading-relaxed">
                  {tr("Software libre bajo", "Free software under")}{" "}
                  <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noreferrer" className="underline">GPL-3.0-or-later</a>
                  {tr(", sin garantía de ningún tipo. Código fuente en", ", with no warranty of any kind. Source code at")}{" "}
                  <a href="https://github.com/emilios81/opuntia-movil" target="_blank" rel="noreferrer" className="underline">github.com/emilios81/opuntia-movil</a>.
                </p>
                <div className="text-[10px] opacity-70 italic text-center">
                  Dr. Emilio A. Villafañez · LATDAA · Fund. Félix de Azara · Universidad Nacional de Catamarca (UNCA), Argentina
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="outline" className="bg-transparent border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground h-8 w-8 p-0" onClick={() => setIsFieldMode(!isFieldMode)} aria-label={tr("Modo de campo (alto contraste)", "Field mode (high contrast)")}>
            {isFieldMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
          {processedSrc && !isLiveMode && (
            <Button size="sm" className="bg-accent hover:bg-accent/90 text-accent-foreground border-none h-8 px-2.5 sm:px-3" onClick={() => {
              const procesada = imagenParaReporte();
              if (procesada) generateReport(imageSrc!, procesada, metadata!, nombreFiltro(activeFilterId), intensity, imageSize.w, imageSize.h);
            }}>
              {/* En el celular dice PDF: "Reporte" no entraba junto a los otros botones. */}
              <FileText className="w-3 h-3 mr-1.5 sm:mr-2" /><span className="sm:hidden">PDF</span><span className="hidden sm:inline">{tr("Reporte", "Report")}</span>
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
                <p className="text-sm font-bold uppercase tracking-widest">OpuntiaColor v{VERSION}</p>
                <p className="text-[10px] opacity-60">{tr("Subí una imagen o abrí la cámara en vivo", "Upload an image or open the live camera")}</p>
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
                      filterLabel={nombreFiltro(activeFilterId)}
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
                      onEngineError={(m) => toast({ title: trRef.current("Motor en vivo", "Live engine"), description: m, variant: "destructive" })}
                    >
                      {!liveImmersive ? (
                        <>
                          <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 pointer-events-none">
                            <EstadoEnVivo pausado={livePaused} />
                            {liveLock && (
                              <div className="bg-black/60 text-white text-[9px] font-bold px-2 py-1 rounded-full flex items-center gap-1 border border-white/20">
                                <Lock className="w-3 h-3" /> {tr("COLORES FIJOS", "COLORS LOCKED")}
                              </div>
                            )}
                          </div>
                          {/* Como en una app de cámara: pausa y captura a la
                              izquierda, vistas a la derecha. Así la barra de
                              abajo no se encima en un celular angosto. */}
                          <div className="absolute bottom-3 left-3 z-20 flex gap-2">
                            <BotonVisor activo={livePaused} onClick={() => setLivePaused(p => !p)} titulo={livePaused ? tr("Seguir", "Resume") : tr("Pausar", "Pause")}>
                              {livePaused ? <Play className="w-4 h-4 ml-0.5" /> : <Pause className="w-4 h-4" />}
                            </BotonVisor>
                            <BotonVisor onClick={capturarEnVivo} titulo={tr("Capturar este cuadro", "Capture this frame")}>
                              <Aperture className={cn("w-4 h-4", isCapturing && "animate-spin")} />
                            </BotonVisor>
                          </div>
                          <div className="absolute bottom-3 right-3 z-20 flex gap-2">
                            <BotonVisor activo={liveCompare} onClick={() => setLiveCompare(c => !c)} titulo={tr("Comparar con el original", "Compare with the original")}>
                              <Columns2 className="w-4 h-4" />
                            </BotonVisor>
                            <BotonVisor onClick={entrarPantallaCompleta} titulo={tr("Pantalla completa", "Full screen")}>
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
                                    <Lock className="w-3 h-3" /> {tr("COLORES FIJOS", "COLORS LOCKED")}
                                  </div>
                                )}
                              </div>
                              {liveInfo.width > 0 && (
                                <span className="text-[10px] font-code text-white/80 bg-black/40 px-2 py-0.5 rounded">
                                  {liveInfo.width}&times;{liveInfo.height} &middot; {Math.round(liveInfo.fps)} fps{liveInfo.engine === 'cpu' ? ' · CPU' : ''}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={salirPantallaCompleta}
                              className="pointer-events-auto w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center border border-white/25 shadow-lg"
                              title={tr("Salir de pantalla completa", "Exit full screen")}
                              aria-label={tr("Salir de pantalla completa", "Exit full screen")}
                            >
                              <Minimize className="w-5 h-5" />
                            </button>
                          </div>
                          <div
                            className="absolute bottom-0 inset-x-0 z-30 px-3 pt-10 space-y-3 bg-gradient-to-t from-black/85 via-black/60 to-transparent"
                            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
                          >
                            {/* Ajustes va al costado, apoyado sobre la barra: en la
                                fila de abajo ya no entra otro botón sin achicarlos a
                                todos. Abre intensidad, contraste y saturación en el
                                lugar de la tira de filtros, así no tapa más imagen
                                que la que ya tapa la barra. Desde v3.6.2 la
                                intensidad también vive solo ahí: la pantalla queda
                                limpia hasta que se la llama. Sin filtro no hay nada
                                que ajustar: la cámara va tal cual. */}
                            {activeFilterId && (
                              <div className="absolute right-3 -top-5">
                                <BotonRedondo activo={liveAjustes} onClick={() => setLiveAjustes(a => !a)} etiqueta={tr("Ajustes", "Adjust")}>
                                  <SlidersHorizontal className="w-5 h-5" />
                                </BotonRedondo>
                              </div>
                            )}
                            {activeFilterId && liveAjustes ? (
                              <div className="space-y-2.5">
                                <FilaAjuste etiqueta={tr("Intensidad", "Intensity")} valor={`${intensity.toFixed(1)}×`}>
                                  <Slider sobreOscuro value={[intensity]} onValueChange={v => setIntensity(v[0])} min={0.2} max={5.0} step={0.1} className="flex-1" />
                                </FilaAjuste>
                                <FilaAjuste etiqueta={tr("Contraste", "Contrast")} valor={(contrast > 0 ? "+" : "") + contrast}>
                                  <Slider sobreOscuro value={[contrast]} onValueChange={v => setContrast(v[0])} min={-80} max={80} step={5} className="flex-1" />
                                </FilaAjuste>
                                <FilaAjuste etiqueta={tr("Saturación", "Saturation")} valor={(saturation > 0 ? "+" : "") + saturation}>
                                  <Slider sobreOscuro value={[saturation]} onValueChange={v => setSaturation(v[0])} min={-100} max={100} step={5} className="flex-1" />
                                </FilaAjuste>
                              </div>
                            ) : (
                              <div ref={tiraRef} className="flex gap-1.5 overflow-x-auto -mx-3 px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                {[{ id: null as string | null, name: 'Original', nameEn: 'Original', icon: '◻' }, ...FILTERS].map(f => (
                                  <button
                                    key={f.id ?? 'original'}
                                    data-activo={activeFilterId === f.id}
                                    onClick={() => setActiveFilterId(f.id)}
                                    className={cn(
                                      "shrink-0 flex items-center gap-1.5 pl-2 pr-3 h-9 rounded-full border text-[11px] font-bold whitespace-nowrap transition-colors",
                                      activeFilterId === f.id ? "bg-white text-black border-white" : "bg-black/50 text-white border-white/25"
                                    )}
                                  >
                                    <span className="text-sm leading-none">{f.icon}</span>{tr(f.name, f.nameEn)}
                                  </button>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center justify-between px-1">
                              <BotonRedondo activo={liveCompare} onClick={() => setLiveCompare(c => !c)} etiqueta={tr("Comparar", "Compare")}>
                                <Columns2 className="w-5 h-5" />
                              </BotonRedondo>
                              <BotonRedondo activo={liveLock} onClick={() => setLiveLock(l => !l)} etiqueta={liveLock ? tr("Colores fijos", "Colors locked") : tr("Fijar colores", "Lock colors")}>
                                {liveLock ? <Lock className="w-5 h-5" /> : <LockOpen className="w-5 h-5" />}
                              </BotonRedondo>
                              <button
                                onClick={() => setLivePaused(p => !p)}
                                className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-xl border-4 border-white/40"
                                title={livePaused ? tr("Seguir", "Resume") : tr("Pausar", "Pause")}
                                aria-label={livePaused ? tr("Seguir", "Resume") : tr("Pausar", "Pause")}
                              >
                                {livePaused ? <Play className="w-7 h-7 ml-0.5" /> : <Pause className="w-7 h-7" />}
                              </button>
                              <BotonRedondo onClick={capturarEnVivo} etiqueta={tr("Capturar", "Capture")} deshabilitado={isCapturing}>
                                <Aperture className={cn("w-5 h-5", isCapturing && "animate-spin")} />
                              </BotonRedondo>
                              {torch.disponible ? (
                                <BotonRedondo activo={torch.encendida} onClick={alternarLinterna} etiqueta={tr("Linterna", "Flashlight")}>
                                  {torch.encendida ? <Flashlight className="w-5 h-5" /> : <FlashlightOff className="w-5 h-5" />}
                                </BotonRedondo>
                              ) : (
                                <BotonRedondo onClick={stopLiveMode} etiqueta={tr("Detener", "Stop")}>
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
                      filterLabel={nombreFiltro(activeFilterId)}
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
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 bg-accent text-accent-foreground text-[10px] font-bold px-3 py-1 rounded-full shadow-lg pointer-events-none whitespace-nowrap">
                      {tr("Dibujá la zona", "Draw the area")} · {(() => { const t = SELECTION_TOOLS.find(x => x.id === selectionTool); return t ? tr(t.name, t.nameEn) : ''; })()}
                    </div>
                  )}
                  {/* A resolución completa, codificar un contraste o una
                      saturación nuevos lleva un momento: que no parezca que el
                      deslizador no hizo nada. */}
                  {aplicandoAjustes && !isProcessing && !isLiveMode && (
                    <div className="absolute top-3 right-3 z-40 bg-black/60 text-white text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-lg pointer-events-none">
                      <RefreshCw className="w-3 h-3 animate-spin" /> {tr("Aplicando", "Applying")}
                    </div>
                  )}
                  {isProcessing && (
                    <div className="absolute inset-0 bg-background/60 backdrop-blur-sm z-50 flex items-center justify-center rounded-xl">
                      <div className="bg-white text-black px-5 py-3 rounded-full shadow-xl flex items-center gap-3 border border-border">
                        <RefreshCw className="w-4 h-4 animate-spin text-accent" />
                        <span className="text-xs font-bold uppercase tracking-wider">{tr("Analizando pigmentos...", "Analyzing pigments...")}</span>
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
                    <span className="hidden sm:flex items-center gap-1"><Zap className="w-3 h-3 text-accent" /> {tr("Motor", "Engine")} v{VERSION}</span>
                    {isStacking && processedSrc && <span className="flex items-center gap-1 text-accent font-bold animate-pulse"><StackingIcon className="w-3 h-3" /> {tr("ACUMULANDO", "STACKING")}</span>}
                  </div>
                  {(processedSrc || isLiveMode) && (
                    <div className="flex gap-1.5 shrink-0">
                      {isLiveMode && (
                        <Button size="sm" variant="destructive" className="h-7 px-2.5 text-[10px] font-bold" onClick={stopLiveMode}><X className="w-3 h-3 mr-1" /> {tr("Detener", "Stop")}</Button>
                      )}
                      {!isLiveMode && processedSrc && (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 text-[10px] text-destructive hover:bg-destructive/10" onClick={handleClearStack}><Trash2 className="w-3 h-3 mr-1" /> {tr("Limpiar", "Clear")}</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-[10px] hover:bg-accent/10" onClick={() => {
                            const link = document.createElement('a');
                            link.href = processedSrc || "";
                            link.download = `${fileName.split('.')[0]}_OPC_${activeFilterId}.png`;
                            link.click();
                          }}><Download className="w-3 h-3 mr-1" /> {tr("Descargar", "Download")}</Button>
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
                <h3 className="text-lg font-bold">{tr("Captura e inspección", "Capture and inspection")}</h3>
                <p className="text-xs text-muted-foreground">{tr("Recorré el panel con la cámara en vivo, o subí una foto para analizarla en detalle.", "Sweep the panel with the live camera, or upload a photo to analyze it in detail.")}</p>
              </div>
              <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => e.target.files && handleFile(e.target.files[0])} accept="image/*" />
              <input type="file" ref={cameraInputRef} className="hidden" onChange={(e) => e.target.files && handleFile(e.target.files[0])} accept="image/*" capture="environment" />
              <div className="grid grid-cols-1 gap-3 w-full">
                <Button onClick={startLiveMode} className="w-full h-12 bg-accent hover:bg-accent/90 text-accent-foreground font-bold shadow-lg transform transition-transform active:scale-95"><Video className="w-4 h-4 mr-2" /> {tr("EN VIVO", "LIVE")}</Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => cameraInputRef.current?.click()} className="w-full h-10 shadow-sm"><Camera className="w-4 h-4 mr-2" /> {tr("Foto", "Photo")}</Button>
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full h-10 shadow-sm"><Upload className="w-4 h-4 mr-2" /> {tr("Archivo", "File")}</Button>
                </div>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="w-full h-10 border-accent text-accent hover:bg-accent hover:text-accent-foreground font-bold shadow-sm" onClick={isLiveMode ? stopLiveMode : startLiveMode}>
                  {isLiveMode ? <><X className="w-4 h-4 mr-2" /> {tr("Detener", "Stop")}</> : <><Video className="w-4 h-4 mr-2" /> {tr("En vivo", "Live")}</>}
                </Button>
                <Button variant="outline" className="w-full h-10 border-accent text-accent hover:bg-accent hover:text-accent-foreground font-bold shadow-sm" onClick={handleReset}><PlusCircle className="w-4 h-4 mr-2" /> {tr("Nuevo", "New")}</Button>
              </div>

              {/* Solo si la foto pasa de 2000 px: si no, las dos opciones dan lo mismo. */}
              {!isLiveMode && image && Math.max(image.naturalWidth, image.naturalHeight) > LADO_REDUCIDO && (
                <ResolucionDeTrabajo
                  completa={fullRes}
                  natW={image.naturalWidth}
                  natH={image.naturalHeight}
                  w={imageSize.w}
                  h={imageSize.h}
                  onCambiar={cambiarResolucion}
                />
              )}

              {isLiveMode && (
                <Card className="p-4 space-y-3 shadow-inner bg-muted/10 border-border">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">{tr("Calidad en vivo", "Live quality")}</label>
                    {liveInfo.width > 0 && (
                      <span className="text-[10px] font-code font-bold bg-accent/10 text-accent px-2 py-0.5 rounded border border-accent/20">
                        {liveInfo.width}&times;{liveInfo.height}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {LIVE_TIERS.map(t => (
                      <button
                        key={t.id}
                        onClick={() => cambiarCalidad(t.id)}
                        className={cn(
                          "flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg border font-bold transition-all",
                          liveTier === t.id
                            ? "bg-accent border-accent text-accent-foreground shadow-sm"
                            : "bg-card border-border text-muted-foreground hover:bg-muted"
                        )}
                      >
                        <span className="text-[11px]">{t.label}</span>
                        <span className="text-[9px] font-normal opacity-70">{t.detalle}</span>
                      </button>
                    ))}
                  </div>
                  {liveInfo.camW > 0 && (
                    <dl className="text-[10px] font-code text-muted-foreground border-t border-border pt-2 space-y-1">
                      <div className="flex justify-between gap-3">
                        <dt>{tr("Cámara entrega", "Camera delivers")}</dt>
                        <dd className="font-bold">{liveInfo.camW}&times;{liveInfo.camH}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt>{tr("Procesa", "Processing")}</dt>
                        <dd className="font-bold">
                          {liveInfo.engine === 'gpu' ? tr('GPU · resolución completa', 'GPU · full resolution') : tr('CPU · reducida', 'CPU · reduced')} &middot; {Math.round(liveInfo.fps)} fps
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
                      <p className={cn(AYUDA, "text-accent font-bold")}>
                        {tr(`Tu cámara no entrega ${pedido.label} por esta vía: lo máximo que da es ${liveInfo.camW}×${liveInfo.camH}, y se trabaja a eso.`,
                            `Your camera does not deliver ${pedido.label} this way: the most it gives is ${liveInfo.camW}×${liveInfo.camH}, and that is what is used.`)}
                      </p>
                    ) : null;
                  })()}
                  {liveInfo.engine === 'gpu' && liveInfo.fps > 0 && liveInfo.fps < 12 && liveTier === '4k' && !livePaused && (
                    <p className={cn(AYUDA, "text-accent font-bold")}>
                      {(() => {
                        const n = Math.round(liveInfo.fps);
                        return tr(`El video va a ${n} ${n === 1 ? 'cuadro' : 'cuadros'} por segundo. Si se entrecorta, bajá a Full HD: este equipo no da para más en 4K.`,
                                  `The video runs at ${n} ${n === 1 ? 'frame' : 'frames'} per second. If it stutters, switch to Full HD: this device cannot do more in 4K.`);
                      })()}
                    </p>
                  )}
                  {liveInfo.engine === 'cpu' && (
                    <p className={cn(AYUDA, "text-accent font-bold")}>
                      {tr(`Este equipo no ofrece procesamiento por GPU (WebGL2): el video se procesa en la CPU, achicado a ${CPU_LIVE_MAX_WIDTH} px, y sin zoom ni reducción de ruido.`,
                          `This device does not offer GPU processing (WebGL2): the video is processed on the CPU, scaled down to ${CPU_LIVE_MAX_WIDTH} px, with no zoom or noise reduction.`)}
                    </p>
                  )}
                  <p className={cn(AYUDA, "text-muted-foreground")}>
                    {lang === 'es'
                      ? <>La imagen en vivo se calcula en la GPU con los mismos filtros. Para el registro, <strong>Capturar</strong> pasa el cuadro a la vista de foto y lo procesa con el motor de referencia.</>
                      : <>The live image is computed on the GPU with the same filters. For the record, <strong>Capture</strong> sends the frame to the photo view and processes it with the reference engine.</>}
                  </p>
                </Card>
              )}

              {isLiveMode && (
                <Card className="p-4 space-y-4 shadow-inner bg-muted/10 border-border">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">{tr("Reducción de ruido", "Noise reduction")}</label>
                    <div className="grid grid-cols-3 gap-2">
                      {DENOISE_OPTIONS.map(o => (
                        <button
                          key={o.valor}
                          onClick={() => cambiarRuido(o.valor)}
                          disabled={liveInfo.engine === 'cpu'}
                          className={cn(
                            "py-1.5 rounded-lg border text-[10px] font-bold transition-all disabled:opacity-40",
                            liveDenoise === o.valor
                              ? "bg-accent border-accent text-accent-foreground shadow-sm"
                              : "bg-card border-border text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {tr(o.etiqueta, o.etiquetaEn)}
                        </button>
                      ))}
                    </div>
                    <p className={cn(AYUDA, "text-muted-foreground")}>
                      {tr("Promedia los últimos cuadros donde la imagen está quieta. La decorrelación amplifica el granulado de color del sensor: con el equipo firme o apoyado, Media lo baja a menos de la mitad y Alta a la cuarta parte. Al mover la cámara, Alta deja una estela breve en los detalles tenues.",
                          "Averages the latest frames wherever the image is still. Decorrelation amplifies the sensor’s color grain: with the device steady or resting on something, Medium cuts it to less than half and High to a quarter. When the camera moves, High leaves a brief trail on faint details.")}
                    </p>
                  </div>
                  <div className="space-y-2 pt-3 border-t border-border">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="fijar-colores" className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest cursor-pointer">
                        {tr("Fijar colores", "Lock colors")}
                      </Label>
                      <Switch id="fijar-colores" checked={liveLock} onCheckedChange={setLiveLock} />
                    </div>
                    <p className={cn(AYUDA, "text-muted-foreground")}>
                      {liveLock
                        ? tr("Las estadísticas de la decorrelación quedan congeladas: el mismo pigmento conserva su color aunque muevas la cámara.",
                             "The decorrelation statistics are frozen: the same pigment keeps its color even when you move the camera.")
                        : tr("Apuntá a una zona representativa del panel y fijá: los colores dejan de cambiar con cada encuadre.",
                             "Point at a representative area of the panel and lock: colors stop changing with every framing.")}
                    </p>
                  </div>
                  {torch.disponible && (
                    <div className="flex items-center justify-between gap-3 pt-3 border-t border-border">
                      <Label htmlFor="linterna" className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest cursor-pointer">
                        {tr("Linterna", "Flashlight")}
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
                      activeFilterId === null ? "bg-accent text-accent-foreground shadow-md ring-2 ring-accent/20" : "hover:bg-muted bg-transparent text-foreground"
                    )}
                  >
                    <span className="text-base bg-background/10 w-10 h-10 flex items-center justify-center rounded-xl shadow-sm">◻</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold truncate leading-tight uppercase tracking-tighter">Original</p>
                      <p className={cn("text-[10px] truncate opacity-60 font-medium", activeFilterId === null ? "text-accent-foreground" : "text-muted-foreground")}>{tr("La cámara sin filtro, para encuadrar", "The camera without a filter, for framing")}</p>
                    </div>
                  </button>
                )}
                {FILTERS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => isLiveMode ? setActiveFilterId(f.id) : runFilter(f.id, intensity)}
                    className={cn(
                      "w-full flex items-center gap-2 p-3 rounded-xl transition-all text-left",
                      activeFilterId === f.id ? "bg-accent text-accent-foreground shadow-md ring-2 ring-accent/20" : "hover:bg-muted bg-transparent text-foreground"
                    )}
                  >
                    <span className="text-base bg-background/10 w-10 h-10 flex items-center justify-center rounded-xl shadow-sm">{f.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold truncate leading-tight uppercase tracking-tighter">{tr(f.name, f.nameEn)}</p>
                      <p className={cn("text-[10px] truncate opacity-60 font-medium", activeFilterId === f.id ? "text-accent-foreground" : "text-muted-foreground")}>{tr(f.desc, f.descEn)}</p>
                    </div>
                  </button>
                ))}
              </Card>

              {/* Zona y acumulación no tienen sentido sobre el video en vivo:
                  ahí cada cuadro se procesa entero y de cero. */}
              {!isLiveMode && (
                <Card className="p-4 space-y-3 shadow-inner bg-muted/10 border-border">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">{tr("Selección", "Selection")}</label>
                    {(selection || selectionTool) && (
                      <button
                        onClick={clearSelection}
                        className="flex items-center gap-1 text-[10px] font-bold text-destructive hover:bg-destructive/10 px-2 py-0.5 rounded transition-colors"
                      >
                        <X className="w-3 h-3" /> {tr("Quitar", "Remove")}
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
                            ? "bg-accent border-accent text-accent-foreground shadow-sm"
                            : "bg-card border-border text-muted-foreground hover:bg-muted"
                        )}
                      >
                        <t.Icon className="w-4 h-4" />
                        <span className="text-[9px] leading-none text-center">{tr(t.name, t.nameEn)}</span>
                      </button>
                    ))}
                  </div>
                  <p className={cn(AYUDA, "text-muted-foreground")}>
                    {selectionTool
                      ? tr("Arrastrá sobre la imagen para marcar la zona. Al soltar se aplica el filtro.",
                           "Drag over the image to mark the area. The filter is applied when you let go.")
                      : selection
                      ? tr("Zona marcada: el filtro —y las estadísticas de decorrelación— se calculan solo ahí.",
                           "Area marked: the filter —and the decorrelation statistics— are computed only there.")
                      : tr("Sin zona: el filtro va sobre toda la imagen.", "No area: the filter covers the whole image.")}
                  </p>
                </Card>
              )}

              {!isLiveMode && (
                <Card className="p-4 space-y-3 shadow-inner bg-muted/10 border-border">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="acumular" className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest cursor-pointer">
                      {tr("Acumular filtros", "Stack filters")}
                    </Label>
                    <Switch id="acumular" checked={isStacking} onCheckedChange={setIsStacking} />
                  </div>
                  <p className={cn(AYUDA, "text-muted-foreground")}>
                    {isStacking
                      ? tr("Cada filtro se aplica sobre el resultado anterior. La intensidad deja de reaplicarse sola: elegí el valor y volvé a tocar el filtro.",
                           "Each filter is applied on top of the previous result. Intensity no longer reapplies by itself: choose the value and tap the filter again.")
                      : tr("Cada filtro parte siempre de la imagen original.", "Each filter always starts from the original image.")}
                  </p>
                </Card>
              )}

              {!isLiveMode && metadata && (
                <Card className="p-4 space-y-3 shadow-inner bg-muted/10 border-border">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">{tr("Metadatos de la foto", "Photo metadata")}</label>
                    {hayGPS && (
                      <button
                        onClick={copiarCoordenadas}
                        className="flex items-center gap-1 text-[10px] font-bold text-accent hover:bg-accent/10 px-2 py-0.5 rounded transition-colors"
                      >
                        <Copy className="w-3 h-3" /> {tr("Copiar", "Copy")}
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
                          <p className="font-code text-[10px] text-muted-foreground">{Math.round(altitud)} {tr("m s. n. m.", "m a.s.l.")}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-0.5" />
                      <p className={cn(AYUDA, "text-muted-foreground")}>
                        {origenEnVivo
                          ? tr("Cuadro capturado en vivo: el video de la cámara no lleva coordenadas. Para dejar el sitio registrado, sacá también una Foto.",
                               "Frame captured live: camera video carries no coordinates. To record the site, take a Photo as well.")
                          : tr("La foto no trae coordenadas. Suele pasar con el GPS de la cámara apagado, o si el archivo pasó por una app de mensajería que borra los metadatos.",
                               "The photo has no coordinates. This usually happens with the camera’s GPS off, or when the file went through a messaging app that strips metadata.")}
                      </p>
                    </div>
                  )}
                  <dl className="text-[10px] font-code space-y-1 border-t border-border pt-2">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground shrink-0">{tr("Captura", "Captured")}</dt>
                      <dd className="text-right truncate">{captura ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground shrink-0">{tr("Equipo", "Device")}</dt>
                      <dd className="text-right truncate">{equipo || "—"}</dd>
                    </div>
                  </dl>
                </Card>
              )}

              {activeFilterId && (
                <Card className="p-4 space-y-5 shadow-inner bg-muted/10 border-border">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">{tr("Intensidad", "Intensity")}</label>
                      <span className="text-[10px] font-code font-bold bg-accent/10 text-accent px-2 py-0.5 rounded border border-accent/20">{intensity.toFixed(1)}x</span>
                    </div>
                    <Slider value={[intensity]} onValueChange={v => setIntensity(v[0])} min={0.2} max={5.0} step={0.1} className="py-2" />
                    <div className="flex flex-wrap gap-1 justify-between">
                      {PRESETS.map(p => (
                        <button key={p.label} onClick={() => setIntensity(p.value)} className={cn("text-[10px] px-2 py-1 rounded-md border font-bold transition-all", intensity === p.value ? "bg-accent border-accent text-accent-foreground shadow-sm scale-105" : "bg-card border-border text-muted-foreground hover:bg-muted")}>{tr(p.label, p.labelEn)}</button>
                      ))}
                    </div>
                  </div>
                  <div className="pt-3 border-t border-border space-y-4">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">{tr("Contraste", "Contrast")}</label>
                        <span className="text-[10px] font-code font-bold opacity-70">{(contrast > 0 ? "+" : "") + contrast}</span>
                      </div>
                      <Slider value={[contrast]} onValueChange={v => setContrast(v[0])} min={-80} max={80} step={5} />
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">{tr("Saturación", "Saturation")}</label>
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
            <span className="opacity-60 font-code uppercase tracking-widest font-bold">OpuntiaColor v{VERSION}</span>
            <span className="bg-accent/10 text-accent px-2 py-0.5 rounded-full font-bold">OFFLINE READY</span>
          </div>
        </div>
      </footer>
    </div>
    </IdiomaContext.Provider>
  );
}
