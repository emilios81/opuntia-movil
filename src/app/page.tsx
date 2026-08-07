
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
  Sun,
  Moon,
  PlusCircle,
  RotateCcw,
  Infinity as StackingIcon,
  Trash2,
  Square,
  Circle as CircleIcon,
  Pencil,
  X,
  FileText,
  Info,
  Camera,
  Play
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

const PRESETS = [
  { label: "Sutil", value: 0.4 },
  { label: "Suave", value: 1.0 },
  { label: "Medio", value: 1.8 },
  { label: "Fuerte", value: 3.0 },
  { label: "Extremo", value: 4.5 },
];

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

  // Live Mode State
  const [isLiveMode, setIsLiveMode] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveRequestRef = useRef<number | null>(null);
  // El stream vive en un ref propio: hay que poder cortarlo aunque el <video>
  // ya esté desmontado, si no la cámara queda tomada.
  const liveStreamRef = useRef<MediaStream | null>(null);
  // Puntero siempre fresco al procesador de cuadro (ver más abajo).
  const liveFrameRef = useRef<() => void>(() => {});
  // Ancho al que se procesa cada cuadro en vivo. El costo crece con el
  // cuadrado: 720 son 2,2 veces más píxeles que 480, así que en equipos
  // modestos conviene la opción baja.
  const [liveWidth, setLiveWidth] = useState(480);
  // Resolución efectiva de trabajo (el alto sale de la proporción de la
  // cámara). Se muestra en pantalla para poder consignarla al reportar.
  const [liveSize, setLiveSize] = useState({ w: 0, h: 0 });
  // Lo que entrega realmente la cámara. A getUserMedia se le piden 1280x720
  // como "ideal", que es una sugerencia: el equipo puede devolver menos.
  const [liveCapture, setLiveCapture] = useState({ w: 0, h: 0 });

  // Selection state
  const [selectionTool, setSelectionTool] = useState<SelectionType>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  
  // Stacking pipeline
  const [frozenStore, setFrozenStore] = useState<any>({});
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const stopLiveMode = useCallback(() => {
    if (liveRequestRef.current) {
      cancelAnimationFrame(liveRequestRef.current);
      liveRequestRef.current = null;
    }

    if (liveStreamRef.current) {
      liveStreamRef.current.getTracks().forEach(track => track.stop());
      liveStreamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;

    setIsLiveMode(false);
    setImageSrc(null);
  }, []);

  const startLiveMode = async () => {
    if (isLiveMode) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ title: "Cámara no disponible", description: "El navegador no expone la cámara. Requiere HTTPS o localhost.", variant: "destructive" });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      // El <video> recién se monta cuando isLiveMode pasa a true, así que acá
      // videoRef.current TODAVÍA es null: guardamos el stream y lo conecta el
      // efecto de abajo. Conectarlo acá dejaba la cámara tomada y sin imagen.
      liveStreamRef.current = stream;
      setProcessedSrc(null);
      setImageSrc("LIVE_STREAM");
      setActiveFilterId(prev => prev ?? "crgb");
      setIsLiveMode(true);
    } catch (err) {
      console.error("Error al iniciar modo Live:", err);
      const name = (err as DOMException)?.name;
      toast({
        title: "Error de cámara",
        description: name === "NotAllowedError"
          ? "Permiso denegado. Habilitá la cámara para este sitio."
          : name === "NotFoundError"
          ? "No se encontró ninguna cámara."
          : "No se pudo abrir la cámara.",
        variant: "destructive"
      });
    }
  };

  // Conecta el stream una vez que el elemento <video> existe en el DOM.
  useEffect(() => {
    if (!isLiveMode) return;
    const video = videoRef.current;
    const stream = liveStreamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    // play() explícito: en Android autoPlay solo no siempre alcanza.
    video.play().catch(err => {
      console.error("No se pudo reproducir el video:", err);
      toast({ title: "Error de cámara", description: "El navegador bloqueó la reproducción del video.", variant: "destructive" });
    });
  }, [isLiveMode]);

  const processLiveFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = liveCanvasRef.current;

    if (!isLiveMode || !video || !canvas) {
      liveRequestRef.current = null;
      return;
    }

    // Se reagenda SIEMPRE antes de procesar: si el bucle se cortara mientras el
    // video todavía no está listo, no vuelve a arrancar solo.
    liveRequestRef.current = requestAnimationFrame(() => liveFrameRef.current());

    if (video.readyState < 2 || video.videoWidth === 0) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    if (liveCapture.w !== video.videoWidth || liveCapture.h !== video.videoHeight) {
      setLiveCapture({ w: video.videoWidth, h: video.videoHeight });
    }

    // Resolución de trabajo elegida por el usuario, pero nunca por encima de
    // lo que la cámara entrega: ampliar no inventa detalle, solo cuesta el
    // doble de cálculo por cuadro. El alto sale de la proporción real.
    const targetWidth = Math.min(liveWidth, video.videoWidth);
    const targetHeight = Math.round((video.videoHeight / video.videoWidth) * targetWidth);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      // Solo al cambiar el tamaño, no en cada cuadro.
      setLiveSize({ w: targetWidth, h: targetHeight });
    }

    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
    const sourceData = ctx.getImageData(0, 0, targetWidth, targetHeight);

    const filter = FILTERS.find(f => f.id === activeFilterId);
    if (!filter) return;

    // En vivo las estadísticas se recalculan en cada cuadro. Congelarlas en el
    // primer cuadro ataría el realce a lo que la cámara veía al arrancar, y
    // además contaminaría el pipeline de la imagen estática.
    const result = filter.fn(sourceData, intensity, null, {});
    ctx.putImageData(OPC.applyPostProcessing(result, contrast, saturation), 0, 0);
  }, [isLiveMode, activeFilterId, intensity, contrast, saturation, liveWidth, liveCapture]);

  // El bucle se reagenda a través de este ref, no de la función capturada al
  // arrancar: si no, cambiar filtro o intensidad en vivo no tendría efecto.
  useEffect(() => { liveFrameRef.current = processLiveFrame; }, [processLiveFrame]);

  // Al salir de la pantalla se suelta la cámara sí o sí.
  useEffect(() => stopLiveMode, [stopLiveMode]);

  const handleVideoPlaying = () => {
    if (liveRequestRef.current === null) {
      liveRequestRef.current = requestAnimationFrame(() => liveFrameRef.current());
    }
  };

  const handleClearStack = () => {
    setProcessedSrc(null);
    setFilteredImageData(null);
    setActiveFilterId(null);
    setFrozenStore({});
    toast({ title: "Memoria de Filtros Limpia" });
  };

  const handleFile = useCallback(async (file: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    stopLiveMode();
    setFileName(file.name);
    const meta = await extractMetadata(file);
    setMetadata(meta);

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
        setFrozenStore({});
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, [stopLiveMode]);

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
      const p1 = sel.points[0], p2 = sel.points[1];
      const rx = Math.abs(p2.x - p1.x) * w, ry = Math.abs(p2.y - p1.y) * h;
      ctx.ellipse(p1.x * w, p1.y * h, rx, ry, 0, 0, Math.PI * 2);
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

  useEffect(() => {
    if (!activeFilterId || !image || isLiveMode || isStacking || isDrawing) return;
    const timer = setTimeout(() => runFilterRef.current(activeFilterId, intensity), 250);
    return () => clearTimeout(timer);
  }, [intensity, selection, isDrawing, image, isLiveMode, isStacking]);

  useEffect(() => {
    if (filteredImageData && !isLiveMode) applyPost(filteredImageData);
  }, [contrast, saturation, isLiveMode, filteredImageData]);

  const handleStartDraw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!selectionTool || !containerRef.current || !image || isLiveMode) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    setIsDrawing(true);
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
    const handleUp = () => setIsDrawing(false);
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
    setFrozenStore({});
  };

  return (
    <div className={`min-h-screen flex flex-col font-body ${isFieldMode ? 'field-mode' : ''}`}>
      {/* Alto fijo (h-16 = 4rem) porque el visor se ancla justo debajo con top-16. */}
      <header className="bg-primary text-primary-foreground h-16 px-4 sm:px-6 flex justify-between items-center shadow-lg sticky top-0 z-50">
        <div className="flex flex-col">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            OpuntiaColor <span className="bg-accent text-white text-[10px] px-1.5 py-0.5 rounded-full">v3.4.0</span>
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
                <DialogTitle>OPC v3.4.0 — Motor de Campo</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 text-sm py-4">
                <p>· <strong>Decorrelación en Vivo</strong> — Exploración espectral dinámica mediante cámara.</p>
                <p>· <strong>Algoritmos Precisos</strong> — Alineación científica total con la referencia v3.4.0.</p>
                <p>· <strong>Modo PWA</strong> — Funcionamiento 100% offline tras la instalación.</p>
                <div className="pt-4 border-t border-border text-[10px] opacity-70 italic text-center">
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
        <div className="lg:col-span-3 space-y-4 order-1 sticky top-16 z-30 -mx-4 px-4 -mt-4 pt-4 pb-2 bg-background lg:static lg:z-auto lg:mx-0 lg:px-0 lg:mt-0 lg:pt-0 lg:pb-0 lg:bg-transparent">
          <div className="bg-card border border-border rounded-2xl p-2 flex flex-col shadow-sm relative overflow-hidden">
            {!imageSrc ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground py-20">
                <FileImage className="w-16 h-16 opacity-10 mb-4" />
                <p className="text-sm font-bold uppercase tracking-widest">OpuntiaColor v3.4.0</p>
                <p className="text-[10px] opacity-60">Sube una imagen o inicia el Modo Live</p>
              </div>
            ) : (
              <>
                <div 
                  ref={containerRef}
                  className="relative mx-auto bg-black rounded-xl overflow-hidden shadow-2xl"
                  onMouseDown={handleStartDraw}
                  onTouchStart={handleStartDraw}
                  style={{
                    touchAction: (selectionTool && !isLiveMode) ? 'none' : 'auto',
                    width: '100%',
                    // El visor nunca pasa de --viewer-max-h. Con imagen fija se
                    // acota el ANCHO al que corresponde a ese alto, para que la
                    // caja conserve exactamente la proporción de la foto: de eso
                    // depende que la zona seleccionada caiga donde uno la dibuja.
                    ...(isLiveMode
                      ? { height: 'var(--viewer-max-h)' }
                      : {
                          aspectRatio: imageSize.w / imageSize.h,
                          maxWidth: `calc(var(--viewer-max-h) * ${imageSize.h ? imageSize.w / imageSize.h : 1})`,
                          maxHeight: 'var(--viewer-max-h)',
                        }),
                  }}
                >
                  {isLiveMode ? (
                    <div className="w-full h-full flex items-center justify-center relative bg-black">
                      {/* Video activo pero debajo del canvas */}
                      <video 
                        ref={videoRef} 
                        playsInline 
                        muted 
                        autoPlay
                        onPlaying={handleVideoPlaying}
                        style={{ 
                          position: 'absolute', 
                          top: 0, 
                          left: 0, 
                          width: '100%', 
                          height: '100%', 
                          opacity: 0.05, 
                          pointerEvents: 'none',
                          zIndex: 0,
                          objectFit: 'cover'
                        }}
                      />
                      <canvas 
                        ref={liveCanvasRef} 
                        className="w-full h-full object-contain relative z-10" 
                      />
                      <div className="absolute top-4 left-4 z-20 bg-accent text-white text-[10px] font-bold px-3 py-1 rounded-full animate-pulse flex items-center gap-2 shadow-lg">
                        <div className="w-2 h-2 bg-white rounded-full" /> MODO EXPLORACIÓN LIVE
                      </div>
                    </div>
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
                              cx={selection.points[0].x * 100}
                              cy={selection.points[0].y * 100}
                              rx={Math.abs(selection.points[1].x - selection.points[0].x) * 100}
                              ry={Math.abs(selection.points[1].y - selection.points[0].y) * 100}
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
                  <div className="flex items-center gap-3 text-[10px] font-code text-muted-foreground uppercase tracking-widest">
                    <span className="flex items-center gap-1">
                      <Maximize2 className="w-3 h-3" />
                      {isLiveMode
                        ? (liveSize.w ? `${liveSize.w} x ${liveSize.h} PX` : "—")
                        : `${imageSize.w} x ${imageSize.h} PX`}
                    </span>
                    <span className="hidden sm:flex items-center gap-1"><Zap className="w-3 h-3 text-accent" /> Motor v3.4.0</span>
                    {isStacking && processedSrc && <span className="flex items-center gap-1 text-accent font-bold animate-pulse"><StackingIcon className="w-3 h-3" /> STACK ACTIVO</span>}
                  </div>
                  {(processedSrc || isLiveMode) && (
                    <div className="flex gap-2">
                      {isLiveMode && <Button size="sm" variant="destructive" className="h-7 text-[10px] font-bold" onClick={stopLiveMode}><X className="w-3 h-3 mr-1" /> CERRAR LIVE</Button>}
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
                <p className="text-xs text-muted-foreground">Utiliza el Modo Live para exploración dinámica o sube una imagen estática.</p>
              </div>
              <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => e.target.files && handleFile(e.target.files[0])} accept="image/*" />
              <input type="file" ref={cameraInputRef} className="hidden" onChange={(e) => e.target.files && handleFile(e.target.files[0])} accept="image/*" capture="environment" />
              <div className="grid grid-cols-1 gap-3 w-full">
                <Button onClick={startLiveMode} className="w-full h-12 bg-accent hover:bg-accent/90 text-white font-bold shadow-lg transform transition-transform active:scale-95"><Play className="w-4 h-4 mr-2" /> MODO LIVE</Button>
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
                  {isLiveMode ? <><X className="w-4 h-4 mr-2" /> Detener</> : <><Play className="w-4 h-4 mr-2" /> Live</>}
                </Button>
                <Button variant="outline" className="w-full h-10 border-accent text-accent hover:bg-accent hover:text-white font-bold shadow-sm" onClick={handleReset}><PlusCircle className="w-4 h-4 mr-2" /> Nuevo</Button>
              </div>

              {isLiveMode && (
                <Card className="p-4 space-y-3 shadow-inner bg-muted/10 border-border">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Resolución en vivo</label>
                    {liveSize.w > 0 && (
                      <span className="text-[10px] font-code font-bold bg-accent/10 text-accent px-2 py-0.5 rounded border border-accent/20">
                        {liveSize.w}&times;{liveSize.h}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { valor: 480, etiqueta: 'Baja', detalle: '480 px · fluido' },
                      { valor: 720, etiqueta: 'HD 720', detalle: '720 px · más detalle' },
                    ].map(o => (
                      <button
                        key={o.valor}
                        onClick={() => setLiveWidth(o.valor)}
                        className={cn(
                          "flex flex-col items-center gap-0.5 py-2 px-2 rounded-lg border font-bold transition-all",
                          liveWidth === o.valor
                            ? "bg-accent border-accent text-white shadow-sm"
                            : "bg-card border-border text-muted-foreground hover:bg-muted"
                        )}
                      >
                        <span className="text-[11px]">{o.etiqueta}</span>
                        <span className="text-[8px] font-normal opacity-70">{o.detalle}</span>
                      </button>
                    ))}
                  </div>
                  {liveCapture.w > 0 && (
                    <div className="flex justify-between items-center text-[9px] font-code text-muted-foreground border-t border-border pt-2">
                      <span>C&aacute;mara entrega</span>
                      <span className="font-bold">{liveCapture.w}&times;{liveCapture.h}</span>
                    </div>
                  )}
                  {liveCapture.w > 0 && liveCapture.w < liveWidth && (
                    <p className="text-[9px] text-accent leading-snug font-bold">
                      Tu c&aacute;mara entrega {liveCapture.w} px de ancho, as&iacute; que HD no puede agregar
                      detalle: se trabaja a {liveCapture.w} px.
                    </p>
                  )}
                  <p className="text-[9px] text-muted-foreground leading-snug">
                    HD procesa 2,2 veces más p&iacute;xeles por cuadro. Si el video se entrecorta,
                    volv&eacute; a Baja: el Modo Live es para explorar &mdash; el detalle real sale de la foto.
                  </p>
                </Card>
              )}

              {/* En celular la lista se muestra entera y se recorre con el
                  desplazamiento de la página, con la cámara siempre a la vista. */}
              <Card className="bg-card shadow-lg border-border lg:overflow-y-auto lg:max-h-[400px] p-1 space-y-1 custom-scrollbar">
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
            <span className="opacity-60 font-code uppercase tracking-widest font-bold">OpuntiaColor v3.4.0</span>
            <span className="bg-accent/10 text-accent px-2 py-0.5 rounded-full font-bold">OFFLINE READY</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
