"use client";
// UN plano de la rejilla MPR 2×2 (axial / coronal / sagital). Pinta el corte con
// proporciones físicas (mm) + interpolación bilineal (igual que la vista única
// anterior), dibuja la CRUZ sincronizada (las guías de los otros dos planos en su
// color) y conserva las herramientas que ya funcionaban: medición honesta (mm con
// estado de calibración) y sonda (valor relativo). Zoom/desplazamiento son LOCALES
// a cada panel; la posición de la cruz es COMPARTIDA (la sube al orquestador).
//
// La sincronización "en mm, no en píxeles" es intrínseca: las tres vistas comparten
// los índices de vóxel (Cross); al mover la cruz en un plano se actualizan los
// índices que ese plano controla y los otros dos se repintan en esa coordenada del
// mundo, porque cada raster ya está escalado por el espaciado físico del estudio.

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import type { Slice, PlaneKey, Tool, ScaleInfo, Cross, CalibStatus } from "./cbct-mpr-shared";
import { planeGeom, worstStatus } from "./cbct-mpr-shared";

// Color por plano (convención tipo Romexis): cada vista tiene su color y las guías
// que dibuja toman el color del PLANO QUE CONTROLAN (no el suyo), para leer de un
// vistazo qué corte mueve cada línea.
const PLANE_COLOR: Record<PlaneKey, string> = {
  axial: "#fbbf24", // amber-400
  coronal: "#34d399", // emerald-400
  sagittal: "#38bdf8", // sky-400
};
// En cada plano, qué plano representa la línea vertical (v) y la horizontal (h).
const LINE_PLANES: Record<PlaneKey, { v: PlaneKey; h: PlaneKey }> = {
  axial: { v: "sagittal", h: "coronal" }, // X→sagital, Y→coronal
  coronal: { v: "sagittal", h: "axial" }, // X→sagital, Z→axial
  sagittal: { v: "coronal", h: "axial" }, // Y→coronal, Z→axial
};

interface MeasureSeg {
  a0: number;
  b0: number;
  a1: number;
  b1: number;
}
interface ProbePoint {
  a: number;
  b: number;
  value: number;
}

interface Props {
  slices: Slice[];
  plane: PlaneKey;
  label: string;
  cross: Cross;
  scale: ScaleInfo;
  center: number;
  width: number;
  tool: Tool;
  showGuides: boolean;
  resetNonce: number;
  maximized: boolean;
  heightPx: number;
  onToggleMax: () => void;
  onCrossChange: (next: Partial<Cross>) => void;
}

// Dibuja una guía (línea de la cruz) con un hueco central para no tapar el punto.
function drawGuide(
  ctx: any,
  vertical: boolean,
  vx: number,
  hy: number,
  W: number,
  H: number,
  gap: number,
  color: string,
  lw: number,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  if (vertical) {
    ctx.moveTo(vx, 0);
    ctx.lineTo(vx, hy - gap);
    ctx.moveTo(vx, hy + gap);
    ctx.lineTo(vx, H);
  } else {
    ctx.moveTo(0, hy);
    ctx.lineTo(vx - gap, hy);
    ctx.moveTo(vx + gap, hy);
    ctx.lineTo(W, hy);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export default function MprPane(props: Props) {
  const {
    slices,
    plane,
    label,
    cross,
    scale,
    center,
    width,
    tool,
    showGuides,
    resetNonce,
    maximized,
    heightPx,
    onToggleMax,
    onCrossChange,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [measure, setMeasure] = useState<MeasureSeg | null>(null);
  const [probe, setProbe] = useState<ProbePoint | null>(null);

  const dragRef = useRef<{ x: number; y: number } | null>(null); // origen del paneo
  const modeRef = useRef<Tool | null>(null); // gesto activo durante un arrastre
  const measuringRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ a: number; b: number } | null>(null);

  const cols = slices.length ? slices[0].cols : 0;
  const rows = slices.length ? slices[0].rows : 0;
  const depth = slices.length;

  const geom = useMemo(
    () => planeGeom(cols, rows, depth, plane, scale),
    [cols, rows, depth, plane, scale],
  );

  // Índice del corte que MUESTRA este plano (coordenada fija a lo largo de su normal)
  // y su máximo. Sale de la cruz compartida.
  const nIndex = plane === "axial" ? cross.z : plane === "coronal" ? cross.y : cross.x;
  const nMax = plane === "axial" ? depth - 1 : plane === "coronal" ? rows - 1 : cols - 1;

  /* ---------------------------------------------------------------------- */
  /* Pintado de la IMAGEN base (no depende de la cruz: solo de su corte +    */
  /* ventana), para que mover la cruz no re-rasterice el plano sin cambios.  */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    if (!geom || slices.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { W, H } = geom;
    const c = cols;
    const r = rows;
    const d = depth;
    const lo = center - width / 2;
    const span = width <= 0 ? 1 : width;
    const inv = slices[Math.floor(d / 2)].invert;

    const toGray = (hu: number) => {
      let g = ((hu - lo) / span) * 255;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      return inv ? 255 - g : g;
    };

    const paint = (sample: (a: number, b: number) => number) => {
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

    if (plane === "axial") {
      // Plano (X,Y) en Z fijo: corte nativo, bilineal en X,Y.
      const s = slices[Math.min(Math.max(nIndex, 0), d - 1)];
      if (!s) return;
      const px = s.pixels;
      paint((a, b) => {
        const fx = ((a + 0.5) * c) / W - 0.5;
        const fy = ((b + 0.5) * r) / H - 0.5;
        const x = fx < 0 ? 0 : fx > c - 1 ? c - 1 : fx;
        const y = fy < 0 ? 0 : fy > r - 1 ? r - 1 : fy;
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = x0 + 1 < c ? x0 + 1 : x0;
        const y1 = y0 + 1 < r ? y0 + 1 : y0;
        const tx = x - x0;
        const ty = y - y0;
        const r0 = y0 * c;
        const r1 = y1 * c;
        const top = px[r0 + x0] + (px[r0 + x1] - px[r0 + x0]) * tx;
        const bot = px[r1 + x0] + (px[r1 + x1] - px[r1 + x0]) * tx;
        return top + (bot - top) * ty;
      });
    } else if (plane === "coronal") {
      // Plano (X,Z) en Y fijo: bilineal en X y entre cortes (Z).
      const yb = Math.min(Math.max(nIndex, 0), r - 1) * c;
      paint((a, b) => {
        const fx = ((a + 0.5) * c) / W - 0.5;
        const fz = ((b + 0.5) * d) / H - 0.5;
        const x = fx < 0 ? 0 : fx > c - 1 ? c - 1 : fx;
        const z = fz < 0 ? 0 : fz > d - 1 ? d - 1 : fz;
        const x0 = Math.floor(x);
        const x1 = x0 + 1 < c ? x0 + 1 : x0;
        const z0 = Math.floor(z);
        const z1 = z0 + 1 < d ? z0 + 1 : z0;
        const tx = x - x0;
        const tz = z - z0;
        const p0 = slices[z0].pixels;
        const p1 = slices[z1].pixels;
        const top = p0[yb + x0] + (p0[yb + x1] - p0[yb + x0]) * tx;
        const bot = p1[yb + x0] + (p1[yb + x1] - p1[yb + x0]) * tx;
        return top + (bot - top) * tz;
      });
    } else {
      // sagittal: plano (Y,Z) en X fijo: bilineal en Y y entre cortes (Z).
      const xf = Math.min(Math.max(nIndex, 0), c - 1);
      paint((a, b) => {
        const fy = ((a + 0.5) * r) / W - 0.5;
        const fz = ((b + 0.5) * d) / H - 0.5;
        const y = fy < 0 ? 0 : fy > r - 1 ? r - 1 : fy;
        const z = fz < 0 ? 0 : fz > d - 1 ? d - 1 : fz;
        const y0 = Math.floor(y);
        const y1 = y0 + 1 < r ? y0 + 1 : y0;
        const z0 = Math.floor(z);
        const z1 = z0 + 1 < d ? z0 + 1 : z0;
        const ty = y - y0;
        const tz = z - z0;
        const p0 = slices[z0].pixels;
        const p1 = slices[z1].pixels;
        const c0 = y0 * c + xf;
        const c1 = y1 * c + xf;
        const left = p0[c0] + (p0[c1] - p0[c0]) * ty;
        const right = p1[c0] + (p1[c1] - p1[c0]) * ty;
        return left + (right - left) * tz;
      });
    }
  }, [geom, slices, plane, nIndex, center, width, cols, rows, depth]);

  /* ---------------------------------------------------------------------- */
  /* Overlay: cruz sincronizada + medición + sonda. Coordenadas en px raster. */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    const cv = overlayRef.current;
    if (!cv || !geom) return;
    if (cv.width !== geom.W) cv.width = geom.W;
    if (cv.height !== geom.H) cv.height = geom.H;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const { W, H } = geom;
    const lw = Math.max(1, Math.round(Math.min(W, H) / 300));

    // Cruz: índice de vóxel -> coordenada raster (inverso del muestreo).
    if (showGuides) {
      const rasterOf = (vox: number, n: number, dim: number) => ((vox + 0.5) * dim) / n - 0.5;
      let vx: number;
      let hy: number;
      if (plane === "axial") {
        vx = rasterOf(cross.x, cols, W);
        hy = rasterOf(cross.y, rows, H);
      } else if (plane === "coronal") {
        vx = rasterOf(cross.x, cols, W);
        hy = rasterOf(cross.z, depth, H);
      } else {
        vx = rasterOf(cross.y, rows, W);
        hy = rasterOf(cross.z, depth, H);
      }
      const gap = Math.max(6, Math.round(Math.min(W, H) / 36));
      const lp = LINE_PLANES[plane];
      drawGuide(ctx, true, vx, hy, W, H, gap, PLANE_COLOR[lp.v], lw + 1);
      drawGuide(ctx, false, vx, hy, W, H, gap, PLANE_COLOR[lp.h], lw + 1);
      // Punto central (la coordenada del mundo seleccionada).
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.beginPath();
      ctx.arc(vx, hy, lw + 1, 0, Math.PI * 2);
      ctx.fill();
    }

    if (measure) {
      ctx.strokeStyle = "rgba(244,114,182,0.97)"; // pink-400 (distinto de las guías)
      ctx.lineWidth = lw + 1;
      ctx.beginPath();
      ctx.moveTo(measure.a0, measure.b0);
      ctx.lineTo(measure.a1, measure.b1);
      ctx.stroke();
      ctx.fillStyle = "rgba(244,114,182,0.97)";
      const rr = lw + 2;
      ctx.beginPath();
      ctx.arc(measure.a0, measure.b0, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(measure.a1, measure.b1, rr, 0, Math.PI * 2);
      ctx.fill();
    }

    if (probe && tool === "probe") {
      ctx.strokeStyle = "rgba(255,255,255,0.97)";
      ctx.lineWidth = lw;
      const len = (lw + 2) * 4;
      ctx.beginPath();
      ctx.moveTo(probe.a - len, probe.b);
      ctx.lineTo(probe.a + len, probe.b);
      ctx.moveTo(probe.a, probe.b - len);
      ctx.lineTo(probe.a, probe.b + len);
      ctx.stroke();
    }
  }, [geom, cross, measure, probe, tool, showGuides, plane, cols, rows, depth]);

  // Cambiar el corte de ESTE plano (o el plano) invalida medición/sonda hechas sobre
  // otro corte.
  useEffect(() => {
    setMeasure(null);
    setProbe(null);
  }, [nIndex, plane]);

  // La sonda es un indicador en vivo: al salir de esa herramienta no debe quedar.
  useEffect(() => {
    if (tool !== "probe") setProbe(null);
  }, [tool]);

  // Reinicio global (desde el orquestador): vuelve zoom/paneo/anotaciones a cero.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setMeasure(null);
    setProbe(null);
  }, [resetNonce]);

  // Cancela cualquier rAF pendiente al desmontar.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Mapeos puntero <-> raster <-> vóxel                                     */
  /* ---------------------------------------------------------------------- */

  // clientX/Y -> coordenadas del raster del lienzo (incluye zoom/pan vía el rect).
  const toRaster = (clientX: number, clientY: number): { a: number; b: number } | null => {
    const cv = canvasRef.current;
    if (!cv || cv.width === 0 || cv.height === 0) return null;
    const rect = cv.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    let a = ((clientX - rect.left) / rect.width) * cv.width;
    let b = ((clientY - rect.top) / rect.height) * cv.height;
    a = a < 0 ? 0 : a > cv.width ? cv.width : a;
    b = b < 0 ? 0 : b > cv.height ? cv.height : b;
    return { a, b };
  };

  // raster -> índice de vóxel (vecino más cercano), acotado.
  const rasterToVox = (coord: number, dim: number, n: number): number => {
    let v = Math.round(((coord + 0.5) * n) / dim - 0.5);
    if (v < 0) v = 0;
    else if (v > n - 1) v = n - 1;
    return v;
  };

  // Clic en este plano -> qué coordenadas del mundo (vóxel) fija. Las dos en plano;
  // la normal NO se toca (la mantiene este mismo plano).
  const crossFromRaster = (a: number, b: number): Partial<Cross> => {
    if (!geom) return {};
    const { W, H } = geom;
    if (plane === "axial") return { x: rasterToVox(a, W, cols), y: rasterToVox(b, H, rows) };
    if (plane === "coronal") return { x: rasterToVox(a, W, cols), z: rasterToVox(b, H, depth) };
    return { y: rasterToVox(a, W, rows), z: rasterToVox(b, H, depth) };
  };

  // Valor de gris (Int16, rescale aplicado) bajo el raster por vecino más cercano.
  // RELATIVO (no HU): el CBCT no entrega Hounsfield reales.
  const sampleValueAt = (a: number, b: number): number | null => {
    if (!geom || slices.length === 0) return null;
    const { W, H } = geom;
    const cl = (v: number, n: number) => (v < 0 ? 0 : v > n - 1 ? n - 1 : v);
    if (plane === "coronal") {
      const x = Math.round(cl(((a + 0.5) * cols) / W - 0.5, cols));
      const z = Math.round(cl(((b + 0.5) * depth) / H - 0.5, depth));
      const yb = Math.min(Math.max(nIndex, 0), rows - 1) * cols;
      const v = slices[z]?.pixels[yb + x];
      return v == null ? null : v;
    }
    if (plane === "sagittal") {
      const y = Math.round(cl(((a + 0.5) * rows) / W - 0.5, rows));
      const z = Math.round(cl(((b + 0.5) * depth) / H - 0.5, depth));
      const xf = Math.min(Math.max(nIndex, 0), cols - 1);
      const v = slices[z]?.pixels[y * cols + xf];
      return v == null ? null : v;
    }
    const s = slices[Math.min(Math.max(nIndex, 0), depth - 1)];
    if (!s) return null;
    const x = Math.round(cl(((a + 0.5) * cols) / W - 0.5, cols));
    const y = Math.round(cl(((b + 0.5) * rows) / H - 0.5, rows));
    const v = s.pixels[y * cols + x];
    return v == null ? null : v;
  };

  // Mueve la cruz con coalescencia por frame (limita los re-render a ~60/s mientras
  // se arrastra; los otros dos planos se re-rasterizan al cambiar su corte).
  const flushCross = () => {
    rafRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p) return;
    onCrossChange(crossFromRaster(p.a, p.b));
  };
  const queueCross = (a: number, b: number) => {
    pendingRef.current = { a, b };
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(flushCross);
  };

  /* ---------------------------------------------------------------------- */
  /* Eventos de puntero / rueda                                              */
  /* ---------------------------------------------------------------------- */
  const onDown = (e: React.MouseEvent) => {
    // Botón central = paneo siempre (atajo cómodo).
    const active: Tool = e.button === 1 ? "pan" : tool;
    modeRef.current = active;
    if (active === "pan") {
      dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }
    const p = toRaster(e.clientX, e.clientY);
    if (!p) return;
    if (active === "crosshair") {
      queueCross(p.a, p.b);
    } else if (active === "measure") {
      measuringRef.current = true;
      setMeasure({ a0: p.a, b0: p.b, a1: p.a, b1: p.b });
    } else {
      const v = sampleValueAt(p.a, p.b);
      setProbe(v == null ? null : { a: p.a, b: p.b, value: v });
    }
  };

  const onMove = (e: React.MouseEvent) => {
    // Sonda: lectura en vivo al pasar el cursor (sin arrastrar).
    if (tool === "probe" && modeRef.current == null) {
      const p = toRaster(e.clientX, e.clientY);
      if (p) {
        const v = sampleValueAt(p.a, p.b);
        setProbe(v == null ? null : { a: p.a, b: p.b, value: v });
      }
      return;
    }
    const m = modeRef.current;
    if (m === "pan") {
      if (!dragRef.current) return;
      setPan({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
      return;
    }
    if (!m) return;
    const p = toRaster(e.clientX, e.clientY);
    if (!p) return;
    if (m === "crosshair") {
      queueCross(p.a, p.b);
    } else if (m === "measure") {
      if (measuringRef.current) setMeasure((mm) => (mm ? { ...mm, a1: p.a, b1: p.b } : mm));
    } else if (m === "probe") {
      const v = sampleValueAt(p.a, p.b);
      setProbe(v == null ? null : { a: p.a, b: p.b, value: v });
    }
  };

  const onUp = () => {
    dragRef.current = null;
    measuringRef.current = false;
    modeRef.current = null;
  };
  const onLeave = () => {
    dragRef.current = null;
    measuringRef.current = false;
    modeRef.current = null;
    if (tool === "probe") setProbe(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    // Ctrl/⌘ + rueda = zoom; rueda sola = navegar cortes a lo largo de la normal.
    if (e.ctrlKey || e.metaKey) {
      setZoom((z) => Math.min(8, Math.max(0.25, z * (e.deltaY < 0 ? 1.1 : 0.9))));
      return;
    }
    if (nMax <= 0) return;
    const step = e.deltaY < 0 ? 1 : -1;
    const next = Math.min(Math.max(nIndex + step, 0), nMax);
    if (next === nIndex) return;
    if (plane === "axial") onCrossChange({ z: next });
    else if (plane === "coronal") onCrossChange({ y: next });
    else onCrossChange({ x: next });
  };

  const onDoubleClick = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const onSlider = (val: number) => {
    if (plane === "axial") onCrossChange({ z: val });
    else if (plane === "coronal") onCrossChange({ y: val });
    else onCrossChange({ x: val });
  };

  // Lectura de la medición activa (mm honesto + estado de calibración).
  const readout = (() => {
    if (!geom || !measure) return null;
    const da = measure.a1 - measure.a0;
    const db = measure.b1 - measure.b0;
    const mm = Math.hypot((da * geom.nA * geom.sA) / geom.W, (db * geom.nB * geom.sB) / geom.H);
    const pxNative = Math.hypot((da * geom.nA) / geom.W, (db * geom.nB) / geom.H);
    const axisStat = (axis: "X" | "Y" | "Z"): CalibStatus =>
      axis === "Z"
        ? geom.sc.zCalibrated
          ? "exact"
          : "uncal"
        : geom.sc.xySource === "pixel-spacing"
          ? "exact"
          : geom.sc.xySource === "imager-pixel-spacing"
            ? "approx"
            : "uncal";
    const status = worstStatus(axisStat(geom.axisA), axisStat(geom.axisB));
    return { mm, pxNative, status };
  })();

  const cursor = tool === "pan" ? (dragRef.current ? "grabbing" : "grab") : "crosshair";
  const accent = PLANE_COLOR[plane];

  return (
    <div className="flex flex-col self-start rounded-lg border border-border bg-card overflow-hidden">
      <div
        className="relative w-full select-none"
        style={{ height: heightPx, background: "#000", cursor }}
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onLeave}
        onDoubleClick={onDoubleClick}
      >
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <div className="relative" style={{ maxWidth: "100%", maxHeight: "100%" }}>
            <canvas
              ref={canvasRef}
              className="block"
              style={{ maxWidth: "100%", maxHeight: heightPx, imageRendering: "pixelated" }}
            />
            <canvas
              ref={overlayRef}
              aria-hidden
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ imageRendering: "pixelated" }}
            />
          </div>
        </div>

        {/* Etiqueta del plano (con su color) + corte actual. */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[11px] font-mono text-white/90 bg-black/50 rounded px-2 py-0.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: accent }} aria-hidden />
          {label} · {Math.min(nIndex, Math.max(nMax, 0)) + 1}/{nMax + 1}
        </div>

        {/* Maximizar / restaurar este panel. */}
        <button
          type="button"
          onClick={onToggleMax}
          title={maximized ? "Restaurar la rejilla 2×2" : "Maximizar este plano"}
          aria-label={maximized ? "Restaurar la rejilla 2×2" : "Maximizar este plano"}
          className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-md bg-black/50 text-white/90 hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>

        {/* HUD de la herramienta activa. */}
        {tool === "probe" && probe && (
          <div className="absolute bottom-2 right-2 max-w-[70%] text-right bg-black/60 rounded px-2 py-1">
            <div className="text-[11px] font-mono text-white">Valor relativo: {probe.value}</div>
            <div className="text-[9px] text-amber-200/90 leading-tight">relativo · NO es densidad (HU)</div>
          </div>
        )}
        {tool === "measure" && readout && (
          <div className="absolute bottom-2 right-2 max-w-[70%] text-right bg-black/60 rounded px-2 py-1">
            <div className="text-[12px] font-mono text-white">
              {readout.status === "uncal"
                ? `${Math.round(readout.pxNative)} px`
                : `${readout.status === "approx" ? "≈ " : ""}${readout.mm.toFixed(1)} mm`}
            </div>
            {readout.status === "approx" && (
              <div className="text-[9px] text-amber-200/90 leading-tight">aproximada · magnificación</div>
            )}
            {readout.status === "uncal" && (
              <div className="text-[9px] text-amber-200/90 leading-tight">sin escala mm calibrada</div>
            )}
          </div>
        )}
      </div>

      {/* Navegación fina del corte de este plano. */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/40 border-t border-border">
        <span className="text-[10px] text-muted-foreground w-10 flex-shrink-0" style={{ color: accent }}>
          {plane === "axial" ? "Z" : plane === "coronal" ? "Y" : "X"}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(0, nMax)}
          value={Math.min(Math.max(nIndex, 0), Math.max(nMax, 0))}
          onChange={(e) => onSlider(Number(e.target.value))}
          disabled={nMax <= 0}
          className="flex-1 accent-brand-500"
          aria-label={`Corte del plano ${label}`}
        />
      </div>
    </div>
  );
}
