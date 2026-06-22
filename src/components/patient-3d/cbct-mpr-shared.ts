// Helpers PUROS compartidos por el visor CBCT en rejilla 2×2 (MPR) y sus paneles.
// Sin React, sin DOM: solo geometría física (mm), estadística por percentiles del
// estudio y presets de ventana. Los consumen DicomSetViewer (orquestador) y
// MprPane (un plano). Mantener este archivo libre de efectos colaterales.

import type { DecodedSlice } from "./dicom-decode-core";

// Reusamos el corte ya decodificado del núcleo (HU en Int16 + geometría física).
export type Slice = DecodedSlice;

// Plano 2D del volumen. El 3D (volumen) lo maneja el orquestador aparte.
export type PlaneKey = "axial" | "coronal" | "sagittal";

// Herramienta activa sobre los planos 2D. "crosshair" = navegar moviendo la cruz
// sincronizada; "pan" = desplazar; "measure"/"probe" = como antes.
export type Tool = "crosshair" | "pan" | "measure" | "probe";

// De dónde sale el espaciado en plano (mm/px). Precedencia clínica:
//   pixel-spacing (0028,0030) = medida reconstruida (CT/CBCT) -> exacta.
//   imager-pixel-spacing (0018,1164) = en el detector (pano/periapical) -> la
//     proyección amplía la anatomía (magnificación) -> aproximada.
//   none = sin metadato de escala -> NO se puede dar mm (se muestra px).
export type SpacingSource = "pixel-spacing" | "imager-pixel-spacing" | "none";

export interface ScaleInfo {
  sx: number; // mm por columna (eje X)
  sy: number; // mm por fila (eje Y)
  sz: number; // mm entre cortes (eje Z)
  xySource: SpacingSource; // fuente del espaciado en plano
  zCalibrated: boolean; // sz viene de SpacingBetweenSlices/SliceThickness (no derivado)
}

// Estado de calibración de UNA medición. "approx" = magnificación de proyección;
// "uncal" = sin escala mm fiable (se reporta en px, nunca un mm inventado).
export type CalibStatus = "exact" | "approx" | "uncal";

// Posición de la CRUZ en coordenadas de VÓXEL (índices enteros). Las tres vistas
// MPR comparten esta posición: cada plano fija una coordenada (su normal) y los
// otros dos se reposicionan a la misma coordenada del MUNDO (mm) automáticamente,
// porque cada raster se escala con el espaciado físico del estudio.
export interface Cross {
  x: number; // columna (eje X)
  y: number; // fila (eje Y)
  z: number; // corte (eje Z)
}

// El peor estado domina la medición (un eje sin calibrar invalida el mm).
export function worstStatus(a: CalibStatus, b: CalibStatus): CalibStatus {
  const rank: Record<CalibStatus, number> = { exact: 0, approx: 1, uncal: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export function clampInt(v: number, lo: number, hi: number): number {
  v = Math.round(v);
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// Tamaño del raster de salida de un plano: 1 px = el espaciado más fino, para no
// perder resolución nativa y dar proporciones físicas reales. Acotado a MAXDIM por
// lado (rendimiento; el lienzo se reescala al contenedor). Compartido por el
// pintado de la imagen y la matemática de medición, para que coincidan exacto.
export const MAXDIM = 1024;
export function rasterDims(nA: number, sA: number, nB: number, sB: number): { W: number; H: number } {
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
}

// Escala INFERIDA de un corte ya decodificado (siempre disponible, instantánea).
// El núcleo solo captura PixelSpacing (0028,0030) y cae a [1,1] si falta; por eso:
// espaciado real (!= [1,1]) -> pixel-spacing exacto; [1,1]/ausente -> sin escala.
// El caso ImagerPixelSpacing-solo (pano) lo refina el orquestador leyendo el header.
export function inferScale(s: Slice): ScaleInfo {
  const ps = s.pixelSpacing;
  const sx = ps && ps[0] > 0 ? ps[0] : 1;
  const sy = ps && ps[1] > 0 ? ps[1] : 1;
  const zRaw = s.zSpacing;
  const sz = zRaw && zRaw > 0 ? zRaw : sy;
  const hasReal = !!(ps && (ps[0] !== 1 || ps[1] !== 1));
  return { sx, sy, sz, xySource: hasReal ? "pixel-spacing" : "none", zCalibrated: hasReal };
}

// Geometría de UN plano: ejes en plano (nA·sA × nB·sB), su identidad (X/Y/Z) y el
// tamaño del raster físico. Es la misma matemática que usaba la vista única, ahora
// parametrizada por `plane` para poder pintar los tres planos a la vez.
export interface PlaneGeom {
  cols: number;
  rows: number;
  depth: number;
  sx: number;
  sy: number;
  sz: number;
  nA: number; // muestras eje horizontal del raster
  sA: number; // mm/muestra eje horizontal
  nB: number; // muestras eje vertical del raster
  sB: number; // mm/muestra eje vertical
  axisA: "X" | "Y" | "Z";
  axisB: "X" | "Y" | "Z";
  W: number;
  H: number;
  sc: ScaleInfo;
}

export function planeGeom(
  cols: number,
  rows: number,
  depth: number,
  plane: PlaneKey,
  sc: ScaleInfo,
): PlaneGeom | null {
  if (cols <= 0 || rows <= 0 || depth <= 0) return null;
  const { sx, sy, sz } = sc;
  let nA: number;
  let sA: number;
  let nB: number;
  let sB: number;
  let axisA: "X" | "Y" | "Z";
  let axisB: "X" | "Y" | "Z";
  if (plane === "coronal") {
    // Plano (X,Z) en Y fijo.
    nA = cols;
    sA = sx;
    nB = depth;
    sB = sz;
    axisA = "X";
    axisB = "Z";
  } else if (plane === "sagittal") {
    // Plano (Y,Z) en X fijo.
    nA = rows;
    sA = sy;
    nB = depth;
    sB = sz;
    axisA = "Y";
    axisB = "Z";
  } else {
    // axial: plano (X,Y) en Z fijo.
    nA = cols;
    sA = sx;
    nB = rows;
    sB = sy;
    axisA = "X";
    axisB = "Y";
  }
  const { W, H } = rasterDims(nA, sA, nB, sB);
  return { cols, rows, depth, sx, sy, sz, nA, sA, nB, sB, axisA, axisB, W, H, sc };
}

/* -------------------------------------------------------------------------- */
/* Estadística por percentiles del estudio (auto-ventana + presets)            */
/* -------------------------------------------------------------------------- */

// El CBCT NO entrega Hounsfield estables: una ventana FIJA (HU absolutos) no cae
// bien en todos los estudios. Trabajamos en valores de gris RELATIVOS: muestreamos
// el volumen y sacamos percentiles, de los que derivamos la auto-ventana (p1/p99)
// y los presets de densidad. Así el contraste sale bien "por defecto" en cualquier
// CBCT sin números mágicos. Ver reference_dental_viewer_research (CBCT≠HU).
export interface VolStats {
  min: number;
  max: number;
  p01: number;
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
}

// Submuestrea el volumen (≈50k muestras) saltando vóxeles para no recorrer
// millones. Desfase primo por corte para no muestrear siempre la misma esquina
// (suele ser aire). Determinista (sin RNG). Ordena y lee percentiles por índice.
export function computeVolStats(slices: Slice[]): VolStats | null {
  if (!slices || slices.length === 0) return null;
  const depth = slices.length;
  const per = slices[0].pixels.length;
  if (per <= 0) return null;
  const target = 50000;
  const totalApprox = depth * per;
  let stride = Math.floor(totalApprox / target);
  if (stride < 1) stride = 1;

  const samples: number[] = [];
  for (let z = 0; z < depth; z++) {
    const px = slices[z].pixels;
    const len = px.length;
    let i = (z * 7919) % stride; // desfase primo por corte
    for (; i < len; i += stride) samples.push(px[i]);
  }
  if (samples.length === 0) return null;
  samples.sort((a, b) => a - b);
  const n = samples.length;
  const at = (p: number) => {
    let k = Math.floor(p * (n - 1));
    if (k < 0) k = 0;
    else if (k > n - 1) k = n - 1;
    return samples[k];
  };
  return {
    min: samples[0],
    max: samples[n - 1],
    p01: at(0.01),
    p05: at(0.05),
    p25: at(0.25),
    p50: at(0.5),
    p75: at(0.75),
    p95: at(0.95),
    p99: at(0.99),
  };
}

export type WindowKey = "auto" | "bone" | "tissue" | "air";
export interface WindowCW {
  c: number;
  w: number;
}

// Ventana a partir de un rango [lo,hi] de valores de gris (centro/ancho). w>=1.
function win(lo: number, hi: number): WindowCW {
  return { c: (lo + hi) / 2, w: Math.max(1, hi - lo) };
}

// Presets de 1 clic derivados de los percentiles del estudio (relativos, robustos
// en CBCT). auto = la auto-ventana p1/p99 que ya usaba el visor.
export function presetWindow(s: VolStats, key: WindowKey): WindowCW {
  if (key === "bone") return win(s.p50, s.p99); // tejido duro: hueso/diente con contraste
  if (key === "tissue") return win(s.p25, s.p75); // banda media: tejido blando
  if (key === "air") return win(s.p01, s.p50); // baja densidad: aire/cavidades y sus paredes
  return win(s.p01, s.p99); // auto = p1/p99 (rango real del estudio)
}

export const WINDOW_PRESETS: { key: WindowKey; label: string }[] = [
  { key: "auto", label: "Auto" },
  { key: "bone", label: "Hueso" },
  { key: "tissue", label: "Tejido" },
  { key: "air", label: "Aire" },
];
