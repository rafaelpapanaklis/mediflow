"use client";
// Visor DICOM 2D. Decodifica un archivo .dcm SIN comprimir (Implicit/Explicit VR
// Little/Big Endian) con dicom-parser y lo pinta a un <canvas> aplicando
// window/level (brillo/contraste), con zoom, paneo y navegación de frames.
// Para DICOM comprimido (JPEG/JPEG2000) o a color muestra un aviso + descarga.
// Incluye panel de Notas del modelo (PatientFile.doctorNotes) como el visor 3D.
//
// Nota: este es el visor 2D (cortes). El render volumétrico 3D / MPR de sets
// completos de CBCT es una fase posterior.

import { useCallback, useEffect, useRef, useState } from "react";
import dicomParser from "dicom-parser";
import { Download, Loader2, RotateCcw, Save, Sun, Contrast as ContrastIcon, Layers } from "lucide-react";
import toast from "react-hot-toast";

interface Props {
  url: string;
  name: string;
  fileId: string;
  patientId: string;
  initialNotes?: string;
}

// Transfer syntaxes sin comprimir que podemos pintar pixel a pixel.
const UNCOMPRESSED = new Set([
  "1.2.840.10008.1.2",   // Implicit VR Little Endian
  "1.2.840.10008.1.2.1", // Explicit VR Little Endian
  "1.2.840.10008.1.2.2", // Explicit VR Big Endian
]);

interface DicomImage {
  rows: number;
  cols: number;
  pixels: Float32Array; // valores con rescale (slope/intercept) aplicado
  frames: number;
  frameLen: number; // rows * cols
  defaultCenter: number;
  defaultWidth: number;
  invert: boolean; // MONOCHROME1
}

function firstNum(s: string | undefined, fallback: number): number {
  if (!s) return fallback;
  const v = parseFloat(s.split("\\")[0]);
  return Number.isFinite(v) ? v : fallback;
}

function decodeDicom(buf: ArrayBuffer): DicomImage {
  const byteArray = new Uint8Array(buf);
  const ds = dicomParser.parseDicom(byteArray);

  const transfer = (ds.string("x00020010") || "1.2.840.10008.1.2.1").trim();
  if (!UNCOMPRESSED.has(transfer)) {
    throw Object.assign(new Error("compressed"), { code: "compressed" });
  }

  const rows = ds.uint16("x00280010") || 0;
  const cols = ds.uint16("x00280011") || 0;
  if (!rows || !cols) throw new Error("no-dims");

  const samplesPerPixel = ds.uint16("x00280002") || 1;
  if (samplesPerPixel !== 1) {
    throw Object.assign(new Error("color"), { code: "color" }); // solo escala de grises por ahora
  }

  const bitsAllocated = ds.uint16("x00280100") || 16;
  const pixelRepresentation = ds.uint16("x00280103") || 0; // 0=unsigned, 1=signed
  const photometric = (ds.string("x00280004") || "MONOCHROME2").trim();
  const invert = photometric === "MONOCHROME1";
  const slope = firstNum(ds.string("x00281053"), 1) || 1;
  const intercept = firstNum(ds.string("x00281052"), 0);
  const frames = Math.max(1, parseInt(ds.string("x00280008") || "1", 10) || 1);

  const pixelEl = ds.elements.x7fe00010;
  if (!pixelEl) throw new Error("no-pixels");

  const frameLen = rows * cols;
  const total = frameLen * frames;
  const out = new Float32Array(total);
  let minV = Infinity;
  let maxV = -Infinity;

  if (bitsAllocated === 16) {
    // slice() para garantizar alineación a 2 bytes (evita RangeError).
    const slice = byteArray.buffer.slice(pixelEl.dataOffset, pixelEl.dataOffset + pixelEl.length);
    const raw = pixelRepresentation === 1 ? new Int16Array(slice) : new Uint16Array(slice);
    const n = Math.min(total, raw.length);
    for (let i = 0; i < n; i++) {
      const v = raw[i] * slope + intercept;
      out[i] = v;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  } else {
    const raw = byteArray.subarray(pixelEl.dataOffset, pixelEl.dataOffset + pixelEl.length);
    const n = Math.min(total, raw.length);
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

  return { rows, cols, pixels: out, frames, frameLen, defaultCenter: dc, defaultWidth: dw, invert };
}

export default function DicomViewer2D({ url, name, fileId, patientId, initialNotes = "" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [img, setImg] = useState<DicomImage | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "unsupported">("loading");
  const [center, setCenter] = useState(0);
  const [width, setWidth] = useState(1);
  const [frame, setFrame] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [notes, setNotes] = useState(initialNotes);
  const [savingNotes, setSavingNotes] = useState(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // Carga + decodifica.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("fetch");
        const buf = await res.arrayBuffer();
        const decoded = decodeDicom(buf);
        if (cancelled) return;
        setImg(decoded);
        setCenter(decoded.defaultCenter);
        setWidth(decoded.defaultWidth);
        setFrame(0);
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setStatus("ready");
      } catch (e: any) {
        if (cancelled) return;
        setStatus(e?.code === "compressed" || e?.code === "color" ? "unsupported" : "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Pinta el frame actual con la ventana actual.
  useEffect(() => {
    if (status !== "ready" || !img) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = img.cols;
    canvas.height = img.rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const out = ctx.createImageData(img.cols, img.rows);
    const data = out.data;
    const lo = center - width / 2;
    const span = width <= 0 ? 1 : width;
    const base = frame * img.frameLen;
    for (let i = 0; i < img.frameLen; i++) {
      let g = ((img.pixels[base + i] - lo) / span) * 255;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      if (img.invert) g = 255 - g;
      const j = i * 4;
      data[j] = data[j + 1] = data[j + 2] = g;
      data[j + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }, [status, img, center, width, frame]);

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
    if (!img) return;
    setCenter(img.defaultCenter);
    setWidth(img.defaultWidth);
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
      <h4 className="text-xs font-bold text-white/80 mb-2">Notas del modelo</h4>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notas clínicas sobre este estudio…"
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
    </div>
  );

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center text-white/70" style={{ height: 480 }}>
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando DICOM…
      </div>
    );
  }

  if (status === "error" || status === "unsupported") {
    return (
      <div className="flex flex-col lg:flex-row gap-4" style={{ background: "#0b0d11" }}>
        <div className="flex-1 flex flex-col items-center justify-center text-center text-white/70 p-8" style={{ minHeight: 360 }}>
          <Layers className="w-10 h-10 mb-3 text-white/40" />
          <p className="text-sm font-bold text-white/90">
            {status === "unsupported" ? "DICOM comprimido o a color" : "No se pudo leer el DICOM"}
          </p>
          <p className="text-xs mt-1 max-w-sm">
            {status === "unsupported"
              ? "Este archivo usa una compresión (JPEG/JPEG2000) o color que el visor 2D aún no decodifica. Puedes descargarlo y abrirlo en tu visor DICOM."
              : "El archivo no pudo decodificarse. Descárgalo para abrirlo en un visor DICOM externo."}
          </p>
          <a
            href={url}
            download={name}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 mt-4"
          >
            <Download className="w-3.5 h-3.5" /> Descargar archivo
          </a>
        </div>
        <div className="lg:w-72 p-4">{notesPanel}</div>
      </div>
    );
  }

  // ready
  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Lienzo */}
      <div className="flex-1 min-w-0">
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
        </div>

        {/* Controles */}
        <div className="mt-3 space-y-3 bg-white/5 rounded-lg p-3 border border-white/10">
          <div className="flex items-center gap-2">
            <Sun className="w-4 h-4 text-white/60 flex-shrink-0" aria-hidden />
            <label className="text-[11px] text-white/70 w-16 flex-shrink-0">Brillo</label>
            <input
              type="range"
              min={img ? img.defaultCenter - img.defaultWidth * 2 : 0}
              max={img ? img.defaultCenter + img.defaultWidth * 2 : 255}
              value={center}
              onChange={(e) => setCenter(Number(e.target.value))}
              className="flex-1 accent-brand-500"
              aria-label="Brillo (window center)"
            />
          </div>
          <div className="flex items-center gap-2">
            <ContrastIcon className="w-4 h-4 text-white/60 flex-shrink-0" aria-hidden />
            <label className="text-[11px] text-white/70 w-16 flex-shrink-0">Contraste</label>
            <input
              type="range"
              min={1}
              max={img ? Math.max(2, img.defaultWidth * 4) : 255}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="flex-1 accent-brand-500"
              aria-label="Contraste (window width)"
            />
          </div>
          {img && img.frames > 1 && (
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-white/60 flex-shrink-0" aria-hidden />
              <label className="text-[11px] text-white/70 w-16 flex-shrink-0">
                Corte {frame + 1}/{img.frames}
              </label>
              <input
                type="range"
                min={0}
                max={img.frames - 1}
                value={frame}
                onChange={(e) => setFrame(Number(e.target.value))}
                className="flex-1 accent-brand-500"
                aria-label="Navegar cortes"
              />
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/40">Scroll = zoom · arrastrar = mover</span>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md bg-white/10 text-white/80 hover:bg-white/20"
            >
              <RotateCcw className="w-3 h-3" /> Reiniciar
            </button>
          </div>
        </div>
      </div>

      {notesPanel}
    </div>
  );
}
