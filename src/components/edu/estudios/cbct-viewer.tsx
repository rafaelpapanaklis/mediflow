"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL VISOR CBCT DEL INSTITUTO — CONTENEDOR PROPIO, PIEZAS DEL DENTAL
 * IMPORTADAS TAL CUAL.
 *
 * Qué se IMPORTA del dental sin tocarlo (src/components/patient-3d/**):
 *   · MprPane            → cada plano 2D (axial/coronal/sagital), con cruz
 *                          sincronizada en mm, medición, sonda y paneo
 *   · Dicom3DVolume      → el render volumétrico three.js (y su barra de
 *                          Sólido/MIP, Hueso/Tejido/Aire y el UMBRAL)
 *   · PanoramicPane      → la PANORÁMICA reconstruida, con el trazado de
 *                          la arcada, el slab MIP/promedio y el arco en mm
 *   · arch-autodetect    → la detección automática de la curva del arco
 *   · panoramic-reslice  → el recorte curvo del volumen
 *   · dicom-decode-core  → la decodificación DICOM (decodeSlice)
 *   · dicom-decode.worker→ la misma decodificación FUERA del hilo (códecs)
 *   · cbct-mpr-shared    → la matemática: orden por geometría real, series
 *                          mezcladas, escala física, ventanas, percentiles
 *   · GeometryWarning    → el juicio "¿este estudio es de fiar?" y su aviso
 *   · @/lib/dicom-cache  → cache IndexedDB del .zip y de los cortes
 * Todas son PURAS (cero fetch propio, cero prisma, cero sesión): la
 * corrección de geometría que el dental pague mañana llega aquí sola. Las
 * tres de la panorámica entran por su anfitrión de tamaño
 * (src/components/edu/estudios/panoramica-pane.tsx), que NO traduce datos
 * —no hace falta— sino que reparte el alto de la celda.
 *
 * Por qué NO se importa `DicomSetViewer` (el contenedor del dental): sus
 * acoples no son props, son fetch INTERNOS con rutas escritas dentro —
 * `POST /api/patients/{id}/dicom-set/{id}/lite` (genera el CBCT reducido
 * de móvil contra `Patient`/`PatientFile` del dental) y
 * `PATCH /api/patients/{id}/models-3d/{id}` (guarda notas ahí mismo). Un
 * adaptador no puede redirigir un fetch interno: con ids del instituto
 * esas rutas contestan 401/404, el móvil quedaría en error y el botón de
 * notas rompería siempre. Es el mismo criterio que el odontograma de la
 * Ola 3: las piezas puras se importan, el CONTENEDOR es del vertical.
 *
 * ── LA REJILLA ─────────────────────────────────────────────────────────
 * Cinco vistas. Los CUATRO paneles de corte y volumen son CUADRADOS del
 * MISMO lado y caben SIEMPRE en la pantalla sin desplazar; la panorámica
 * va en su propia fila y de borde a borde, porque una panorámica es ancha
 * por naturaleza —un arco dental mide ~150 mm de largo por ~60 de alto— y
 * meterla en un cuadrado sería tirar media caja.
 *
 * 🔴 EL REPARTO SALE DE MEDIR, NO DE ADIVINAR. visor-medidas.ts prueba 1,
 * 2 y 4 columnas con el ancho y el alto REALES y se queda con el que hace
 * los paneles más grandes. Eso es lo que un corte fijo en el CSS no puede
 * hacer, y es justo el error que había: en una ventana de 1834×650, dos
 * filas de cuadrados topan en 321 px y dejan 855 px de monitor en negro;
 * una sola tira de cuatro llega a 448 px y usa el ancho entero. En una
 * tablet de pie, donde sobra alto y falta ancho, gana el 2×2.
 *
 * 🔴 CAMBIAR DE TAMAÑO NUNCA VUELVE A DECODIFICAR. El volumen —668 cortes,
 * 296 MB— vive en `slices`, y ese estado solo se llena en el efecto de
 * carga, cuyas dependencias son la clave del estudio y su URL. Girar el
 * iPad, maximizar un panel, entrar a pantalla completa o pasar de 2 a 4
 * columnas son CSS y números: ni un byte se vuelve a leer. Por eso, además,
 * maximizar OCULTA los demás paneles en vez de desmontarlos (si los
 * desmontara, volver atrás re-detectaría la arcada de cero) y por eso la
 * rama "compacto" se decide con el LADO MENOR de la ventana, que no cambia
 * al girar el aparato.
 *
 * 🔴 LO QUE ESTE CONTENEDOR SIGUE SIN TENER, y se dice en pantalla: el
 * binario "lite" de móvil (exige un generador de servidor que el instituto
 * no tiene). En un teléfono, un estudio grande NO se intenta —descomprimir
 * 300 MB recarga la pestaña en iOS sin avisar— y la pantalla ofrece la
 * descarga y lo dice claro. Las notas del estudio viven en
 * `EduStudy.notes` y se leen bajo el visor.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import JSZip from "jszip";
import {
  Box,
  Contrast as ContrastIcon,
  Crosshair,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Move,
  Pipette,
  RotateCcw,
  Ruler,
  Sun,
} from "lucide-react";
import { fetchWithCache, getDecodedSlices, putDecodedSlices } from "@/lib/dicom-cache";
import { decodeSlice, isDicomEntryName } from "@/components/patient-3d/dicom-decode-core";
import type { DecodeWorkerOut } from "@/components/patient-3d/dicom-decode.worker";
import type { VolSlice } from "@/components/patient-3d/Dicom3DVolume";
import MprPane from "@/components/patient-3d/MprPane";
import GeometryWarning, {
  geometryDoubtReason,
  GEOMETRY_DOUBT_DETAIL,
  type GeometryDoubtReason,
} from "@/components/patient-3d/GeometryWarning";
import {
  clampInt,
  computeVolStats,
  inferScale,
  isPhysicallyOrdered,
  keepDominantSeries,
  measureZSpacing,
  presetWindow,
  sameOrientation,
  sortSlicesForVolume,
  WINDOW_PRESETS,
  type Cross,
  type PlaneKey,
  type ScaleInfo,
  type Slice,
  type Tool,
  type WindowKey,
} from "@/components/patient-3d/cbct-mpr-shared";
import { EduPanoramica } from "@/components/edu/estudios/panoramica-pane";
import { useEduGestosPlano } from "@/components/edu/estudios/visor-gestos";
import {
  EDU_MEDIA_COMPACTO,
  EDU_MEDIA_TACTIL,
  EDU_PANEL_CHROME,
  useEduMedia,
  useEduMedidasRejilla,
} from "@/components/edu/estudios/visor-medidas";

// El volumen 3D trae su shader three.js: solo lo paga quien lo abre.
const Dicom3DVolume = dynamic(() => import("@/components/patient-3d/Dicom3DVolume"), {
  ssr: false,
  loading: () => (
    <div className="edu-visor3d-cargando" role="status">
      <Loader2 className="edu-girando" size={18} /> Preparando el volumen 3D…
    </div>
  ),
});

/** Las cinco vistas del estudio, en el orden en que se pintan. */
type VistaKey = PlaneKey | "volume" | "pano";

const PLANES: { key: PlaneKey; label: string }[] = [
  { key: "axial", label: "Axial" },
  { key: "coronal", label: "Coronal" },
  { key: "sagittal", label: "Sagital" },
];

const VISTAS: { key: VistaKey; label: string }[] = [
  { key: "axial", label: "Axial" },
  { key: "coronal", label: "Coronal" },
  { key: "sagittal", label: "Sagital" },
  { key: "volume", label: "3D" },
  { key: "pano", label: "Panorámica" },
];

const TODAS_LAS_VISTAS: VistaKey[] = VISTAS.map((v) => v.key);

const TOOLS: { key: Tool; label: string; icon: typeof Move }[] = [
  { key: "crosshair", label: "Cruz", icon: Crosshair },
  { key: "pan", label: "Mover", icon: Move },
  { key: "measure", label: "Medir", icon: Ruler },
  { key: "probe", label: "Sonda", icon: Pipette },
];

/** Lado de respaldo mientras el ResizeObserver no ha medido (primer
 *  pintado). Evita mandarle un alto negativo a MprPane. */
const EDU_LADO_FALLBACK = 400;
const EDU_ALTO_FALLBACK = 520;

/**
 * En un teléfono NO se intenta un .zip por encima de esto. El estudio se
 * descomprime a rasters Int16 EN MEMORIA (un 512³ son ~270 MB) y
 * iOS/WebKit recarga la pestaña sin avisar al pasarse. El dental lo
 * resuelve con un binario reducido que genera SU servidor; el instituto no
 * tiene ese generador todavía, así que aquí se es honesto: se ofrece la
 * descarga y se dice por qué.
 */
const EDU_CBCT_MOVIL_MAX_BYTES = 32 * 1024 * 1024;

/**
 * ¿Aparato de poca RAM (móvil/tablet)? Heurística defensiva: nunca lanza.
 *
 * 🔴 ESTO SIGUE MIRANDO EL USER-AGENT A PROPÓSITO, y es lo ÚNICO que lo
 * mira. La pregunta que contesta no es "¿qué tan grande es la pantalla?"
 * —esa se contesta midiendo la ventana, en visor-medidas.ts— sino "¿cuánta
 * memoria puedo pedirle a este aparato antes de que el navegador recargue
 * la pestaña?", que es una propiedad del hardware y no del vidrio. De aquí
 * salen dos cosas y ninguna es el tamaño de nada: el freno del estudio
 * pesado y la resolución de la textura 3D.
 */
function eduLowMemDevice(): boolean {
  try {
    if (typeof navigator === "undefined") return false;
    const dm = (navigator as { deviceMemory?: number }).deviceMemory;
    if (typeof dm === "number" && dm > 0 && dm <= 4) return true;
    const ua = navigator.userAgent || "";
    const iOS =
      /iPhone|iPad|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && (navigator as { maxTouchPoints?: number }).maxTouchPoints! > 1);
    const android = /Android/.test(ua);
    const touchOnly =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    return iOS || android || Boolean(touchOnly);
  } catch {
    return false;
  }
}

function eduEsDicomSuelto(name: string): boolean {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  return ext === "dcm" || ext === "dicom";
}

/** Decodifica el .zip en el worker del dental (jszip + dicom-parser +
 *  códecs WASM fuera del hilo). Rechaza si el worker no existe o falla,
 *  para caer al decodificador del hilo principal. */
function decodeConWorker(
  blob: Blob,
  onProgress: (done: number, total: number) => void,
  onWorker: (w: Worker) => void,
): Promise<Slice[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null;
    try {
      if (typeof window === "undefined" || typeof Worker === "undefined") {
        reject(new Error("worker unavailable"));
        return;
      }
      // Ruta RELATIVA a propósito: webpack empaqueta el worker como chunk
      // aparte solo cuando puede resolver el new URL en compilación, y con
      // el alias "@/" no lo garantiza.
      worker = new Worker(new URL("../../patient-3d/dicom-decode.worker.ts", import.meta.url));
    } catch {
      reject(new Error("worker unavailable"));
      return;
    }
    onWorker(worker);
    worker.onmessage = (e: MessageEvent) => {
      const msg = (e.data || {}) as DecodeWorkerOut;
      if (msg.type === "progress") onProgress(msg.done, msg.total);
      else if (msg.type === "done") {
        worker?.terminate();
        resolve(msg.slices);
      } else if (msg.type === "error") {
        worker?.terminate();
        reject(new Error(msg.message || "worker error"));
      }
    };
    worker.onerror = () => {
      worker?.terminate();
      reject(new Error("worker error"));
    };
    worker.postMessage({ type: "decode", blob });
  });
}

/** Fallback en el hilo principal: solo DICOM sin comprimir (los códecs
 *  viven en el worker). Cede el hilo cada dos cortes. */
async function decodeEnMain(
  blob: Blob,
  onProgress: (done: number, total: number) => void,
  isCancelled: () => boolean,
): Promise<Slice[]> {
  const zip = await JSZip.loadAsync(blob);
  const entries = Object.values(zip.files).filter((f) => !f.dir && isDicomEntryName(f.name));
  const total = entries.length;
  onProgress(0, total);
  const out: Slice[] = [];
  let done = 0;
  for (const entry of entries) {
    if (isCancelled()) return out;
    try {
      const buf = await entry.async("arraybuffer");
      const s = decodeSlice(buf, done);
      if (s) out.push(...s);
    } catch {
      /* corte ilegible: se salta */
    }
    done++;
    if (done % 2 === 0 || done === total) {
      onProgress(done, total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return out;
}

export interface EduCbctViewerProps {
  /** URL FIRMADA del .zip (o del .dcm suelto). Caduca: no se guarda. */
  url: string;
  name: string;
  sizeBytes: number;
  /** Clave ESTABLE de la cache (el id del EduStudy): la URL firmada cambia
   *  en cada apertura y por eso no sirve de clave. */
  cacheKey: string;
}

type Estado = "cargando" | "listo" | "error" | "vacio" | "pesado";

/**
 * UN plano con gestos táctiles. Existe como componente aparte por una sola
 * razón: los gestos necesitan una `ref` al nodo que envuelve a MprPane, y
 * los hooks no se pueden llamar dentro de un `map`.
 */
function EduPlanoTactil({
  plano,
  etiqueta,
  slices,
  zPhysicalOrder,
  cross,
  scale,
  center,
  width,
  tool,
  showGuides,
  resetNonce,
  maximizado,
  lado,
  activa,
  onAlternarMax,
  onCrossChange,
}: {
  plano: PlaneKey;
  etiqueta: string;
  slices: Slice[];
  zPhysicalOrder: boolean;
  cross: Cross;
  scale: ScaleInfo;
  center: number;
  width: number;
  tool: Tool;
  showGuides: boolean;
  resetNonce: number;
  maximizado: boolean;
  /** Lado de la tarjeta CUADRADA (o el alto disponible si va sola). */
  lado: number;
  /** ¿Es la vista visible cuando la rejilla está en modo "una sola"? */
  activa: boolean;
  onAlternarMax: () => void;
  onCrossChange: (next: Partial<Cross>) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // El corte que este plano recorre: axial → Z, coronal → Y, sagital → X.
  // El recorte a los límites lo hace `updateCross` del contenedor, que es
  // el único que conoce las dimensiones del volumen.
  const onCorte = useCallback(
    (pasos: number) => {
      if (plano === "axial") onCrossChange({ z: cross.z + pasos });
      else if (plano === "coronal") onCrossChange({ y: cross.y + pasos });
      else onCrossChange({ x: cross.x + pasos });
    },
    [plano, cross.x, cross.y, cross.z, onCrossChange],
  );

  useEduGestosPlano(hostRef, {
    onCorte,
    cruz: tool === "crosshair",
    activo: slices.length > 0,
  });

  return (
    <div
      ref={hostRef}
      className={`edu-visor3d-celda ${activa ? "edu-visor3d-celda--activa" : ""}`}
    >
      <MprPane
        slices={slices}
        plane={plano}
        zPhysicalOrder={zPhysicalOrder}
        label={etiqueta}
        cross={cross}
        scale={scale}
        center={center}
        width={width}
        tool={tool}
        showGuides={showGuides}
        resetNonce={resetNonce}
        maximized={maximizado}
        heightPx={Math.max(160, Math.round(lado) - EDU_PANEL_CHROME)}
        onToggleMax={onAlternarMax}
        onCrossChange={onCrossChange}
      />
    </div>
  );
}

export function EduCbctViewer({ url, name, sizeBytes, cacheKey }: EduCbctViewerProps) {
  const [slices, setSlices] = useState<Slice[]>([]);
  const [estado, setEstado] = useState<Estado>("cargando");
  const [progreso, setProgreso] = useState({ done: 0, total: 0 });
  const [droppedForeign, setDroppedForeign] = useState(false);

  // Ventana y cruz COMPARTIDAS por los tres planos (es lo que las sincroniza).
  const [center, setCenter] = useState(0);
  const [width, setWidth] = useState(1);
  const [activePreset, setActivePreset] = useState<WindowKey | null>(null);
  const [cross, setCross] = useState<Cross>({ x: 0, y: 0, z: 0 });
  const [tool, setTool] = useState<Tool>("crosshair");
  const [showGuides, setShowGuides] = useState(true);
  const [maximizada, setMaximizada] = useState<VistaKey | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [defaultWin, setDefaultWin] = useState({ c: 0, w: 1 });

  // Poca RAM: el 3D a media resolución y el freno del estudio pesado. Se
  // decide una vez — la clase de aparato no cambia a media sesión.
  const [lowMem] = useState<boolean>(() => eduLowMemDevice());
  /** Alguien con una tablet decidió abrir un estudio grande de todos modos. */
  const [forzarPesado, setForzarPesado] = useState(false);

  // LA VENTANA, medida. Nada de esto mira el user-agent.
  const compacto = useEduMedia(EDU_MEDIA_COMPACTO);
  const tactil = useEduMedia(EDU_MEDIA_TACTIL);
  const [vista, setVista] = useState<VistaKey>("axial");
  // En la rejilla se montan las cinco desde el primer pintado; en compacto
  // solo la que se pide. `compacto` ya es correcto en este render —lo lee
  // matchMedia, no un efecto—, así que un teléfono nunca llega a montar la
  // textura 3D ni la panorámica "por un instante".
  const [montadas, setMontadas] = useState<VistaKey[]>(() =>
    compacto ? ["axial"] : TODAS_LAS_VISTAS,
  );

  /** Cambiar de vista MONTA la nueva en el mismo render que la selecciona:
   *  si el montaje llegara en un efecto, habría un cuadro con la rejilla en
   *  blanco. Y lo ya montado NO se desmonta al cambiar de pestaña — volver
   *  a la panorámica no vuelve a detectar el arco. */
  const elegirVista = useCallback((k: VistaKey) => {
    setVista(k);
    setMontadas((prev) => (prev.indexOf(k) >= 0 ? prev : prev.concat([k])));
  }, []);

  const rejillaRef = useRef<HTMLDivElement | null>(null);
  const pieRef = useRef<HTMLDivElement | null>(null);

  const esDicomSuelto = eduEsDicomSuelto(name);

  useEffect(() => {
    let cancelled = false;
    let activeWorker: Worker | null = null;

    // El freno de móvil va ANTES de descargar un solo byte.
    if (lowMem && !forzarPesado && !esDicomSuelto && sizeBytes > EDU_CBCT_MOVIL_MAX_BYTES) {
      setEstado("pesado");
      return;
    }

    const finalize = (raw: Slice[]) => {
      // Fuera los cortes de OTRA serie (un scout suelto en el mismo .zip):
      // el visor indexa con el raster del primero y uno ajeno pintaría una
      // imagen nítida y FALSA. La decisión vive en cbct-mpr-shared.
      const arr = keepDominantSeries(raw);
      if (arr.length === 0) {
        setEstado(raw.length === 0 ? "vacio" : "error");
        return;
      }
      setDroppedForeign(arr.length !== raw.length);
      sortSlicesForVolume(arr);
      const mid = Math.floor(arr.length / 2);
      setDefaultWin({ c: arr[mid].center, w: arr[mid].width });
      setSlices(arr);
      setCross({ x: Math.floor(arr[0].cols / 2), y: Math.floor(arr[0].rows / 2), z: mid });
      setCenter(arr[mid].center);
      setWidth(arr[mid].width);
      setActivePreset(null);
      setMaximizada(null);
      setEstado("listo");
    };

    setEstado("cargando");
    setProgreso({ done: 0, total: 0 });
    setDroppedForeign(false);

    (async () => {
      try {
        // 1 · Cortes ya decodificados en IndexedDB → ni descarga ni decode.
        const cacheados = await getDecodedSlices(cacheKey);
        if (cancelled) return;
        if (cacheados && cacheados.length > 0) {
          finalize(cacheados as Slice[]);
          return;
        }

        // 2 · El binario (con cache de blobs por cacheKey).
        const blob = await fetchWithCache(cacheKey, url);
        if (cancelled) return;

        // 3 · Un .dcm SUELTO no es un zip: se decodifica directo. Solo sin
        // comprimir — los códecs viven en el worker, que espera un zip. Si
        // no se puede, el error lo dice y el archivo queda a un clic.
        if (esDicomSuelto) {
          const s = decodeSlice(await blob.arrayBuffer(), 0);
          if (cancelled) return;
          if (!s || s.length === 0) setEstado("error");
          else finalize(s);
          return;
        }

        // 4 · El .zip completo: worker primero, hilo principal de respaldo.
        const onProgress = (done: number, total: number) => {
          if (!cancelled) setProgreso({ done, total });
        };
        let decoded: Slice[];
        try {
          decoded = await decodeConWorker(blob, onProgress, (w) => {
            activeWorker = w;
          });
        } catch {
          if (cancelled) return;
          decoded = await decodeEnMain(blob, onProgress, () => cancelled);
        }
        if (cancelled) return;
        if (decoded.length === 0) {
          setEstado("vacio");
          return;
        }
        finalize(decoded);
        // Se cachea el set CRUDO (pre-filtrado), igual que el dental: el
        // aviso de "series mezcladas" tiene que sobrevivir a la segunda
        // apertura, y para eso los cortes descartados deben seguir ahí.
        void putDecodedSlices(cacheKey, decoded);
      } catch {
        if (!cancelled) setEstado("error");
      }
    })();

    return () => {
      cancelled = true;
      activeWorker?.terminate();
    };
    // 🔴 NI `compacto`, NI `maximizada`, NI el lado de los paneles entran
    // aquí. Ese es el candado de "girar el iPad no vuelve a decodificar":
    // este efecto es el ÚNICO que llena `slices`, y solo lo re-dispara
    // cambiar de estudio (o decidir forzar uno pesado).
  }, [cacheKey, url, lowMem, forzarPesado, esDicomSuelto, sizeBytes]);

  // ── La matemática importada: estadística, escala y confianza ──────────
  const stats = useMemo(() => computeVolStats(slices), [slices]);
  const measuredZ = useMemo(() => measureZSpacing(slices), [slices]);
  const oneOrientation = useMemo(() => sameOrientation(slices), [slices]);

  // Escala física: lo inferido del corte + la MEDIANA medida de las
  // posiciones reales (que le gana al header — es una medida, no un dato).
  const scale = useMemo<ScaleInfo>(() => {
    if (slices.length === 0) return { sx: 1, sy: 1, sz: 1, xySource: "none", zCalibrated: false };
    const base = inferScale(slices[0]);
    if (!measuredZ) return base;
    if (measuredZ.sz === null) return { ...base, zVariable: measuredZ.variable };
    return { ...base, sz: measuredZ.sz, zCalibrated: true, zVariable: measuredZ.variable };
  }, [slices, measuredZ]);

  const zPhysicalOrder = useMemo(() => isPhysicallyOrdered(slices, measuredZ), [slices, measuredZ]);

  const geometryDoubt = useMemo<GeometryDoubtReason | null>(
    () =>
      slices.length === 0
        ? null
        : geometryDoubtReason({
            route: "full",
            orderSources: slices.map((s) => s.orderSource),
            samePosition: measuredZ !== null && measuredZ.sz === null,
            mixedSeries: !oneOrientation || droppedForeign,
            zVariable: scale.zVariable,
          }),
    [slices, measuredZ, oneOrientation, droppedForeign, scale.zVariable],
  );

  // Auto-ventana p1/p99 en cuanto hay percentiles (el WindowCenter del
  // scanner suele caer mal en CBCT).
  const [autoAplicada, setAutoAplicada] = useState(false);
  useEffect(() => {
    setAutoAplicada(false);
  }, [cacheKey]);
  useEffect(() => {
    if (!stats || slices.length === 0 || autoAplicada) return;
    setAutoAplicada(true);
    const w = presetWindow(stats, "auto");
    setDefaultWin({ c: w.c, w: w.w });
    setCenter(w.c);
    setWidth(w.w);
    setActivePreset("auto");
  }, [stats, slices.length, autoAplicada]);

  // Qué vistas están MONTADAS. En la rejilla, las cinco. En compacto solo
  // las que se han pedido — y las que ya se pidieron NO se desmontan al
  // cambiar de pestaña: volver a la panorámica no vuelve a detectar el
  // arco, ni el 3D a subir su textura.
  // Si la ventana crece hasta dar para la rejilla, se montan las que
  // faltaban. Al revés no se desmonta nada: encoger la ventana no tiene por
  // qué costar volver a construir lo que ya estaba hecho.
  useEffect(() => {
    if (compacto) return;
    setMontadas((prev) => (prev.length === TODAS_LAS_VISTAS.length ? prev : TODAS_LAS_VISTAS));
  }, [compacto]);

  // Cruzar el umbral de la rejilla deshace el maximizado: en compacto
  // "maximizar" significa otra cosa (quitar los controles de encima), y
  // arrastrar el estado de un modo al otro deja botones que no dicen la
  // verdad. No desmonta nada: solo cambia qué panel se ve.
  useEffect(() => {
    setMaximizada(null);
  }, [compacto]);

  const updateCross = useCallback(
    (next: Partial<Cross>) => {
      setCross((prev) => {
        if (slices.length === 0) return prev;
        const x = next.x != null ? clampInt(next.x, 0, slices[0].cols - 1) : prev.x;
        const y = next.y != null ? clampInt(next.y, 0, slices[0].rows - 1) : prev.y;
        const z = next.z != null ? clampInt(next.z, 0, slices.length - 1) : prev.z;
        if (x === prev.x && y === prev.y && z === prev.z) return prev;
        return { x, y, z };
      });
    },
    [slices],
  );

  const aplicarPreset = (key: WindowKey) => {
    if (!stats) return;
    const w = presetWindow(stats, key);
    setCenter(w.c);
    setWidth(w.w);
    setActivePreset(key);
  };

  const reiniciar = () => {
    if (stats) aplicarPreset("auto");
    else {
      setCenter(defaultWin.c);
      setWidth(defaultWin.w);
    }
    if (slices.length) {
      setCross({
        x: Math.floor(slices[0].cols / 2),
        y: Math.floor(slices[0].rows / 2),
        z: Math.floor(slices.length / 2),
      });
    }
    setResetNonce((n) => n + 1);
  };

  const alternarMax = useCallback((k: VistaKey) => {
    setMaximizada((m) => (m === k ? null : k));
  }, []);

  // Una sola vista a la vez: por elección (compacto) o por maximizar.
  const sola: VistaKey | null = compacto ? vista : maximizada;
  // En el teléfono, "maximizar" quiere decir "quítame los controles de
  // encima": son ~100 px de una pantalla de 600.
  const sinControles = compacto && maximizada !== null;

  const medidas = useEduMedidasRejilla(rejillaRef, pieRef, estado === "listo");
  const lado = medidas.lado || EDU_LADO_FALLBACK;
  const disponible = medidas.disponible || EDU_ALTO_FALLBACK;
  /** Alto de la tarjeta cuando va sola: todo lo que quede de ventana. */
  const ladoEfectivo = sola ? disponible : lado;

  // ── Estados sin volumen ───────────────────────────────────────────────
  if (estado === "pesado") {
    return (
      <div className="edu-banner edu-banner--warn">
        <div>
          <p className="edu-banner__title">
            Este CBCT es muy pesado para la memoria de este aparato
          </p>
          <p className="edu-banner__detail">
            Abrirlo aquí descomprime el estudio completo en la memoria del dispositivo y la
            pestaña se recargaría a medias. Ábrelo desde una computadora para verlo con los
            planos, el volumen 3D y la panorámica, o descárgalo con el botón de abajo. El
            archivo está íntegro.
          </p>
          {/* En una pantalla de tablet la decisión es de quien tiene el
              aparato en la mano: el freno es una PRECAUCIÓN de memoria, no
              una certeza, y un iPad reciente suele poder. En el teléfono no
              se ofrece: ahí la recarga de la pestaña es casi segura. */}
          {!compacto && (
            <div className="edu-actions">
              <button
                type="button"
                className="edu-btn edu-btn--ghost edu-btn--sm"
                onClick={() => setForzarPesado(true)}
              >
                Intentar abrirlo aquí de todas formas
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (estado === "cargando") {
    return (
      <div className="edu-visor3d-cargando" role="status">
        <Loader2 className="edu-girando" size={18} />
        <span>
          Descomprimiendo y leyendo el CBCT…
          {progreso.total > 0 ? ` ${progreso.done} / ${progreso.total} cortes` : ""}
        </span>
      </div>
    );
  }

  if (estado === "error" || estado === "vacio") {
    return (
      <div className="edu-banner">
        <div>
          <p className="edu-banner__title">
            {estado === "vacio" ? "No se encontraron cortes legibles" : "No se pudo leer el estudio"}
          </p>
          <p className="edu-banner__detail">
            {estado === "vacio"
              ? "El .zip no contiene cortes DICOM legibles. Verifica que sea la carpeta del CBCT (archivos .dcm)."
              : esDicomSuelto
                ? "Este corte no se pudo decodificar aquí (puede venir comprimido con un códec que el visor solo maneja dentro de un .zip). Descárgalo con el botón de abajo."
                : "El archivo no pudo descomprimirse o leerse. Descárgalo con el botón de abajo para abrirlo en tu visor DICOM."}
          </p>
        </div>
      </div>
    );
  }

  // ── estado === "listo" ────────────────────────────────────────────────
  const winMin = defaultWin.c - defaultWin.w * 2;
  const winMax = defaultWin.c + defaultWin.w * 2;

  const plano = (p: { key: PlaneKey; label: string }) => (
    <EduPlanoTactil
      key={p.key}
      plano={p.key}
      etiqueta={p.label}
      slices={slices}
      zPhysicalOrder={zPhysicalOrder}
      cross={cross}
      scale={scale}
      center={center}
      width={width}
      tool={tool}
      showGuides={showGuides}
      resetNonce={resetNonce}
      maximizado={maximizada === p.key}
      lado={ladoEfectivo}
      activa={sola === p.key}
      onAlternarMax={() => alternarMax(p.key)}
      onCrossChange={updateCross}
    />
  );

  const volumen = (
    <div
      key="volume"
      className={`edu-visor3d-celda edu-visor3d-vol ${
        sola === "volume" ? "edu-visor3d-celda--activa" : ""
      }`}
      style={{ height: Math.round(ladoEfectivo) }}
    >
      {/* `height="100%"` y no un número: el lienzo se estira al hueco que
          deja la barra de Sólido/MIP/Densidad/Umbral que trae el propio
          Dicom3DVolume (ver la regla `.edu-visor3d-vol > div` de
          edu-theme.css). Así la tarjeta entera mide exactamente lo mismo
          que un plano y la rejilla queda pareja, sin medir esa barra.
          🔴 Cambiar el alto NO reconstruye la textura 3D: las dependencias
          de su efecto pesado son slices/maxDim/zSpacing/orden, y ninguna
          es el tamaño. */}
      <Dicom3DVolume
        slices={slices as unknown as VolSlice[]}
        maxDim={lowMem ? 128 : 256}
        zSpacingMm={scale.sz}
        zPhysicalOrder={zPhysicalOrder}
        height="100%"
      />
      <span className="edu-visor3d-pane__hud">
        <Box size={12} aria-hidden /> Volumen 3D
      </span>
      <button
        type="button"
        className="edu-visor3d-pane__max edu-visor3d-pane__max--flota"
        onClick={() => alternarMax("volume")}
        title={maximizada === "volume" ? "Restaurar la rejilla" : "Maximizar el volumen"}
        aria-label={maximizada === "volume" ? "Restaurar la rejilla" : "Maximizar el volumen"}
      >
        {maximizada === "volume" ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    </div>
  );

  const panoramica = (
    <div
      key="pano"
      className={`edu-visor3d-celda edu-visor3d-grid__pano ${
        sola === "pano" ? "edu-visor3d-celda--activa" : ""
      }`}
    >
      <EduPanoramica
        slices={slices}
        scale={scale}
        center={center}
        width={width}
        cross={cross}
        zPhysicalOrder={zPhysicalOrder}
        alto={ladoEfectivo}
        maximizado={maximizada === "pano"}
        onAlternarMax={() => alternarMax("pano")}
      />
    </div>
  );

  const celdaDe = (k: VistaKey) => {
    if (k === "volume") return volumen;
    if (k === "pano") return panoramica;
    const p = PLANES.find((x) => x.key === k);
    return p ? plano(p) : null;
  };

  return (
    <div className="edu-visor3d">
      {geometryDoubt && <GeometryWarning detail={GEOMETRY_DOUBT_DETAIL[geometryDoubt]} />}

      {!sinControles && (
        <>
          {/* Barra: herramienta + guías + reiniciar. */}
          <div
            className="edu-visor3d-barra"
            role="toolbar"
            aria-label="Herramientas del visor CBCT"
          >
            <div className="edu-visor3d-grupo" role="group" aria-label="Herramienta">
              {TOOLS.map((t) => {
                const Icon = t.icon;
                const on = tool === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={on}
                    className={`edu-btn edu-btn--sm ${on ? "edu-btn--primary" : "edu-btn--ghost"}`}
                    onClick={() => setTool(t.key)}
                  >
                    <Icon size={14} />
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div className="edu-visor3d-grupo">
              <button
                type="button"
                aria-pressed={showGuides}
                className={`edu-btn edu-btn--sm ${
                  showGuides ? "edu-btn--primary" : "edu-btn--ghost"
                }`}
                onClick={() => setShowGuides((v) => !v)}
              >
                <Crosshair size={14} />
                Guías
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--ghost edu-btn--sm"
                onClick={reiniciar}
              >
                <RotateCcw size={14} />
                Reiniciar
              </button>
            </div>
          </div>

          {/* Ventana 2D: presets + brillo/contraste. */}
          <div className="edu-visor3d-barra">
            <div className="edu-visor3d-grupo" role="group" aria-label="Ventana 2D">
              {WINDOW_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={activePreset === p.key}
                  disabled={!stats}
                  className={`edu-btn edu-btn--sm ${
                    activePreset === p.key ? "edu-btn--primary" : "edu-btn--ghost"
                  }`}
                  onClick={() => aplicarPreset(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <label className="edu-visor3d-slider">
              <Sun size={14} aria-hidden />
              <input
                type="range"
                min={winMin}
                max={winMax}
                value={center}
                aria-label="Brillo (centro de ventana)"
                onChange={(e) => {
                  setCenter(Number(e.target.value));
                  setActivePreset(null);
                }}
              />
            </label>
            <label className="edu-visor3d-slider">
              <ContrastIcon size={14} aria-hidden />
              <input
                type="range"
                min={1}
                max={Math.max(2, defaultWin.w * 4)}
                value={width}
                aria-label="Contraste (ancho de ventana)"
                onChange={(e) => {
                  setWidth(Number(e.target.value));
                  setActivePreset(null);
                }}
              />
            </label>
          </div>
        </>
      )}

      {/* Selector de vista: SOLO cuando la ventana no da para la rejilla.
          Cuatro miniaturas ilegibles no le sirven a nadie en un teléfono. */}
      {compacto && !sinControles && (
        <div className="edu-visor3d-grupo" role="group" aria-label="Vista del estudio">
          {VISTAS.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={vista === v.key}
              className={`edu-btn edu-btn--sm ${
                vista === v.key ? "edu-btn--primary" : "edu-btn--ghost"
              }`}
              onClick={() => elegirVista(v.key)}
            >
              {v.key === "volume" ? <Box size={14} /> : null}
              {v.label}
            </button>
          ))}
        </div>
      )}

      {/* LA REJILLA. Es SIEMPRE el mismo nodo: lo que cambia es su clase y
          su ancho máximo. Así, pasar de 2 a 3 columnas, maximizar un panel
          o girar el aparato no desmonta ni un lienzo — y por lo tanto no
          vuelve a decodificar ni a reconstruir nada. */}
      <div
        ref={rejillaRef}
        className={`edu-visor3d-grid ${sola ? "edu-visor3d-grid--solo" : ""}`}
        style={
          {
            // El reparto de columnas lo elige la MEDIDA de la ventana (el
            // que hace los paneles más grandes), no un corte fijo. El
            // @media de edu-theme.css queda de respaldo para el primer
            // pintado, antes de que haya una medición.
            gridTemplateColumns:
              !sola && medidas.columnas > 0
                ? `repeat(${medidas.columnas}, minmax(0, 1fr))`
                : undefined,
            // Con el ALTO mandando, la rejilla se estrecha y se centra para
            // que la celda salga cuadrada de verdad y no "casi".
            maxWidth: sola ? undefined : medidas.anchoMax || undefined,
            // Techo del panel que va solo. MprPane trae un tope propio en
            // vh pensado para el modal del dental; aquí lo que manda es el
            // hueco real de esta hoja (ver edu-theme.css).
            "--edu-max-h": `${Math.max(200, Math.round(disponible) - EDU_PANEL_CHROME)}px`,
          } as React.CSSProperties
        }
      >
        {montadas.map((k) => celdaDe(k))}
      </div>

      <div ref={pieRef}>
        <p className="edu-note">
          <Layers size={13} aria-hidden /> {slices.length} cortes · cruz sincronizada en mm ·{" "}
          {tactil
            ? "arrastrar = navegar cortes · pellizcar = zoom · dos dedos = desplazar · tocar = mover la cruz"
            : "rueda = navegar cortes · Ctrl/⌘+rueda = zoom · doble clic = centrar"}
        </p>
        <p className="edu-visor3d-aviso">
          ⚠ El CBCT no entrega unidades Hounsfield reales: la sonda da un valor relativo para
          comparar zonas del MISMO estudio, no densidad ósea. Sin escala calibrada, las
          medidas se reportan en px. Es apoyo visual — no sustituye una estación diagnóstica
          certificada.
        </p>
      </div>
    </div>
  );
}
