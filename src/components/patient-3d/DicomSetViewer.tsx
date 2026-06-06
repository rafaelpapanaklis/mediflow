"use client";
// Visor de SET CBCT: descarga el .zip del estudio, lo descomprime (jszip),
// decodifica cada corte DICOM (dicom-parser) y permite navegar TODOS los cortes
// (axial) con window/level, zoom y notas. Solo cortes sin comprimir.
//
// La reconstrucción MPR (coronal/sagital) y el render 3D volumétrico son fases
// posteriores; este visor ya da el set completo navegable en 2D.

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import JSZip from "jszip";
import dicomParser from "dicom-parser";
import { Loader2, RotateCcw, Save, Sun, Contrast as ContrastIcon, Layers, Box } from "lucide-react";
import toast from "react-hot-toast";

// Render volumétrico 3D (three.js). Dinámico para no cargar el shader hasta que
// el usuario abre el modo 3D.
const Dicom3DVolume = dynamic(() => import("./Dicom3DVolume"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center text-white/60" style={{ height: 460 }}>
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
  const [idx, setIdx] = useState(0);
  const [center, setCenter] = useState(0);
  const [width, setWidth] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [notes, setNotes] = useState(initialNotes);
  const [savingNotes, setSavingNotes] = useState(false);
  const [view3d, setView3d] = useState(false);
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

  // Pinta el corte actual.
  useEffect(() => {
    if (status !== "ready" || slices.length === 0) return;
    const s = slices[idx];
    if (!s) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = s.cols;
    canvas.height = s.rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const out = ctx.createImageData(s.cols, s.rows);
    const data = out.data;
    const lo = center - width / 2;
    const span = width <= 0 ? 1 : width;
    const len = s.rows * s.cols;
    for (let i = 0; i < len; i++) {
      let g = ((s.pixels[i] - lo) / span) * 255;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      if (s.invert) g = 255 - g;
      const j = i * 4;
      data[j] = data[j + 1] = data[j + 2] = g;
      data[j + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }, [status, slices, idx, center, width]);

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

  const notesPanel = (
    <div className="w-full lg:w-72 flex-shrink-0 border-t lg:border-t-0 lg:border-l border-white/10 lg:pl-4 pt-4 lg:pt-0">
      <h4 className="text-xs font-bold text-white/80 mb-2">Notas del estudio</h4>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notas clínicas sobre este CBCT…"
        rows={5}
        className="w-full text-sm rounded-lg bg-white/5 border border-white/15 text-white p-2 resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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
        <p className="text-[10px] text-white/40 mt-3">
          {slices.length} cortes cargados. MPR (coronal/sagital) y 3D: próximamente.
        </p>
      )}
    </div>
  );

  if (status === "loading") {
    return (
      <div className="flex flex-col items-center justify-center text-white/70" style={{ height: 480 }}>
        <Loader2 className="w-6 h-6 animate-spin mb-3" />
        <p className="text-sm">Descomprimiendo y leyendo el CBCT…</p>
        {progress.total > 0 && (
          <>
            <p className="text-xs mt-1">
              {progress.done} / {progress.total} cortes
            </p>
            <div className="w-48 h-1.5 bg-white/10 rounded-full overflow-hidden mt-2">
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
        <div className="flex-1 flex flex-col items-center justify-center text-center text-white/70 p-8" style={{ minHeight: 360 }}>
          <Layers className="w-10 h-10 mb-3 text-white/40" />
          <p className="text-sm font-bold text-white/90">
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

  const s = slices[idx];

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 mb-2">
          <button
            type="button"
            onClick={() => setView3d(false)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded inline-flex items-center gap-1 ${!view3d ? "bg-brand-600 text-white" : "bg-muted text-foreground border border-border"}`}
          >
            <Layers className="w-3 h-3" /> Cortes 2D
          </button>
          <button
            type="button"
            onClick={() => setView3d(true)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded inline-flex items-center gap-1 ${view3d ? "bg-brand-600 text-white" : "bg-muted text-foreground border border-border"}`}
          >
            <Box className="w-3 h-3" /> Volumen 3D
          </button>
        </div>
        {view3d && <Dicom3DVolume slices={slices} />}
        {!view3d && (
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
            <canvas ref={canvasRef} className="max-w-full max-h-full" style={{ imageRendering: "pixelated", maxHeight: 480 }} />
          </div>
          <div className="absolute top-2 left-2 text-[11px] font-mono text-white/70 bg-black/40 rounded px-2 py-0.5">
            Corte {idx + 1}/{slices.length}
          </div>
        </div>

        <div className="mt-3 space-y-3 bg-white/5 rounded-lg p-3 border border-white/10">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-white/60 flex-shrink-0" aria-hidden />
            <label className="text-[11px] text-white/70 w-16 flex-shrink-0">Corte</label>
            <input
              type="range"
              min={0}
              max={slices.length - 1}
              value={idx}
              onChange={(e) => setIdx(Number(e.target.value))}
              className="flex-1 accent-brand-500"
              aria-label="Navegar cortes del CBCT"
            />
          </div>
          <div className="flex items-center gap-2">
            <Sun className="w-4 h-4 text-white/60 flex-shrink-0" aria-hidden />
            <label className="text-[11px] text-white/70 w-16 flex-shrink-0">Brillo</label>
            <input
              type="range"
              min={defaultWin.current.c - defaultWin.current.w * 2}
              max={defaultWin.current.c + defaultWin.current.w * 2}
              value={center}
              onChange={(e) => setCenter(Number(e.target.value))}
              className="flex-1 accent-brand-500"
              aria-label="Brillo"
            />
          </div>
          <div className="flex items-center gap-2">
            <ContrastIcon className="w-4 h-4 text-white/60 flex-shrink-0" aria-hidden />
            <label className="text-[11px] text-white/70 w-16 flex-shrink-0">Contraste</label>
            <input
              type="range"
              min={1}
              max={Math.max(2, defaultWin.current.w * 4)}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="flex-1 accent-brand-500"
              aria-label="Contraste"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/40">Scroll = zoom · arrastrar = mover · slider = cortes</span>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md bg-white/10 text-white/80 hover:bg-white/20"
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
