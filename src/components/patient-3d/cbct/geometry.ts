// Helpers de geometría del visor CBCT. Portado de config.jsx.
// Los puntos son NORMALIZADOS 0..1 dentro de la caja de imagen.

import type { Pt } from "./types";

/** Distancia euclídea entre dos puntos normalizados (0..1). */
export function dist01(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Distancia en MILÍMETROS entre dos puntos normalizados de un plano.
 *
 * `mmPorUnidad` = milímetros que abarca el ancho normalizado completo (0→1) del
 * plano = el valor de CbctViewerProps.mmPorPixel[plane], derivado por el cargador
 * real (T7) de las cabeceras DICOM (p.ej. cols × PixelSpacing.x). Reemplaza el
 * FOV_MM fijo del prototipo (§5 de INTEGRACION.md): la escala es REAL por plano,
 * no un campo de visión simulado.
 */
export function mmBetween(a: Pt, b: Pt, mmPorUnidad: number): number {
  // Sin escala válida (0, negativa, NaN o cabecera DICOM ausente) no hay mm
  // reales que reportar: devolvemos 0 y dejamos que la UI muestre "sin escala".
  if (!(mmPorUnidad > 0)) return 0;
  return dist01(a, b) * mmPorUnidad;
}

/** Ángulo en grados (0..180) en el vértice `v` entre los lados `a` y `b`. */
export function angleAt(a: Pt, v: Pt, b: Pt): number {
  const a1 = Math.atan2(a.y - v.y, a.x - v.x);
  const a2 = Math.atan2(b.y - v.y, b.x - v.x);
  let d = (Math.abs(a1 - a2) * 180) / Math.PI;
  if (d > 180) d = 360 - d;
  return d;
}

/** Punto medio entre dos puntos. */
export function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Path SVG suavizado (Catmull-Rom → Bézier) a través de los puntos.
 * Los puntos ya vienen escalados al viewBox del overlay (no normalizados aquí).
 */
export function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

/** id corto y estable para una anotación. */
export function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}
