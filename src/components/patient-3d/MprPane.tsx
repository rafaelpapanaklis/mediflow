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
import {
  planeGeom,
  worstStatus,
  fitContain,
  viewRasterDims,
  MAX_DPR,
  MAX_VIEW_SIDE,
} from "./cbct-mpr-shared";

// Color por plano (convención tipo Romexis): cada vista tiene su color y las guías
// que dibuja toman el color del PLANO QUE CONTROLAN (no el suyo), para leer de un
// vistazo qué corte mueve cada línea.
const PLANE_COLOR: Record<PlaneKey, string> = {
  axial: "#fbbf24", // amber-400
  coronal: "#34d399", // emerald-400
  sagittal: "#38bdf8", // sky-400
};
// Techo del alto del corte maximizado. Solo acota el ALTO: el ancho lo da
// siempre el contenedor. Deja aire para la barra de herramientas dentro del
// modal del visor, que ya trae su propio scroll (max-h-[80vh]).
const MAX_PANE_HEIGHT = "78vh";

// En cada plano, qué plano representa la línea vertical (v) y la horizontal (h).
const LINE_PLANES: Record<PlaneKey, { v: PlaneKey; h: PlaneKey }> = {
  axial: { v: "sagittal", h: "coronal" }, // X→sagital, Y→coronal
  coronal: { v: "sagittal", h: "axial" }, // X→sagital, Z→axial
  sagittal: { v: "coronal", h: "axial" }, // Y→coronal, Z→axial
};

// Anotaciones en coordenadas NORMALIZADAS [0,1] del plano, NUNCA en píxeles del
// lienzo: el lienzo ahora se re-mide con el layout (maximizar/restaurar) y una
// medida guardada en píxeles cambiaría de valor en silencio al cambiar de tamaño.
// En normalizado, los mm salen de la extensión física del estudio (nA·sA) y son
// idénticos en la rejilla 2×2 y maximizado.
interface MeasureSeg {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}
interface ProbePoint {
  u: number;
  v: number;
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
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [measure, setMeasure] = useState<MeasureSeg | null>(null);
  const [probe, setProbe] = useState<ProbePoint | null>(null);
  // Caja REAL del área negra + densidad de pantalla. La mide un ResizeObserver:
  // el cambio de tamaño lo dispara maximizar/restaurar (estado de React), que no
  // emite `window.resize`, así que escuchar la ventana no serviría de nada.
  const [box, setBox] = useState({ w: 0, h: 0, dpr: 1 });

  const dragRef = useRef<{ x: number; y: number } | null>(null); // origen del paneo
  const modeRef = useRef<Tool | null>(null); // gesto activo durante un arrastre
  const measuringRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ u: number; v: number } | null>(null);

  const cols = slices.length ? slices[0].cols : 0;
  const rows = slices.length ? slices[0].rows : 0;
  const depth = slices.length;

  const geom = useMemo(
    () => planeGeom(cols, rows, depth, plane, scale),
    [cols, rows, depth, plane, scale],
  );

  // Extensión FÍSICA del plano en mm: de aquí sale la proporción real del estudio
  // (vóxeles anisótropos incluidos) y también los mm de la medición.
  const extA = geom ? geom.nA * geom.sA : 1;
  const extB = geom ? geom.nB * geom.sB : 1;
  const aspect = extB > 0 ? extA / extB : 1;

  /* ---------------------------------------------------------------------- */
  /* Medida del contenedor -> caja del corte -> tamaño del búfer             */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const node = viewportRef.current;
      if (!node) return;
      const w = node.clientWidth;
      const h = node.clientHeight;
      const dpr = Math.max(1, Math.min(MAX_DPR, window.devicePixelRatio || 1));
      setBox((prev) => (prev.w === w && prev.h === h && prev.dpr === dpr ? prev : { w, h, dpr }));
    };
    // Maximizar dispara varias entradas seguidas (ancho y alto llegan por
    // separado): coalescemos en un frame para re-rasterizar UNA vez.
    const ro = new ResizeObserver(() => {
      if (!raf) raf = requestAnimationFrame(read);
    });
    ro.observe(el);
    read();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // Caja CSS del corte: "contain" con la proporción física. Lo que sobre son
  // márgenes que centra el flex; jamás se estira la imagen para rellenar.
  const fit = useMemo(
    () => (geom ? fitContain(extA, extB, box.w, box.h) : { w: 0, h: 0 }),
    [geom, extA, extB, box.w, box.h],
  );

  // Búfer del corte (píxeles de dispositivo, acotado) y del overlay (siempre a
  // densidad de pantalla: son vectores, salen baratos y así la cruz nunca pixela).
  const view = useMemo(
    () => (geom && fit.w > 0 ? viewRasterDims(geom, fit.w, fit.h, box.dpr) : null),
    [geom, fit.w, fit.h, box.dpr],
  );
  const ov = useMemo(
    () => ({
      W: Math.max(1, Math.min(MAX_VIEW_SIDE, Math.round(fit.w * box.dpr))),
      H: Math.max(1, Math.min(MAX_VIEW_SIDE, Math.round(fit.h * box.dpr))),
    }),
    [fit.w, fit.h, box.dpr],
  );
  // Si el búfer se quedó por debajo de la densidad de pantalla (tope de área o
  // estudio de baja resolución), interpolar suave se ve mejor que los bloques.
  const exactPixels = view != null && view.W >= Math.round(fit.w * box.dpr);

  // Índice del corte que MUESTRA este plano (coordenada fija a lo largo de su normal)
  // y su máximo. Sale de la cruz compartida.
  const nIndex = plane === "axial" ? cross.z : plane === "coronal" ? cross.y : cross.x;
  const nMax = plane === "axial" ? depth - 1 : plane === "coronal" ? rows - 1 : cols - 1;

  /* ---------------------------------------------------------------------- */
  /* Pintado de la IMAGEN base (no depende de la cruz: solo de su corte +    */
  /* ventana), para que mover la cruz no re-rasterice el plano sin cambios.  */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    if (!geom || !view || slices.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // El búfer lo manda la caja MEDIDA (no la geometría del volumen): así el
    // corte se re-rasteriza a la resolución real que ocupa en pantalla.
    const { W, H } = view;
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
  }, [geom, view, slices, plane, nIndex, center, width, cols, rows, depth]);

  /* ---------------------------------------------------------------------- */
  /* Overlay: cruz sincronizada + medición + sonda. Coordenadas en px raster. */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    const cv = overlayRef.current;
    if (!cv || !geom || fit.w <= 0) return;
    if (cv.width !== ov.W) cv.width = ov.W;
    if (cv.height !== ov.H) cv.height = ov.H;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    // Escalamos el contexto UNA vez: a partir de aquí todo se dibuja en píxeles
    // CSS, así que los grosores no cambian con la densidad de pantalla ni con el
    // tamaño del búfer (mismo patrón que Clinic3DHud).
    ctx.setTransform(ov.W / fit.w, 0, 0, ov.H / fit.h, 0, 0);
    const W = fit.w;
    const H = fit.h;
    const lw = Math.max(1, Math.round(Math.min(W, H) / 300));

    // Cruz: índice de vóxel -> normalizado -> píxeles CSS de la caja del corte.
    if (showGuides) {
      const normOf = (vox: number, n: number) => (n > 0 ? (vox + 0.5) / n : 0);
      let vx: number;
      let hy: number;
      if (plane === "axial") {
        vx = normOf(cross.x, cols) * W;
        hy = normOf(cross.y, rows) * H;
      } else if (plane === "coronal") {
        vx = normOf(cross.x, cols) * W;
        hy = normOf(cross.z, depth) * H;
      } else {
        vx = normOf(cross.y, rows) * W;
        hy = normOf(cross.z, depth) * H;
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
      const x0 = measure.u0 * W;
      const y0 = measure.v0 * H;
      const x1 = measure.u1 * W;
      const y1 = measure.v1 * H;
      ctx.strokeStyle = "rgba(244,114,182,0.97)"; // pink-400 (distinto de las guías)
      ctx.lineWidth = lw + 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.fillStyle = "rgba(244,114,182,0.97)";
      const rr = lw + 2;
      ctx.beginPath();
      ctx.arc(x0, y0, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x1, y1, rr, 0, Math.PI * 2);
      ctx.fill();
    }

    if (probe && tool === "probe") {
      const px = probe.u * W;
      const py = probe.v * H;
      ctx.strokeStyle = "rgba(255,255,255,0.97)";
      ctx.lineWidth = lw;
      const len = (lw + 2) * 4;
      ctx.beginPath();
      ctx.moveTo(px - len, py);
      ctx.lineTo(px + len, py);
      ctx.moveTo(px, py - len);
      ctx.lineTo(px, py + len);
      ctx.stroke();
    }
  }, [geom, fit.w, fit.h, ov, cross, measure, probe, tool, showGuides, plane, cols, rows, depth]);

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
  /* Mapeos puntero <-> normalizado <-> vóxel                                */
  /* ---------------------------------------------------------------------- */

  // clientX/Y -> coordenadas NORMALIZADAS [0,1] del corte. Normaliza contra el
  // rect real del lienzo, así que absorbe zoom y paneo (el transform está en un
  // ancestro y `getBoundingClientRect` ya devuelve la caja transformada) y —lo
  // importante— NO depende del tamaño del búfer: el mismo punto anatómico da el
  // mismo valor en la rejilla 2×2 y maximizado.
  const toNorm = (clientX: number, clientY: number): { u: number; v: number } | null => {
    const cv = canvasRef.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    let u = (clientX - rect.left) / rect.width;
    let v = (clientY - rect.top) / rect.height;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    return { u, v };
  };

  // normalizado -> índice de vóxel (vecino más cercano), acotado. El centro del
  // vóxel v cae en (v+0.5)/n, así que el inverso exacto es u·n − 0.5.
  const normToVox = (t: number, n: number): number => {
    if (n <= 0) return 0;
    let v = Math.round(t * n - 0.5);
    if (v < 0) v = 0;
    else if (v > n - 1) v = n - 1;
    return v;
  };

  // Clic en este plano -> qué coordenadas del mundo (vóxel) fija. Las dos en plano;
  // la normal NO se toca (la mantiene este mismo plano).
  const crossFromNorm = (u: number, v: number): Partial<Cross> => {
    if (plane === "axial") return { x: normToVox(u, cols), y: normToVox(v, rows) };
    if (plane === "coronal") return { x: normToVox(u, cols), z: normToVox(v, depth) };
    return { y: normToVox(u, rows), z: normToVox(v, depth) };
  };

  // Valor de gris (Int16, rescale aplicado) bajo el puntero por vecino más cercano.
  // RELATIVO (no HU): el CBCT no entrega Hounsfield reales.
  const sampleValueAt = (u: number, v: number): number | null => {
    if (slices.length === 0) return null;
    if (plane === "coronal") {
      const x = normToVox(u, cols);
      const z = normToVox(v, depth);
      const yb = Math.min(Math.max(nIndex, 0), rows - 1) * cols;
      const val = slices[z]?.pixels[yb + x];
      return val == null ? null : val;
    }
    if (plane === "sagittal") {
      const y = normToVox(u, rows);
      const z = normToVox(v, depth);
      const xf = Math.min(Math.max(nIndex, 0), cols - 1);
      const val = slices[z]?.pixels[y * cols + xf];
      return val == null ? null : val;
    }
    const s = slices[Math.min(Math.max(nIndex, 0), depth - 1)];
    if (!s) return null;
    const x = normToVox(u, cols);
    const y = normToVox(v, rows);
    const val = s.pixels[y * cols + x];
    return val == null ? null : val;
  };

  // Mueve la cruz con coalescencia por frame (limita los re-render a ~60/s mientras
  // se arrastra; los otros dos planos se re-rasterizan al cambiar su corte).
  const flushCross = () => {
    rafRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p) return;
    onCrossChange(crossFromNorm(p.u, p.v));
  };
  const queueCross = (u: number, v: number) => {
    pendingRef.current = { u, v };
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
    const p = toNorm(e.clientX, e.clientY);
    if (!p) return;
    if (active === "crosshair") {
      queueCross(p.u, p.v);
    } else if (active === "measure") {
      measuringRef.current = true;
      setMeasure({ u0: p.u, v0: p.v, u1: p.u, v1: p.v });
    } else {
      const val = sampleValueAt(p.u, p.v);
      setProbe(val == null ? null : { u: p.u, v: p.v, value: val });
    }
  };

  const onMove = (e: React.MouseEvent) => {
    // Sonda: lectura en vivo al pasar el cursor (sin arrastrar).
    if (tool === "probe" && modeRef.current == null) {
      const p = toNorm(e.clientX, e.clientY);
      if (p) {
        const val = sampleValueAt(p.u, p.v);
        setProbe(val == null ? null : { u: p.u, v: p.v, value: val });
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
    const p = toNorm(e.clientX, e.clientY);
    if (!p) return;
    if (m === "crosshair") {
      queueCross(p.u, p.v);
    } else if (m === "measure") {
      if (measuringRef.current) setMeasure((mm) => (mm ? { ...mm, u1: p.u, v1: p.v } : mm));
    } else if (m === "probe") {
      const val = sampleValueAt(p.u, p.v);
      setProbe(val == null ? null : { u: p.u, v: p.v, value: val });
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

  // La rueda navega cortes. Va como listener NATIVO con `{ passive: false }`:
  // React registra `wheel` de forma pasiva en la raíz, así que su `preventDefault`
  // es un no-op y la rueda acababa desplazando el modal (que tiene su propio
  // overflow) en vez de cambiar de corte — se nota más con el panel maximizado.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
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
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [nIndex, nMax, plane, onCrossChange]);

  const onDoubleClick = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const onSlider = (val: number) => {
    if (plane === "axial") onCrossChange({ z: val });
    else if (plane === "coronal") onCrossChange({ y: val });
    else onCrossChange({ x: val });
  };

  // Lectura de la medición activa (mm honesto + estado de calibración). Sale de
  // la extensión física del plano por la fracción medida: ni el tamaño del búfer
  // ni el de la caja entran en la cuenta, así que maximizar no altera el número.
  const readout = (() => {
    if (!geom || !measure) return null;
    const du = measure.u1 - measure.u0;
    const dv = measure.v1 - measure.v0;
    const mm = Math.hypot(du * geom.nA * geom.sA, dv * geom.nB * geom.sB);
    const pxNative = Math.hypot(du * geom.nA, dv * geom.nB);
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

  // Alto del área de imagen. En la rejilla lo fija el orquestador; maximizado lo
  // manda el ANCHO real ya medido, para que el corte aproveche el ancho sin
  // deformarse. El techo en vh es sobre el ALTO (el ancho siempre sale del
  // contenedor, nunca del viewport) y evita que la imagen se salga de pantalla.
  const viewportH = maximized
    ? Math.max(320, Math.round(box.w / aspect) || heightPx)
    : heightPx;

  return (
    <div
      className={`flex flex-col ${
        maximized ? "w-full" : "self-start"
      } rounded-lg border border-border bg-card overflow-hidden`}
    >
      <div
        ref={viewportRef}
        className="relative w-full select-none overflow-hidden"
        style={{
          height: viewportH,
          maxHeight: maximized ? MAX_PANE_HEIGHT : undefined,
          background: "#000",
          cursor,
        }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onLeave}
        onDoubleClick={onDoubleClick}
      >
        {/* Caja del corte: YA tiene la proporción física (fitContain), así que
            ambos lienzos la rellenan al 100% y coinciden EXACTO — la cruz y las
            medidas no pueden desalinearse de la imagen. */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <div className="relative" style={{ width: fit.w, height: fit.h }}>
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full"
              style={{ imageRendering: exactPixels ? "pixelated" : "auto" }}
            />
            <canvas
              ref={overlayRef}
              aria-hidden
              className="absolute inset-0 w-full h-full pointer-events-none"
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
