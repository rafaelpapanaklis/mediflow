"use client";
// Visor de SET CBCT estilo software dental (Romexis/Carestream): descarga el .zip
// del estudio, lo descomprime (jszip), decodifica cada corte DICOM (dicom-parser /
// códec WASM en el worker) y presenta una REJILLA 2×2 con las cuatro vistas a la
// vez — Axial · Coronal · Sagital · Volumen 3D — con CRUZ SINCRONIZADA en mm:
//   - Axial    : plano (X,Y) en Z fijo  -> corte nativo
//   - Coronal  : plano (X,Z) en Y fijo  -> MPR reconstruido del volumen
//   - Sagital  : plano (Y,Z) en X fijo  -> MPR reconstruido del volumen
//   - Volumen 3D: render volumétrico (three.js) — componente aparte.
// Los tres planos 2D comparten la posición de la cruz (Cross = índices de vóxel) y
// el window/level; al mover la cruz en uno, los otros dos se reposicionan a esa
// coordenada del MUNDO (mm), porque cada raster ya está escalado por el espaciado
// físico del estudio. Cada panel se puede MAXIMIZAR. Presets de ventana de 1 clic
// (hueso/tejido/aire) + auto-ventana p1/p99 derivada de los percentiles del estudio.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import JSZip from "jszip";
import dicomParser from "dicom-parser";
import {
  Loader2,
  RotateCcw,
  Save,
  Sun,
  Contrast as ContrastIcon,
  Layers,
  Box,
  Move,
  Ruler,
  Crosshair,
  Pipette,
  Maximize2,
  Minimize2,
} from "lucide-react";
import toast from "react-hot-toast";
import { fetchWithCache, getDecodedSlices, putDecodedSlices } from "@/lib/dicom-cache";
import { decodeSlice, isDicomEntryName } from "./dicom-decode-core";
import type { VolSlice } from "./Dicom3DVolume";
import MprPane from "./MprPane";
import {
  clampInt,
  computeVolStats,
  inferScale,
  presetWindow,
  WINDOW_PRESETS,
  type Cross,
  type PlaneKey,
  type ScaleInfo,
  type Slice,
  type SpacingSource,
  type Tool,
  type WindowKey,
} from "./cbct-mpr-shared";

// Render volumétrico 3D (three.js). Dinámico para no cargar el shader hasta que
// el componente se monta (trae su propio canvas + controles de densidad/opacidad).
const Dicom3DVolume = dynamic(() => import("./Dicom3DVolume"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center text-muted-foreground" style={{ height: 460 }}>
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Preparando volumen 3D…
    </div>
  ),
});

interface Props {
  url: string;
  name: string;
  fileId: string;
  patientId: string;
  initialNotes?: string;
}

type DecodeProgress = (done: number, total: number) => void;

// Planos 2D de la rejilla (el 3D se renderiza aparte en su cuadrante).
const PLANES: { key: PlaneKey; label: string }[] = [
  { key: "axial", label: "Axial" },
  { key: "coronal", label: "Coronal" },
  { key: "sagittal", label: "Sagital" },
];

// Herramientas de los planos 2D (la cruz es la primaria: navegar sincronizado).
const TOOLS: { key: Tool; label: string }[] = [
  { key: "crosshair", label: "Cruz" },
  { key: "pan", label: "Mover" },
  { key: "measure", label: "Medir" },
  { key: "probe", label: "Sonda" },
];
function toolIcon(key: Tool) {
  if (key === "pan") return <Move className="w-3.5 h-3.5" aria-hidden />;
  if (key === "measure") return <Ruler className="w-3.5 h-3.5" aria-hidden />;
  if (key === "probe") return <Pipette className="w-3.5 h-3.5" aria-hidden />;
  return <Crosshair className="w-3.5 h-3.5" aria-hidden />;
}

// Crea el worker de decodificación. El bundler de Next (webpack 5) emite el worker
// como un chunk aparte gracias a new URL(..., import.meta.url). Devuelve null si el
// entorno no soporta workers (entonces se decodifica en el hilo principal).
function createDecodeWorker(): Worker | null {
  try {
    if (typeof window === "undefined" || typeof Worker === "undefined") return null;
    return new Worker(new URL("./dicom-decode.worker.ts", import.meta.url));
  } catch {
    return null;
  }
}

// Decodifica el set en un Web Worker (jszip + dicom-parser + códec fuera del hilo
// principal). Rechaza si el worker no se puede crear o falla, para que el llamador
// caiga al fallback en hilo principal.
function decodeWithWorker(
  blob: Blob,
  onProgress: DecodeProgress,
  onWorker?: (w: Worker) => void,
): Promise<Slice[]> {
  return new Promise((resolve, reject) => {
    const worker = createDecodeWorker();
    if (!worker) {
      reject(new Error("worker unavailable"));
      return;
    }
    onWorker?.(worker);
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data || {};
      if (msg.type === "progress") {
        onProgress(msg.done, msg.total);
      } else if (msg.type === "done") {
        worker.terminate();
        resolve(msg.slices as Slice[]);
      } else if (msg.type === "error") {
        worker.terminate();
        reject(new Error(msg.message || "worker error"));
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("worker error"));
    };
    worker.postMessage({ type: "decode", blob });
  });
}

// Fallback en hilo principal: el mismo trabajo cediendo el hilo cada 2 cortes. Solo
// DICOM sin comprimir (la descompresión por códec vive en el worker).
async function decodeOnMain(
  blob: Blob,
  onProgress: DecodeProgress,
  isCancelled: () => boolean,
): Promise<Slice[]> {
  const zip = await JSZip.loadAsync(blob);
  const entries = (Object.values(zip.files) as any[]).filter(
    (f) => !f.dir && isDicomEntryName(f.name),
  );
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
      /* corte inválido: se salta */
    }
    done++;
    if (done % 2 === 0 || done === total) {
      onProgress(done, total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Resolución de la escala física (precedencia clínica), ruta de carga         */
/* -------------------------------------------------------------------------- */

// Lee "fila\\columna" (PixelSpacing/ImagerPixelSpacing) -> {x,y} en mm. Un solo
// valor = píxel cuadrado. Null si no hay par válido (>0).
function parseSpacingPair(str: string | undefined): { x: number; y: number } | null {
  if (!str) return null;
  const p = str.split("\\");
  const yv = parseFloat(p[0]); // Δy (entre filas)
  const xv = parseFloat(p[1]); // Δx (entre columnas)
  const y = Number.isFinite(yv) && yv > 0 ? yv : NaN;
  const x = Number.isFinite(xv) && xv > 0 ? xv : Number.isFinite(yv) && yv > 0 ? yv : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function firstPositive(str: string | undefined): number {
  if (!str) return NaN;
  const v = parseFloat(String(str).split("\\")[0]);
  return Number.isFinite(v) && v > 0 ? v : NaN;
}

// Sondea el header de UN corte del .zip (descomprime 1 entrada, no todo) para
// resolver la fuente real del espaciado con la precedencia PixelSpacing >
// ImagerPixelSpacing. Best-effort, nunca lanza.
async function probeScale(blob: Blob): Promise<ScaleInfo | null> {
  try {
    const zip = await JSZip.loadAsync(blob);
    const entry = (Object.values(zip.files) as any[]).find((f) => !f.dir && isDicomEntryName(f.name));
    if (!entry) return null;
    const buf = await entry.async("arraybuffer");
    const ds = dicomParser.parseDicom(new Uint8Array(buf));

    const px = parseSpacingPair(ds.string("x00280030")); // PixelSpacing
    const imager = parseSpacingPair(ds.string("x00181164")); // ImagerPixelSpacing
    let sx = 1;
    let sy = 1;
    let xySource: SpacingSource = "none";
    if (px) {
      sx = px.x;
      sy = px.y;
      xySource = "pixel-spacing";
    } else if (imager) {
      sx = imager.x;
      sy = imager.y;
      xySource = "imager-pixel-spacing";
    }

    const zBetween = firstPositive(ds.string("x00180088")); // SpacingBetweenSlices
    const zThick = firstPositive(ds.string("x00180050")); // SliceThickness
    let sz = sy;
    let zCalibrated = false;
    if (Number.isFinite(zBetween)) {
      sz = zBetween;
      zCalibrated = true;
    } else if (Number.isFinite(zThick)) {
      sz = zThick;
      zCalibrated = true;
    } else {
      sz = sy;
      zCalibrated = xySource !== "none";
    }
    return { sx, sy, sz, xySource, zCalibrated };
  } catch {
    return null;
  }
}

const SCALE_LS_PREFIX = "cbct-scale:v1:";
function loadStoredScale(fileId: string): ScaleInfo | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(SCALE_LS_PREFIX + fileId);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (
      o &&
      typeof o.sx === "number" &&
      typeof o.sy === "number" &&
      typeof o.sz === "number" &&
      o.sx > 0 &&
      o.sy > 0 &&
      o.sz > 0
    ) {
      const src: SpacingSource =
        o.xySource === "pixel-spacing" || o.xySource === "imager-pixel-spacing" ? o.xySource : "none";
      return { sx: o.sx, sy: o.sy, sz: o.sz, xySource: src, zCalibrated: !!o.zCalibrated };
    }
  } catch {
    /* localStorage no disponible o JSON inválido */
  }
  return null;
}
function storeScale(fileId: string, s: ScaleInfo): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SCALE_LS_PREFIX + fileId, JSON.stringify(s));
  } catch {
    /* cuota/privado: se ignora */
  }
}

export default function DicomSetViewer({ url, name, fileId, patientId, initialNotes = "" }: Props) {
  const [slices, setSlices] = useState<Slice[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "empty">("loading");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [scaleInfo, setScaleInfo] = useState<ScaleInfo | null>(null);

  // Ventana COMPARTIDA por los tres planos 2D.
  const [center, setCenter] = useState(0);
  const [width, setWidth] = useState(1);
  const [activePreset, setActivePreset] = useState<WindowKey | null>(null);

  // Cruz COMPARTIDA (índices de vóxel) + herramienta + guías.
  const [cross, setCross] = useState<Cross>({ x: 0, y: 0, z: 0 });
  const [tool, setTool] = useState<Tool>("crosshair");
  const [showGuides, setShowGuides] = useState(true);

  // Layout: null = rejilla 2×2; o el cuadrante maximizado.
  const [maximized, setMaximized] = useState<PlaneKey | "volume" | null>(null);
  const [resetNonce, setResetNonce] = useState(0);

  const [notes, setNotes] = useState(initialNotes);
  const [savingNotes, setSavingNotes] = useState(false);

  const defaultWin = useRef({ c: 0, w: 1 });
  const autoForFile = useRef<string | null>(null);

  const urlRef = useRef(url);
  urlRef.current = url;

  // Estadística por percentiles (auto-ventana + presets). Instantánea, una vez por set.
  const stats = useMemo(() => computeVolStats(slices), [slices]);

  // Escala física resuelta (o inferida de los cortes mientras llega la del header).
  const scale = useMemo<ScaleInfo>(() => {
    if (slices.length === 0) return { sx: 1, sy: 1, sz: 1, xySource: "none", zCalibrated: false };
    return scaleInfo ?? inferScale(slices[0]);
  }, [slices, scaleInfo]);

  // Carga del set (idéntico al flujo previo): cache de cortes -> descarga .zip ->
  // decode en worker (fallback main) -> cachea. La url cambia por TTL; depende de
  // fileId (estable) para no re-decodificar al reabrir.
  useEffect(() => {
    let cancelled = false;
    let activeWorker: Worker | null = null;
    const isCancelled = () => cancelled;

    const finalize = (arr: Slice[]) => {
      arr.sort((a, b) => a.order - b.order);
      const mid = Math.floor(arr.length / 2);
      defaultWin.current = { c: arr[mid].center, w: arr[mid].width };
      autoForFile.current = null; // permite aplicar la auto-ventana al nuevo estudio
      setSlices(arr);
      setCross({ x: Math.floor(arr[0].cols / 2), y: Math.floor(arr[0].rows / 2), z: mid });
      setCenter(arr[mid].center);
      setWidth(arr[mid].width);
      setActivePreset(null);
      setMaximized(null);
      setStatus("ready");
    };

    setStatus("loading");
    setProgress({ done: 0, total: 0 });
    setScaleInfo(null);

    const applyScale = async (blob: Blob | null) => {
      const stored = loadStoredScale(fileId);
      if (stored) {
        if (!cancelled) setScaleInfo(stored);
        return;
      }
      if (!blob) return;
      const probed = await probeScale(blob);
      if (probed && !cancelled) {
        setScaleInfo(probed);
        storeScale(fileId, probed);
      }
    };

    (async () => {
      try {
        const cachedSlices = await getDecodedSlices(fileId);
        if (cancelled) return;
        if (cachedSlices && cachedSlices.length > 0) {
          finalize(cachedSlices as Slice[]);
          void applyScale(null);
          return;
        }

        const blob = await fetchWithCache(fileId, urlRef.current);
        if (cancelled) return;

        const onProgress: DecodeProgress = (done, total) => {
          if (!cancelled) setProgress({ done, total });
        };
        let decoded: Slice[];
        try {
          decoded = await decodeWithWorker(blob, onProgress, (w) => {
            activeWorker = w;
          });
        } catch {
          if (cancelled) return;
          decoded = await decodeOnMain(blob, onProgress, isCancelled);
        }
        if (cancelled) return;
        if (decoded.length === 0) {
          setStatus("empty");
          return;
        }

        finalize(decoded);
        void applyScale(blob);
        void putDecodedSlices(fileId, decoded);
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      activeWorker?.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // Auto-ventana p1/p99 al cargar (mejor que el WindowCenter/Width del scanner, que
  // en CBCT suele caer mal). Se aplica una vez por estudio en cuanto hay percentiles.
  useEffect(() => {
    if (!stats || slices.length === 0) return;
    if (autoForFile.current === fileId) return;
    autoForFile.current = fileId;
    const w = presetWindow(stats, "auto");
    defaultWin.current = { c: w.c, w: w.w };
    setCenter(w.c);
    setWidth(w.w);
    setActivePreset("auto");
  }, [stats, fileId, slices.length]);

  // Actualiza la cruz acotando cada eje a su rango. Lo llaman los tres planos.
  const updateCross = useCallback(
    (next: Partial<Cross>) => {
      setCross((prev) => {
        if (slices.length === 0) return prev;
        const c = slices[0].cols;
        const r = slices[0].rows;
        const d = slices.length;
        const x = next.x != null ? clampInt(next.x, 0, c - 1) : prev.x;
        const y = next.y != null ? clampInt(next.y, 0, r - 1) : prev.y;
        const z = next.z != null ? clampInt(next.z, 0, d - 1) : prev.z;
        if (x === prev.x && y === prev.y && z === prev.z) return prev;
        return { x, y, z };
      });
    },
    [slices],
  );

  const applyPreset = (key: WindowKey) => {
    if (!stats) return;
    const w = presetWindow(stats, key);
    setCenter(w.c);
    setWidth(w.w);
    setActivePreset(key);
  };

  const reset = () => {
    if (stats) {
      const w = presetWindow(stats, "auto");
      setCenter(w.c);
      setWidth(w.w);
      setActivePreset("auto");
    } else {
      setCenter(defaultWin.current.c);
      setWidth(defaultWin.current.w);
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

  const toggleMax = (key: PlaneKey | "volume") => setMaximized((m) => (m === key ? null : key));

  const saveNotes = useCallback(async () => {
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/models-3d/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorNotes: notes }),
      });
      if (!res.ok) throw new Error();
      toast.success("Notas guardadas");
    } catch {
      toast.error("No se pudieron guardar las notas");
    } finally {
      setSavingNotes(false);
    }
  }, [notes, patientId, fileId]);

  const notesPanel = (
    <div className="w-full border-t border-border pt-4">
      <h4 className="text-xs font-bold text-foreground mb-2">Notas del estudio</h4>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notas clínicas sobre este CBCT…"
        rows={4}
        aria-label="Notas clínicas del estudio CBCT"
        className="w-full text-sm rounded-lg bg-muted/40 border border-border text-foreground p-2 resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      />
      <div className="flex justify-end mt-2">
        <button
          type="button"
          onClick={saveNotes}
          disabled={savingNotes}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" /> {savingNotes ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );

  if (status === "loading") {
    return (
      <div className="flex flex-col items-center justify-center text-muted-foreground" style={{ height: 480 }}>
        <Loader2 className="w-6 h-6 animate-spin mb-3" />
        <p className="text-sm">Descomprimiendo y leyendo el CBCT…</p>
        {progress.total > 0 && (
          <>
            <p className="text-xs mt-1">
              {progress.done} / {progress.total} cortes
            </p>
            <div className="w-48 h-1.5 bg-muted rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-brand-500 rounded-full transition-all"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
          </>
        )}
      </div>
    );
  }

  if (status === "error" || status === "empty") {
    return (
      <div className="flex flex-col gap-4">
        <div
          className="flex flex-col items-center justify-center text-center text-muted-foreground p-8"
          style={{ minHeight: 320 }}
        >
          <Layers className="w-10 h-10 mb-3 text-muted-foreground" />
          <p className="text-sm font-bold text-foreground">
            {status === "empty" ? "No se encontraron cortes legibles" : "No se pudo leer el set"}
          </p>
          <p className="text-xs mt-1 max-w-sm">
            {status === "empty"
              ? "El .zip no contiene cortes DICOM legibles. Verifica que sea la carpeta del CBCT (archivos .dcm)."
              : "El archivo no pudo descomprimirse o leerse. Asegúrate de subir un .zip válido del estudio."}
          </p>
          <a
            href={url}
            download={name}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 mt-4"
          >
            Descargar .zip
          </a>
        </div>
        {notesPanel}
      </div>
    );
  }

  // status === "ready"
  const winMin = defaultWin.current.c - defaultWin.current.w * 2;
  const winMax = defaultWin.current.c + defaultWin.current.w * 2;

  const renderPane = (p: { key: PlaneKey; label: string }, heightPx: number) => (
    <MprPane
      key={p.key}
      slices={slices}
      plane={p.key}
      label={p.label}
      cross={cross}
      scale={scale}
      center={center}
      width={width}
      tool={tool}
      showGuides={showGuides}
      resetNonce={resetNonce}
      maximized={maximized === p.key}
      heightPx={heightPx}
      onToggleMax={() => toggleMax(p.key)}
      onCrossChange={updateCross}
    />
  );

  const volumeCell = (
    <div className="flex flex-col self-start rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-muted/40 border-b border-border">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-foreground">
          <Box className="w-3.5 h-3.5" aria-hidden /> Volumen 3D
        </span>
        <button
          type="button"
          onClick={() => toggleMax("volume")}
          title={maximized === "volume" ? "Restaurar la rejilla 2×2" : "Maximizar el volumen 3D"}
          aria-label={maximized === "volume" ? "Restaurar la rejilla 2×2" : "Maximizar el volumen 3D"}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {maximized === "volume" ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div className="p-2">
        <Dicom3DVolume slices={slices as unknown as VolSlice[]} />
      </div>
    </div>
  );

  const maximizedPlane = PLANES.find((p) => p.key === maximized);

  return (
    <div className="flex flex-col gap-3">
      {/* Barra de control: herramientas + guías + presets de ventana + ajuste fino. */}
      <div className="flex flex-col gap-2 bg-muted/40 rounded-lg p-2 border border-border">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div
            className="inline-flex items-center gap-1 p-1 rounded-lg bg-background/60 border border-border"
            role="group"
            aria-label="Herramienta de imagen"
          >
            {TOOLS.map((t) => {
              const active = tool === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTool(t.key)}
                  className={`text-xs font-semibold px-2.5 py-1.5 rounded-md inline-flex items-center gap-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    active ? "bg-brand-600 text-white shadow-sm" : "text-foreground hover:bg-muted"
                  }`}
                >
                  {toolIcon(t.key)}
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              aria-pressed={showGuides}
              onClick={() => setShowGuides((v) => !v)}
              className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-md inline-flex items-center gap-1.5 border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                showGuides
                  ? "bg-brand-600 text-white border-brand-600"
                  : "bg-background/60 text-foreground border-border hover:bg-muted"
              }`}
              title="Mostrar u ocultar las guías de la cruz sincronizada"
            >
              <Crosshair className="w-3.5 h-3.5" /> Guías
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-background/60 text-foreground border border-border hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <RotateCcw className="w-3 h-3" /> Reiniciar
            </button>
          </div>
        </div>

        {/* Ventana 2D: presets de 1 clic + ajuste fino de brillo/contraste. */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-background/60 border border-border">
            <span className="text-[10px] text-muted-foreground px-1.5">Ventana 2D</span>
            {WINDOW_PRESETS.map((p) => {
              const active = activePreset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => applyPreset(p.key)}
                  disabled={!stats}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    active ? "bg-brand-600 text-white shadow-sm" : "text-foreground hover:bg-muted"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
            <Sun className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden />
            <input
              type="range"
              min={winMin}
              max={winMax}
              value={center}
              onChange={(e) => {
                setCenter(Number(e.target.value));
                setActivePreset(null);
              }}
              className="flex-1 accent-brand-500"
              aria-label="Brillo (centro de ventana)"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
            <ContrastIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden />
            <input
              type="range"
              min={1}
              max={Math.max(2, defaultWin.current.w * 4)}
              value={width}
              onChange={(e) => {
                setWidth(Number(e.target.value));
                setActivePreset(null);
              }}
              className="flex-1 accent-brand-500"
              aria-label="Contraste (ancho de ventana)"
            />
          </div>
        </div>
      </div>

      {/* Rejilla 2×2 (Axial · Coronal · Sagital · Volumen 3D) o el cuadrante maximizado. */}
      {maximized === "volume" ? (
        volumeCell
      ) : maximizedPlane ? (
        renderPane(maximizedPlane, 620)
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 items-start">
          {renderPane(PLANES[0], 420)}
          {renderPane(PLANES[1], 420)}
          {renderPane(PLANES[2], 420)}
          {volumeCell}
        </div>
      )}

      {/* Recordatorio clínico (CBCT ≠ HU). */}
      <p className="text-[10px] text-amber-700 dark:text-amber-300/90 flex items-start gap-1 leading-snug">
        <span aria-hidden>⚠</span>
        <span>
          El CBCT no entrega unidades Hounsfield (HU) reales: la sonda da un valor relativo para comparar zonas del
          mismo estudio, no densidad ósea. Las medidas usan el espaciado físico del estudio; en proyecciones (solo{" "}
          <code>ImagerPixelSpacing</code>) son aproximadas por magnificación, y sin escala calibrada se reportan en px.
          Apoyo visual, no sustituye una estación diagnóstica certificada.
        </span>
      </p>

      {status === "ready" && (
        <p className="text-[10px] text-muted-foreground">
          {slices.length} cortes · cruz sincronizada en mm · rueda = navegar cortes · Ctrl/⌘+rueda = zoom · doble clic =
          centrar.
        </p>
      )}

      {notesPanel}
    </div>
  );
}
