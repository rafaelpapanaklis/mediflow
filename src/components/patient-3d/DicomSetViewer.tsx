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
import dicomParser from "dicom-parser";
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

interface Slice {
  rows: number;
  cols: number;
  pixels: Float32Array;
  center: number;
  width: number;
  invert: boolean;
  order: number;
}

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

const UNCOMPRESSED = new Set([
  "1.2.840.10008.1.2",
  "1.2.840.10008.1.2.1",
  "1.2.840.10008.1.2.2",
]);

function firstNum(s: string | undefined, fallback: number): number {
  if (!s) return fallback;
  const v = parseFloat(s.split("\\")[0]);
  return Number.isFinite(v) ? v : fallback;
}

// Decodifica un corte. Devuelve null si está comprimido, a color o es inválido
// (lo saltamos sin romper el set).
function decodeSlice(buf: ArrayBuffer, fallbackOrder: number): Slice | null {
  try {
    const byteArray = new Uint8Array(buf);
    const ds = dicomParser.parseDicom(byteArray);
    const transfer = (ds.string("x00020010") || "1.2.840.10008.1.2.1").trim();
    if (!UNCOMPRESSED.has(transfer)) return null;

    const rows = ds.uint16("x00280010") || 0;
    const cols = ds.uint16("x00280011") || 0;
    if (!rows || !cols) return null;
    if ((ds.uint16("x00280002") || 1) !== 1) return null; // solo grises

    const bitsAllocated = ds.uint16("x00280100") || 16;
    const signed = (ds.uint16("x00280103") || 0) === 1;
    const invert = (ds.string("x00280004") || "MONOCHROME2").trim() === "MONOCHROME1";
    const slope = firstNum(ds.string("x00281053"), 1) || 1;
    const intercept = firstNum(ds.string("x00281052"), 0);

    const el = ds.elements.x7fe00010;
    if (!el) return null;
    const frameLen = rows * cols;
    const out = new Float32Array(frameLen);
    let minV = Infinity;
    let maxV = -Infinity;

    if (bitsAllocated === 16) {
      const slice = byteArray.buffer.slice(el.dataOffset, el.dataOffset + el.length);
      const raw = signed ? new Int16Array(slice) : new Uint16Array(slice);
      const n = Math.min(frameLen, raw.length);
      for (let i = 0; i < n; i++) {
        const v = raw[i] * slope + intercept;
        out[i] = v;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    } else {
      const raw = byteArray.subarray(el.dataOffset, el.dataOffset + el.length);
      const n = Math.min(frameLen, raw.length);
      for (let i = 0; i < n; i++) {
        const v = raw[i] * slope + intercept;
        out[i] = v;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
    if (!Number.isFinite(minV)) {
      minV = 0;
      maxV = 255;
    }

    let dc = firstNum(ds.string("x00281050"), NaN);
    let dw = firstNum(ds.string("x00281051"), NaN);
    if (!Number.isFinite(dc) || !Number.isFinite(dw) || dw <= 0) {
      dc = (minV + maxV) / 2;
      dw = Math.max(1, maxV - minV);
    }

    // Orden: InstanceNumber (x00200013) o, si no, posición Z (x00200032 z).
    let order = parseInt(ds.string("x00200013") || "", 10);
    if (!Number.isFinite(order)) {
      const pos = ds.string("x00200032");
      order = pos ? firstNum(pos.split("\\")[2], fallbackOrder) : fallbackOrder;
    }

    return { rows, cols, pixels: out, center: dc, width: dw, invert, order };
  } catch {
    return null;
  }
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

  // Descarga + descomprime + decodifica el set.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("fetch");
        const blob = await res.blob();
        const zip = await JSZip.loadAsync(blob);
        const entries = Object.values(zip.files).filter(
          (f: any) => !f.dir && (/\.(dcm|dicom)$/i.test(f.name) || !/\.[a-z0-9]+$/i.test(f.name)),
        );
        if (cancelled) return;
        setProgress({ done: 0, total: entries.length });

        const out: Slice[] = [];
        let done = 0;
        for (const entry of entries as any[]) {
          if (cancelled) return;
          try {
            const buf = await entry.async("arraybuffer");
            const s = decodeSlice(buf, done);
            if (s) out.push(s);
          } catch {
            /* corte inválido: se salta */
          }
          done++;
          if (done % 8 === 0) {
            setProgress({ done, total: entries.length });
            await new Promise((r) => setTimeout(r, 0)); // cede el hilo (no congela la UI)
          }
        }
        if (cancelled) return;
        if (out.length === 0) {
          setStatus("empty");
          return;
        }
        out.sort((a, b) => a.order - b.order);
        const mid = Math.floor(out.length / 2);
        defaultWin.current = { c: out[mid].center, w: out[mid].width };
        setSlices(out);
        setIdx(mid);
        setCoronalY(Math.floor(out[0].rows / 2));
        setSagittalX(Math.floor(out[0].cols / 2));
        setView("volume"); // muestra el volumen 3D primero al abrir el estudio
        setCenter(out[mid].center);
        setWidth(out[mid].width);
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Pinta la vista 2D activa (axial / coronal / sagital) con el mismo
  // window/level. Cada plano MPR es un re-muestreo 2D del volumen, de tamaño
  // comparable a un corte axial, así que se pinta de forma síncrona.
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

    if (view === "axial") {
      // Plano (X,Y) en Z fijo: el corte nativo.
      const s = slices[Math.min(idx, depth - 1)];
      if (!s) return;
      canvas.width = s.cols;
      canvas.height = s.rows;
      const img = ctx.createImageData(s.cols, s.rows);
      const data = img.data;
      const len = s.cols * s.rows;
      for (let i = 0; i < len; i++) {
        let g = ((s.pixels[i] - lo) / span) * 255;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        if (s.invert) g = 255 - g;
        const j = i * 4;
        data[j] = data[j + 1] = data[j + 2] = g;
        data[j + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    } else if (view === "coronal") {
      // Plano (X,Z) en Y fijo: ancho = cols, alto = depth.
      // pixel(x,z) = slices[z].pixels[Yfijo*cols + x]
      const y = Math.min(coronalY, rows - 1);
      canvas.width = cols;
      canvas.height = depth;
      const img = ctx.createImageData(cols, depth);
      const data = img.data;
      const yBase = y * cols;
      for (let z = 0; z < depth; z++) {
        const px = slices[z].pixels;
        const rowOff = z * cols;
        for (let x = 0; x < cols; x++) {
          let g = ((px[yBase + x] - lo) / span) * 255;
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          if (inv) g = 255 - g;
          const j = (rowOff + x) * 4;
          data[j] = data[j + 1] = data[j + 2] = g;
          data[j + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    } else if (view === "sagittal") {
      // Plano (Y,Z) en X fijo: ancho = rows, alto = depth.
      // pixel(y,z) = slices[z].pixels[y*cols + Xfijo]
      const x = Math.min(sagittalX, cols - 1);
      canvas.width = rows;
      canvas.height = depth;
      const img = ctx.createImageData(rows, depth);
      const data = img.data;
      for (let z = 0; z < depth; z++) {
        const px = slices[z].pixels;
        const rowOff = z * rows;
        for (let y = 0; y < rows; y++) {
          let g = ((px[y * cols + x] - lo) / span) * 255;
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          if (inv) g = 255 - g;
          const j = (rowOff + y) * 4;
          data[j] = data[j + 1] = data[j + 2] = g;
          data[j + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
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
          <Dicom3DVolume slices={slices} />
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
