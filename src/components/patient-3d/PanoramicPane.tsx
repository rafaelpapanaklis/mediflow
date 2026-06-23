"use client";
// Modo PANORÁMICA del visor CBCT — F4, pieza 1. Dos lienzos lado a lado:
//   1) AXIAL de trazado: el corte axial (con el mismo window/level y presets del
//      visor) sobre el que el usuario dibuja la curva de la ARCADA con puntos de
//      control (clic = añadir · arrastrar = mover · clic derecho = borrar). El
//      spline Catmull-Rom y la banda del slab se dibujan en un overlay.
//   2) PANORÁMICA: la reconstrucción curva generada (reslice del volumen siguiendo
//      la arcada). Eje horizontal = longitud de arco en mm (escala real); eje
//      vertical = altura Z del volumen. Slab (grosor bucco-lingual) ajustable, en
//      MIP o PROMEDIO.
//
// REUSA el volumen ya cargado (no recarga el .zip) y el MISMO mapeo vóxel↔mundo que
// la cruz del MPR (ver panoramic-reslice.ts). El window/level se aplica al PINTAR,
// así que mover el brillo NO re-resamplea (solo regenerar la curva/slab lo hace).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Eraser, RefreshCw, Layers, Spline, Ruler } from "lucide-react";
import type { Slice, ScaleInfo } from "./cbct-mpr-shared";
import { planeGeom } from "./cbct-mpr-shared";
import {
  densify,
  reslicePanoramic,
  sampleAtArc,
  type PanoResult,
  type SlabMode,
  type Vec2,
  type VolumeRef,
} from "./panoramic-reslice";

interface Props {
  slices: Slice[];
  scale: ScaleInfo;
  center: number;
  width: number;
  initialZ: number; // corte axial inicial (la cruz del MPR)
}

const SPLINE_COLOR = "#fbbf24"; // amber-400 (igual que el plano axial del MPR)
const POINT_COLOR = "#ffffff";
const SLAB_BAND_COLOR = "rgba(56,189,248,0.55)"; // sky-400, banda del grosor
const BG = [12, 12, 14] as const; // fondo "fuera del volumen" en la pano

// Distancia de un punto P a un segmento AB (en el mismo espacio, p.ej. raster px).
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export default function PanoramicPane({ slices, scale, center, width, initialZ }: Props) {
  const axialRef = useRef<HTMLCanvasElement | null>(null);
  const axialOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const panoRef = useRef<HTMLCanvasElement | null>(null);
  const panoOverlayRef = useRef<HTMLCanvasElement | null>(null);

  const cols = slices.length ? slices[0].cols : 0;
  const rows = slices.length ? slices[0].rows : 0;
  const depth = slices.length;

  const geom = useMemo(() => planeGeom(cols, rows, depth, "axial", scale), [cols, rows, depth, scale]);

  const [axialZ, setAxialZ] = useState(() => Math.min(Math.max(initialZ, 0), Math.max(depth - 1, 0)));
  // Puntos de control en VÓXEL continuo del plano axial (x∈[0,cols-1], y∈[0,rows-1]).
  const [controlVox, setControlVox] = useState<Vec2[]>([]);
  const [slabMm, setSlabMm] = useState(10);
  const [mode, setMode] = useState<SlabMode>("mip");
  const [pano, setPano] = useState<PanoResult | null>(null);
  const [stale, setStale] = useState(false);
  const [generating, setGenerating] = useState(false);

  const dragIdx = useRef<number | null>(null);

  const invert = slices.length ? slices[Math.floor(depth / 2)].invert : false;

  /* ----------------------- mapeos vóxel ↔ raster ↔ mundo ------------------- */
  const rasterOfVox = (vox: number, n: number, dim: number) => ((vox + 0.5) * dim) / n - 0.5;
  const voxOfRaster = (coord: number, dim: number, n: number) => {
    let v = ((coord + 0.5) * n) / dim - 0.5;
    if (v < 0) v = 0;
    else if (v > n - 1) v = n - 1;
    return v;
  };
  // mundo (mm) → raster (para que el overlay coincida EXACTO con el reslice en mm).
  const mmToRasterX = useCallback(
    (mm: number) => (geom ? rasterOfVox(mm / scale.sx, cols, geom.W) : 0),
    [geom, scale.sx, cols],
  );
  const mmToRasterY = useCallback(
    (mm: number) => (geom ? rasterOfVox(mm / scale.sy, rows, geom.H) : 0),
    [geom, scale.sy, rows],
  );

  const controlMm = useMemo<Vec2[]>(
    () => controlVox.map((p) => ({ x: p.x * scale.sx, y: p.y * scale.sy })),
    [controlVox, scale.sx, scale.sy],
  );

  /* --------------------------- pintar el AXIAL ----------------------------- */
  useEffect(() => {
    if (!geom || slices.length === 0) return;
    const canvas = axialRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { W, H } = geom;
    const c = cols;
    const r = rows;
    const lo = center - width / 2;
    const span = width <= 0 ? 1 : width;
    const s = slices[Math.min(Math.max(axialZ, 0), depth - 1)];
    if (!s) return;
    const px = s.pixels;
    const toGray = (v: number) => {
      let g = ((v - lo) / span) * 255;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      return invert ? 255 - g : g;
    };
    canvas.width = W;
    canvas.height = H;
    const img = ctx.createImageData(W, H);
    const data = img.data;
    let j = 0;
    for (let b = 0; b < H; b++) {
      const fy = ((b + 0.5) * r) / H - 0.5;
      const y = fy < 0 ? 0 : fy > r - 1 ? r - 1 : fy;
      const y0 = Math.floor(y);
      const y1 = y0 + 1 < r ? y0 + 1 : y0;
      const ty = y - y0;
      const row0 = y0 * c;
      const row1 = y1 * c;
      for (let a = 0; a < W; a++) {
        const fx = ((a + 0.5) * c) / W - 0.5;
        const x = fx < 0 ? 0 : fx > c - 1 ? c - 1 : fx;
        const x0 = Math.floor(x);
        const x1 = x0 + 1 < c ? x0 + 1 : x0;
        const tx = x - x0;
        const top = px[row0 + x0] + (px[row0 + x1] - px[row0 + x0]) * tx;
        const bot = px[row1 + x0] + (px[row1 + x1] - px[row1 + x0]) * tx;
        const g = toGray(top + (bot - top) * ty);
        data[j] = data[j + 1] = data[j + 2] = g;
        data[j + 3] = 255;
        j += 4;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [geom, slices, axialZ, center, width, cols, rows, depth, invert]);

  /* ----------------- overlay del axial: curva + puntos + slab -------------- */
  useEffect(() => {
    const cv = axialOverlayRef.current;
    if (!cv || !geom) return;
    const { W, H } = geom;
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (controlVox.length === 0) return;
    const lw = Math.max(1.5, Math.min(W, H) / 320);
    const dotR = Math.max(3, Math.min(W, H) / 130);

    // Banda del slab (±slab/2 a lo largo de la normal) cuando hay curva trazable.
    if (controlVox.length >= 2 && slabMm > 0) {
      const poly = densify(controlMm, 16);
      const half = slabMm / 2;
      const steps = 80;
      ctx.strokeStyle = SLAB_BAND_COLOR;
      ctx.lineWidth = lw;
      ctx.setLineDash([lw * 3, lw * 3]);
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const { pos, tan } = sampleAtArc(poly, (i / steps) * poly.total);
          const nx = -tan.y;
          const ny = tan.x;
          const mx = pos.x + sign * half * nx;
          const my = pos.y + sign * half * ny;
          const rx = mmToRasterX(mx);
          const ry = mmToRasterY(my);
          if (i === 0) ctx.moveTo(rx, ry);
          else ctx.lineTo(rx, ry);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Spline de la arcada (en mm → raster, idéntico al que se resamplea).
    if (controlVox.length >= 2) {
      const dense = densify(controlMm, 24).pts;
      ctx.strokeStyle = SPLINE_COLOR;
      ctx.lineWidth = lw + 1;
      ctx.beginPath();
      for (let i = 0; i < dense.length; i++) {
        const rx = mmToRasterX(dense[i].x);
        const ry = mmToRasterY(dense[i].y);
        if (i === 0) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.stroke();
    }

    // Puntos de control (numerados implícitamente por orden).
    for (let i = 0; i < controlVox.length; i++) {
      const rx = rasterOfVox(controlVox[i].x, cols, W);
      const ry = rasterOfVox(controlVox[i].y, rows, H);
      ctx.beginPath();
      ctx.fillStyle = POINT_COLOR;
      ctx.arc(rx, ry, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, lw);
      ctx.strokeStyle = SPLINE_COLOR;
      ctx.stroke();
    }
  }, [geom, controlVox, controlMm, slabMm, cols, rows, mmToRasterX, mmToRasterY]);

  /* --------------------------- pintar la PANO ------------------------------ */
  useEffect(() => {
    const canvas = panoRef.current;
    if (!canvas || !pano) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { data, W, H } = pano;
    const lo = center - width / 2;
    const span = width <= 0 ? 1 : width;
    canvas.width = W;
    canvas.height = H;
    const img = ctx.createImageData(W, H);
    const out = img.data;
    let j = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (Number.isNaN(v)) {
        out[j] = BG[0];
        out[j + 1] = BG[1];
        out[j + 2] = BG[2];
      } else {
        let g = ((v - lo) / span) * 255;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        if (invert) g = 255 - g;
        out[j] = out[j + 1] = out[j + 2] = g;
      }
      out[j + 3] = 255;
      j += 4;
    }
    ctx.putImageData(img, 0, 0);

    // Regla de mm sobre la pano (escala real): minor 10 mm, major + etiqueta 50 mm.
    const ov = panoOverlayRef.current;
    if (ov) {
      if (ov.width !== W) ov.width = W;
      if (ov.height !== H) ov.height = H;
      const octx = ov.getContext("2d");
      if (octx) {
        octx.clearRect(0, 0, W, H);
        const pxPerMm = 1 / pano.pxMm;
        const fontPx = Math.max(9, Math.round(Math.min(W, H) / 45));
        octx.font = `${fontPx}px ui-monospace, monospace`;
        octx.textBaseline = "bottom";
        for (let mm = 0; mm <= pano.totalArcMm + 0.001; mm += 10) {
          const x = mm * pxPerMm;
          if (x > W) break;
          const major = mm % 50 === 0;
          octx.strokeStyle = major ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.28)";
          octx.lineWidth = 1;
          const tick = major ? Math.min(H, fontPx * 1.6) : fontPx * 0.8;
          octx.beginPath();
          octx.moveTo(x + 0.5, H);
          octx.lineTo(x + 0.5, H - tick);
          octx.stroke();
          if (major && mm > 0) {
            octx.fillStyle = "rgba(255,255,255,0.85)";
            octx.fillText(`${mm}`, x + 2, H - tick);
          }
        }
      }
    }
  }, [pano, center, width, invert]);

  // Cualquier cambio que afecte el reslice marca la pano como desactualizada.
  useEffect(() => {
    if (pano) setStale(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlVox, slabMm, mode]);

  /* ------------------------------ interacción ------------------------------ */
  const rasterAt = (clientX: number, clientY: number): { a: number; b: number; ratio: number } | null => {
    const cv = axialRef.current;
    if (!cv || cv.width === 0 || cv.height === 0) return null;
    const rect = cv.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    let a = ((clientX - rect.left) / rect.width) * cv.width;
    let b = ((clientY - rect.top) / rect.height) * cv.height;
    a = a < 0 ? 0 : a > cv.width ? cv.width : a;
    b = b < 0 ? 0 : b > cv.height ? cv.height : b;
    return { a, b, ratio: cv.width / rect.width };
  };

  const nearestControl = (a: number, b: number, tolRaster: number): number => {
    if (!geom) return -1;
    const { W, H } = geom;
    let best = -1;
    let bestD = tolRaster;
    for (let i = 0; i < controlVox.length; i++) {
      const rx = rasterOfVox(controlVox[i].x, cols, W);
      const ry = rasterOfVox(controlVox[i].y, rows, H);
      const d = Math.hypot(a - rx, b - ry);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // solo botón izquierdo (derecho = borrar)
    const p = rasterAt(e.clientX, e.clientY);
    if (!p || !geom) return;
    const { W, H } = geom;
    const tol = 12 * p.ratio;

    // 1) ¿sobre un punto existente? → arrastrar.
    const hit = nearestControl(p.a, p.b, tol);
    if (hit >= 0) {
      dragIdx.current = hit;
      return;
    }
    // 2) ¿sobre un segmento del trazo? → insertar entre esos dos puntos.
    if (controlVox.length >= 2) {
      let segBest = -1;
      let segD = tol;
      for (let i = 0; i < controlVox.length - 1; i++) {
        const ax = rasterOfVox(controlVox[i].x, cols, W);
        const ay = rasterOfVox(controlVox[i].y, rows, H);
        const bx = rasterOfVox(controlVox[i + 1].x, cols, W);
        const by = rasterOfVox(controlVox[i + 1].y, rows, H);
        const d = distToSeg(p.a, p.b, ax, ay, bx, by);
        if (d < segD) {
          segD = d;
          segBest = i;
        }
      }
      if (segBest >= 0) {
        const nv = { x: voxOfRaster(p.a, W, cols), y: voxOfRaster(p.b, H, rows) };
        setControlVox((prev) => {
          const next = prev.slice();
          next.splice(segBest + 1, 0, nv);
          return next;
        });
        dragIdx.current = segBest + 1;
        return;
      }
    }
    // 3) lienzo vacío → añadir punto al final.
    const nv = { x: voxOfRaster(p.a, W, cols), y: voxOfRaster(p.b, H, rows) };
    setControlVox((prev) => [...prev, nv]);
    dragIdx.current = controlVox.length;
  };

  const onMove = (e: React.MouseEvent) => {
    if (dragIdx.current == null || !geom) return;
    const p = rasterAt(e.clientX, e.clientY);
    if (!p) return;
    const { W, H } = geom;
    const idx = dragIdx.current;
    const nv = { x: voxOfRaster(p.a, W, cols), y: voxOfRaster(p.b, H, rows) };
    setControlVox((prev) => {
      if (idx < 0 || idx >= prev.length) return prev;
      const next = prev.slice();
      next[idx] = nv;
      return next;
    });
  };

  const onUp = () => {
    dragIdx.current = null;
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = rasterAt(e.clientX, e.clientY);
    if (!p) return;
    const tol = 14 * p.ratio;
    const hit = nearestControl(p.a, p.b, tol);
    if (hit >= 0) setControlVox((prev) => prev.filter((_, i) => i !== hit));
  };

  const clearCurve = () => {
    setControlVox([]);
    setPano(null);
    setStale(false);
    dragIdx.current = null;
  };

  /* ------------------------------ generar ---------------------------------- */
  const canGenerate = controlVox.length >= 3 && depth >= 2 && !generating;

  const generate = useCallback(() => {
    if (controlVox.length < 3 || depth < 2) return;
    setGenerating(true);
    // Cede el hilo para pintar el "Generando…" antes del cómputo síncrono pesado.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        try {
          const vol: VolumeRef = {
            slices: slices.map((s) => s.pixels),
            cols,
            rows,
            depth,
            sx: scale.sx,
            sy: scale.sy,
            sz: scale.sz,
          };
          const ctrl = controlVox.map((p) => ({ x: p.x * scale.sx, y: p.y * scale.sy }));
          const res = reslicePanoramic(vol, { controlMm: ctrl, slabMm, mode });
          setPano(res);
          setStale(false);
        } catch {
          setPano(null);
        } finally {
          setGenerating(false);
        }
      }),
    );
  }, [controlVox, slices, cols, rows, depth, scale.sx, scale.sy, scale.sz, slabMm, mode]);

  /* -------------------------------- render --------------------------------- */
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
        {/* ---------- Panel 1: AXIAL de trazado ---------- */}
        <div className="flex flex-col self-start rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-2 py-1 bg-muted/40 border-b border-border">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-foreground">
              <Spline className="w-3.5 h-3.5" aria-hidden /> Traza la arcada (axial)
            </span>
            <button
              type="button"
              onClick={clearCurve}
              disabled={controlVox.length === 0}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md text-foreground hover:bg-muted disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Eraser className="w-3.5 h-3.5" /> Limpiar
            </button>
          </div>
          <div
            className="relative w-full select-none"
            style={{ height: 380, background: "#000", cursor: "crosshair" }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            onContextMenu={onContextMenu}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative" style={{ maxWidth: "100%", maxHeight: "100%" }}>
                <canvas
                  ref={axialRef}
                  className="block"
                  style={{ maxWidth: "100%", maxHeight: 380, imageRendering: "pixelated" }}
                />
                <canvas
                  ref={axialOverlayRef}
                  aria-hidden
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{ imageRendering: "pixelated" }}
                />
              </div>
            </div>
            <div className="absolute top-2 left-2 text-[11px] font-mono text-white/90 bg-black/50 rounded px-2 py-0.5">
              Axial · {Math.min(axialZ, Math.max(depth - 1, 0)) + 1}/{depth}
            </div>
            {controlVox.length < 3 && (
              <div className="absolute bottom-2 left-2 right-2 text-[11px] text-white/90 bg-black/55 rounded px-2 py-1 leading-snug">
                Haz clic para colocar puntos sobre la arcada (mínimo 3). Arrastra para mover, clic
                derecho para borrar.
              </div>
            )}
          </div>
          {/* Navegar el corte axial donde se ve mejor la arcada. */}
          <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/40 border-t border-border">
            <span className="text-[10px] text-muted-foreground w-10 flex-shrink-0" style={{ color: SPLINE_COLOR }}>
              Z
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, depth - 1)}
              value={Math.min(Math.max(axialZ, 0), Math.max(depth - 1, 0))}
              onChange={(e) => setAxialZ(Number(e.target.value))}
              disabled={depth <= 1}
              className="flex-1 accent-brand-500"
              aria-label="Corte axial para trazar la arcada"
            />
          </div>
        </div>

        {/* ---------- Panel 2: PANORÁMICA generada ---------- */}
        <div className="flex flex-col self-start rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-2 py-1 bg-muted/40 border-b border-border">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-foreground">
              <Layers className="w-3.5 h-3.5" aria-hidden /> Panorámica sintética
            </span>
            {pano && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                <Ruler className="w-3 h-3" aria-hidden /> {pano.totalArcMm.toFixed(0)} mm · 1 px ≈{" "}
                {pano.pxMm.toFixed(2)} mm
              </span>
            )}
          </div>
          <div
            className="relative w-full flex items-center justify-center"
            style={{ height: 380, background: `rgb(${BG[0]},${BG[1]},${BG[2]})` }}
          >
            {pano ? (
              <div className="relative" style={{ maxWidth: "100%", maxHeight: "100%" }}>
                <canvas
                  ref={panoRef}
                  className="block"
                  style={{ maxWidth: "100%", maxHeight: 380, imageRendering: "pixelated" }}
                />
                <canvas
                  ref={panoOverlayRef}
                  aria-hidden
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{ imageRendering: "pixelated" }}
                />
                {stale && (
                  <div className="absolute top-2 right-2 text-[10px] font-semibold text-amber-100 bg-amber-600/80 rounded px-2 py-0.5">
                    Cambios sin aplicar — regenera
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-muted-foreground px-6">
                <Spline className="w-8 h-8 mx-auto mb-2 opacity-70" aria-hidden />
                <p className="text-xs">
                  {controlVox.length < 3
                    ? "Traza la arcada con al menos 3 puntos y pulsa «Generar»."
                    : "Pulsa «Generar panorámica» para reconstruir la vista."}
                </p>
              </div>
            )}
            {generating && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Generando…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------- Controles del slab + generar ---------- */}
      <div className="flex items-center gap-3 flex-wrap bg-muted/40 rounded-lg p-2 border border-border">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-background/60 border border-border">
          <span className="text-[10px] text-muted-foreground px-1.5">Slab</span>
          <button
            type="button"
            aria-pressed={mode === "mip"}
            onClick={() => setMode("mip")}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              mode === "mip" ? "bg-brand-600 text-white shadow-sm" : "text-foreground hover:bg-muted"
            }`}
          >
            MIP
          </button>
          <button
            type="button"
            aria-pressed={mode === "avg"}
            onClick={() => setMode("avg")}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              mode === "avg" ? "bg-brand-600 text-white shadow-sm" : "text-foreground hover:bg-muted"
            }`}
          >
            Promedio
          </button>
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            Grosor {slabMm.toFixed(0)} mm
          </span>
          <input
            type="range"
            min={0}
            max={40}
            step={1}
            value={slabMm}
            onChange={(e) => setSlabMm(Number(e.target.value))}
            className="flex-1 accent-brand-500"
            aria-label="Grosor del slab bucco-lingual en milímetros"
          />
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate}
          className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40 ${
            stale ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-brand-600 text-white hover:bg-brand-700"
          }`}
        >
          {generating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          {pano ? "Regenerar" : "Generar panorámica"}
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground leading-snug">
        Reconstrucción curva siguiendo la arcada que trazas. El eje horizontal es la longitud de arco
        real en mm; el slab integra el grosor bucco-lingual ({mode === "mip" ? "MIP" : "promedio"}). Usa
        el mismo brillo/contraste y presets del visor.
      </p>
    </div>
  );
}
