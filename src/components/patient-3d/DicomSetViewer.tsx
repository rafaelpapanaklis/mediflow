"use client";
// Visor de SET CBCT estilo software dental: descarga el .zip del estudio, lo
// descomprime (jszip), decodifica cada corte DICOM (dicom-parser) y ofrece 4
// vistas (una a la vez):
//   - Axial    : plano (X,Y) en Z fijo  -> slices[z].pixels (corte nativo)
//   - Coronal  : plano (X,Z) en Y fijo  -> MPR reconstruido del volumen
//   - Sagital  : plano (Y,Z) en X fijo  -> MPR reconstruido del volumen
//   - Volumen 3D: render volumétrico (three.js) — componente aparte.
// Todas las vistas 2D comparten el mismo window/level (brillo/contraste), zoom
// y desplazamiento. Solo cortes sin comprimir.

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import JSZip from "jszip";
import {
  Loader2,
  RotateCcw,
  Save,
  Sun,
  Contrast as ContrastIcon,
  Layers,
  Box,
  RectangleHorizontal,
  RectangleVertical,
  Move,
} from "lucide-react";
import toast from "react-hot-toast";
import { fetchWithCache, getDecodedSlices, putDecodedSlices } from "@/lib/dicom-cache";
import { decodeSlice, isDicomEntryName, type DecodedSlice } from "./dicom-decode-core";
import type { VolSlice } from "./Dicom3DVolume";

// Render volumétrico 3D (three.js). Dinámico para no cargar el shader hasta que
// el usuario abre la vista 3D.
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

// Cortes ya decodificados (HU en Int16) del worker o del fallback: reusamos el
// tipo del núcleo de decodificación compartido.
type Slice = DecodedSlice;

type ViewMode = "axial" | "coronal" | "sagittal" | "volume";

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: "axial", label: "Axial" },
  { key: "coronal", label: "Coronal" },
  { key: "sagittal", label: "Sagital" },
  { key: "volume", label: "Volumen 3D" },
];

function viewIcon(key: ViewMode) {
  if (key === "axial") return <Layers className="w-3.5 h-3.5" aria-hidden />;
  if (key === "coronal") return <RectangleHorizontal className="w-3.5 h-3.5" aria-hidden />;
  if (key === "sagittal") return <RectangleVertical className="w-3.5 h-3.5" aria-hidden />;
  return <Box className="w-3.5 h-3.5" aria-hidden />;
}

type DecodeProgress = (done: number, total: number) => void;

// Crea el worker de decodificación. El bundler de Next (webpack 5) emite el
// worker como un chunk aparte gracias a new URL(..., import.meta.url). Devuelve
// null si el entorno no soporta workers (entonces se decodifica en el hilo
// principal).
function createDecodeWorker(): Worker | null {
  try {
    if (typeof window === "undefined" || typeof Worker === "undefined") return null;
    return new Worker(new URL("./dicom-decode.worker.ts", import.meta.url));
  } catch {
    return null;
  }
}

// Decodifica el set en un Web Worker (jszip + dicom-parser fuera del hilo
// principal). Rechaza si el worker no se puede crear o falla, para que el
// llamador caiga al fallback en hilo principal. onWorker expone el worker para
// poder terminarlo si el componente se desmonta a media decodificación.
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
    // El Blob se clona por referencia (no copia los bytes pesados al worker).
    worker.postMessage({ type: "decode", blob });
  });
}

// Fallback en hilo principal: el mismo trabajo, pero cediendo el hilo cada 2
// cortes para no congelar la UI (peor que el worker, pero siempre disponible).
// Se usa si el worker no bundlea/instancia o falla en runtime.
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
      // decodeSlice devuelve un array de cortes (1 normal, >1 multi-frame).
      const s = decodeSlice(buf, done);
      if (s) out.push(...s);
    } catch {
      /* corte inválido: se salta */
    }
    done++;
    if (done % 2 === 0 || done === total) {
      onProgress(done, total);
      await new Promise((r) => setTimeout(r, 0)); // cede el hilo
    }
  }
  return out;
}

export default function DicomSetViewer({ url, name, fileId, patientId, initialNotes = "" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [slices, setSlices] = useState<Slice[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "empty">("loading");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [view, setView] = useState<ViewMode>("volume"); // abre en 3D por defecto
  const [idx, setIdx] = useState(0); // Z para axial
  const [coronalY, setCoronalY] = useState(0); // Y para coronal
  const [sagittalX, setSagittalX] = useState(0); // X para sagital
  const [center, setCenter] = useState(0);
  const [width, setWidth] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [notes, setNotes] = useState(initialNotes);
  const [savingNotes, setSavingNotes] = useState(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const defaultWin = useRef({ c: 0, w: 1 });

  // La signed URL cambia en cada apertura (TTL corto); el fileId es estable. El
  // efecto se re-ejecuta por fileId, NO por url, para no re-decodificar al
  // reabrir el mismo estudio. urlRef da la última url para un miss de cache.
  const urlRef = useRef(url);
  urlRef.current = url;

  // Carga el set: 1) cache de cortes decodificados → 2) descarga del .zip (cache
  // de blobs) → 3) decode en Web Worker (con fallback al hilo principal) → 4)
  // cachea el decodificado. Salvo el fallback, nada de esto corre en el main thread.
  useEffect(() => {
    let cancelled = false;
    let activeWorker: Worker | null = null;
    const isCancelled = () => cancelled;

    const finalize = (arr: Slice[]) => {
      arr.sort((a, b) => a.order - b.order);
      const mid = Math.floor(arr.length / 2);
      defaultWin.current = { c: arr[mid].center, w: arr[mid].width };
      setSlices(arr);
      setIdx(mid);
      setCoronalY(Math.floor(arr[0].rows / 2));
      setSagittalX(Math.floor(arr[0].cols / 2));
      setView("volume"); // muestra el volumen 3D primero al abrir el estudio
      setCenter(arr[mid].center);
      setWidth(arr[mid].width);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setStatus("ready");
    };

    setStatus("loading");
    setProgress({ done: 0, total: 0 });
    (async () => {
      try {
        // 1) ¿Cortes ya decodificados en cache (IndexedDB por fileId)? Salta
        //    descarga + descompresión + decodificación por completo.
        const cachedSlices = await getDecodedSlices(fileId);
        if (cancelled) return;
        if (cachedSlices && cachedSlices.length > 0) {
          finalize(cachedSlices as Slice[]);
          return;
        }

        // 2) Descarga el .zip (cache de blobs por fileId; evita re-pegarle a
        //    Supabase y ahorra egress).
        const blob = await fetchWithCache(fileId, urlRef.current);
        if (cancelled) return;

        // 3) Decodifica en Web Worker (fuera del hilo principal). Si el worker no
        //    está disponible o falla, cae al hilo principal con cesión fina.
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
        // 4) Cachea el decodificado (best-effort) para próximas aperturas.
        void putDecodedSlices(fileId, decoded);
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      activeWorker?.terminate();
    };
    // Depende de fileId (estable), no de url: ver urlRef arriba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // Pinta la vista 2D activa (axial / coronal / sagital) con el mismo
  // window/level, RESPETANDO el espaciado físico (mm) del estudio: cada plano se
  // rasteriza con proporciones reales (PixelSpacing × zSpacing) y se MUESTREA con
  // interpolación BILINEAL, así el CBCT/CT no sale deformado ni con bordes
  // escalonados entre cortes. Con espaciado isotrópico el resultado coincide con
  // muestrear por índice entero (la interpolación cae justo en píxeles nativos).
  useEffect(() => {
    if (status !== "ready" || slices.length === 0 || view === "volume") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cols = slices[0].cols;
    const rows = slices[0].rows;
    const depth = slices.length;
    const lo = center - width / 2;
    const span = width <= 0 ? 1 : width;
    // MONOCHROME1/2 es propiedad de la serie: el corte medio la representa.
    const inv = slices[Math.floor(depth / 2)].invert;

    // Espaciado físico (mm). Guard para cache vieja sin estos campos → isotrópico
    // (se comporta como antes, sin corrección, en vez de romper).
    const sp = slices[0].pixelSpacing;
    const sx = sp && sp[0] > 0 ? sp[0] : 1; // mm por columna (eje X)
    const sy = sp && sp[1] > 0 ? sp[1] : 1; // mm por fila (eje Y)
    const zRaw = slices[0].zSpacing;
    const sz = zRaw && zRaw > 0 ? zRaw : sy; // mm entre cortes (eje Z)

    // HU → gris [0,255] con window/level + invert MONOCHROME1.
    const toGray = (hu: number) => {
      let g = ((hu - lo) / span) * 255;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      return inv ? 255 - g : g;
    };

    // Tamaño del raster de salida: 1 px = el espaciado más fino del plano, para
    // no perder resolución nativa y dar proporciones físicas reales. Acotado a
    // MAXDIM por lado (rendimiento; el lienzo se reescala al contenedor igual).
    const MAXDIM = 1024;
    const raster = (nA: number, sA: number, nB: number, sB: number) => {
      const pmm = Math.min(sA, sB) || 1;
      let W = Math.max(1, Math.round((nA * sA) / pmm));
      let H = Math.max(1, Math.round((nB * sB) / pmm));
      const m = Math.max(W, H);
      if (m > MAXDIM) {
        const k = MAXDIM / m;
        W = Math.max(1, Math.round(W * k));
        H = Math.max(1, Math.round(H * k));
      }
      return { W, H };
    };

    // Pinta un raster W×H: sample(colSalida, filaSalida) → HU interpolado.
    const paint = (W: number, H: number, sample: (a: number, b: number) => number) => {
      canvas.width = W;
      canvas.height = H;
      const img = ctx.createImageData(W, H);
      const data = img.data;
      let j = 0;
      for (let b = 0; b < H; b++) {
        for (let a = 0; a < W; a++) {
          const g = toGray(sample(a, b));
          data[j] = data[j + 1] = data[j + 2] = g;
          data[j + 3] = 255;
          j += 4;
        }
      }
      ctx.putImageData(img, 0, 0);
    };

    if (view === "axial") {
      // Plano (X,Y) en Z fijo: el corte nativo, reescalado a proporción física y
      // muestreado bilineal (corrige píxeles no cuadrados, sx != sy).
      const s = slices[Math.min(idx, depth - 1)];
      if (!s) return;
      const px = s.pixels;
      const { W, H } = raster(cols, sx, rows, sy);
      paint(W, H, (a, b) => {
        const fx = ((a + 0.5) * cols) / W - 0.5;
        const fy = ((b + 0.5) * rows) / H - 0.5;
        const x = fx < 0 ? 0 : fx > cols - 1 ? cols - 1 : fx;
        const y = fy < 0 ? 0 : fy > rows - 1 ? rows - 1 : fy;
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = x0 + 1 < cols ? x0 + 1 : x0;
        const y1 = y0 + 1 < rows ? y0 + 1 : y0;
        const tx = x - x0;
        const ty = y - y0;
        const r0 = y0 * cols;
        const r1 = y1 * cols;
        const top = px[r0 + x0] + (px[r0 + x1] - px[r0 + x0]) * tx;
        const bot = px[r1 + x0] + (px[r1 + x1] - px[r1 + x0]) * tx;
        return top + (bot - top) * ty;
      });
    } else if (view === "coronal") {
      // Plano (X,Z) en Y fijo: ancho = X (cols·sx), alto = Z (depth·sz).
      // Interpola en X y en Z (entre cortes adyacentes) → sin escalones.
      const yb = Math.min(coronalY, rows - 1) * cols;
      const { W, H } = raster(cols, sx, depth, sz);
      paint(W, H, (a, b) => {
        const fx = ((a + 0.5) * cols) / W - 0.5;
        const fz = ((b + 0.5) * depth) / H - 0.5;
        const x = fx < 0 ? 0 : fx > cols - 1 ? cols - 1 : fx;
        const z = fz < 0 ? 0 : fz > depth - 1 ? depth - 1 : fz;
        const x0 = Math.floor(x);
        const x1 = x0 + 1 < cols ? x0 + 1 : x0;
        const z0 = Math.floor(z);
        const z1 = z0 + 1 < depth ? z0 + 1 : z0;
        const tx = x - x0;
        const tz = z - z0;
        const p0 = slices[z0].pixels;
        const p1 = slices[z1].pixels;
        const top = p0[yb + x0] + (p0[yb + x1] - p0[yb + x0]) * tx;
        const bot = p1[yb + x0] + (p1[yb + x1] - p1[yb + x0]) * tx;
        return top + (bot - top) * tz;
      });
    } else if (view === "sagittal") {
      // Plano (Y,Z) en X fijo: ancho = Y (rows·sy), alto = Z (depth·sz).
      // Interpola en Y y en Z (entre cortes adyacentes) → sin escalones.
      const xf = Math.min(sagittalX, cols - 1);
      const { W, H } = raster(rows, sy, depth, sz);
      paint(W, H, (a, b) => {
        const fy = ((a + 0.5) * rows) / W - 0.5;
        const fz = ((b + 0.5) * depth) / H - 0.5;
        const y = fy < 0 ? 0 : fy > rows - 1 ? rows - 1 : fy;
        const z = fz < 0 ? 0 : fz > depth - 1 ? depth - 1 : fz;
        const y0 = Math.floor(y);
        const y1 = y0 + 1 < rows ? y0 + 1 : y0;
        const z0 = Math.floor(z);
        const z1 = z0 + 1 < depth ? z0 + 1 : z0;
        const ty = y - y0;
        const tz = z - z0;
        const p0 = slices[z0].pixels;
        const p1 = slices[z1].pixels;
        const c0 = y0 * cols + xf;
        const c1 = y1 * cols + xf;
        const left = p0[c0] + (p0[c1] - p0[c0]) * ty;
        const right = p1[c0] + (p1[c1] - p1[c0]) * ty;
        return left + (right - left) * tz;
      });
    }
  }, [status, slices, view, idx, coronalY, sagittalX, center, width]);

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

  const reset = () => {
    setCenter(defaultWin.current.c);
    setWidth(defaultWin.current.w);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Cambiar de vista centra de nuevo el plano (cada vista tiene su proporción).
  const selectView = (v: ViewMode) => {
    setView(v);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(8, Math.max(0.25, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  };
  const onDown = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const onMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setPan({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  };
  const onUp = () => {
    dragRef.current = null;
  };

  // Barra de vistas (Axial · Coronal · Sagital · Volumen 3D). Una a la vez.
  const viewBar = (
    <div
      className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border"
      role="tablist"
      aria-label="Vista del estudio CBCT"
    >
      {VIEWS.map((v) => {
        const active = view === v.key;
        return (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => selectView(v.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              active ? "bg-brand-600 text-white shadow-sm" : "text-foreground hover:bg-muted"
            }`}
          >
            {viewIcon(v.key)}
            {v.label}
          </button>
        );
      })}
    </div>
  );

  const notesPanel = (
    <div className="w-full lg:w-72 flex-shrink-0 border-t lg:border-t-0 lg:border-l border-border lg:pl-4 pt-4 lg:pt-0">
      <h4 className="text-xs font-bold text-foreground mb-2">Notas del estudio</h4>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notas clínicas sobre este CBCT…"
        rows={5}
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
      {status === "ready" && (
        <p className="text-[10px] text-muted-foreground mt-3">
          {slices.length} cortes cargados. Vistas: axial, coronal, sagital y volumen 3D.
        </p>
      )}
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
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground p-8" style={{ minHeight: 360 }}>
          <Layers className="w-10 h-10 mb-3 text-muted-foreground" />
          <p className="text-sm font-bold text-foreground">
            {status === "empty" ? "No se encontraron cortes legibles" : "No se pudo leer el set"}
          </p>
          <p className="text-xs mt-1 max-w-sm">
            {status === "empty"
              ? "El .zip no contiene cortes DICOM sin comprimir. Verifica que sea la carpeta del CBCT (archivos .dcm)."
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
        <div className="lg:w-72 p-4">{notesPanel}</div>
      </div>
    );
  }

  // status === "ready"
  const cols = slices[0].cols;
  const rows = slices[0].rows;
  const depth = slices.length;

  // Configuración del slider de posición según la vista activa.
  const pos =
    view === "coronal"
      ? { value: coronalY, set: setCoronalY, max: rows - 1, label: "Posición (Y)", current: coronalY + 1, total: rows }
      : view === "sagittal"
        ? { value: sagittalX, set: setSagittalX, max: cols - 1, label: "Posición (X)", current: sagittalX + 1, total: cols }
        : { value: idx, set: setIdx, max: depth - 1, label: "Corte (Z)", current: idx + 1, total: depth };

  const viewLabel = view === "coronal" ? "Coronal" : view === "sagittal" ? "Sagital" : "Axial";

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0">
        <div className="mb-3">{viewBar}</div>

        {view === "volume" ? (
          // Dicom3DVolume (A1) lee pixels por índice (HU), compatible con
          // Int16Array; su VolSlice aún tipa Float32Array, así que adaptamos el
          // tipo aquí sin tocar ese archivo.
          <Dicom3DVolume slices={slices as unknown as VolSlice[]} />
        ) : (
          <>
            <div
              className="relative w-full overflow-hidden rounded-lg select-none"
              style={{ height: 480, background: "#000", cursor: dragRef.current ? "grabbing" : "grab" }}
              onWheel={onWheel}
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
            >
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
              >
                <canvas
                  ref={canvasRef}
                  className="max-w-full max-h-full"
                  style={{ imageRendering: "pixelated", maxHeight: 480 }}
                />
              </div>
              <div className="absolute top-2 left-2 text-[11px] font-mono text-white/80 bg-black/50 rounded px-2 py-0.5">
                {viewLabel} · {pos.current}/{pos.total}
              </div>
            </div>

            <div className="mt-3 space-y-3 bg-muted/40 rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2">
                <Move className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden />
                <label htmlFor="cbct-pos" className="text-[11px] text-muted-foreground w-20 flex-shrink-0">
                  {pos.label}
                </label>
                <input
                  id="cbct-pos"
                  type="range"
                  min={0}
                  max={Math.max(0, pos.max)}
                  value={Math.min(pos.value, pos.max)}
                  onChange={(e) => pos.set(Number(e.target.value))}
                  className="flex-1 accent-brand-500"
                  aria-label={`${pos.label} del plano ${viewLabel}`}
                />
              </div>
              <div className="flex items-center gap-2">
                <Sun className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden />
                <label htmlFor="cbct-brightness" className="text-[11px] text-muted-foreground w-20 flex-shrink-0">
                  Brillo
                </label>
                <input
                  id="cbct-brightness"
                  type="range"
                  min={defaultWin.current.c - defaultWin.current.w * 2}
                  max={defaultWin.current.c + defaultWin.current.w * 2}
                  value={center}
                  onChange={(e) => setCenter(Number(e.target.value))}
                  className="flex-1 accent-brand-500"
                  aria-label="Brillo (centro de ventana)"
                />
              </div>
              <div className="flex items-center gap-2">
                <ContrastIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden />
                <label htmlFor="cbct-contrast" className="text-[11px] text-muted-foreground w-20 flex-shrink-0">
                  Contraste
                </label>
                <input
                  id="cbct-contrast"
                  type="range"
                  min={1}
                  max={Math.max(2, defaultWin.current.w * 4)}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  className="flex-1 accent-brand-500"
                  aria-label="Contraste (ancho de ventana)"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">
                  Scroll = zoom · arrastrar = mover · slider = plano
                </span>
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md bg-muted text-foreground border border-border hover:bg-muted/70"
                >
                  <RotateCcw className="w-3 h-3" /> Reiniciar
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {notesPanel}
    </div>
  );
}
