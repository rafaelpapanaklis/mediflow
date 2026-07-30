// Geometría del heatmap: helpers PUROS compartidos por la pestaña, el escenario
// y el canvas. Sin JSX ni estado → la proyección se puede razonar aparte del render.
//
// ── SISTEMA DE COORDENADAS (contrato con el tracker, src/lib/analytics/tracker-core.ts)
//   x → fracción del ancho del viewport (0..1)      → px = x · refW
//   y → PÍXELES ABSOLUTOS desde el tope del documento (pageY) → px = y, TAL CUAL
//
// La Y **no se reproyecta**. El escenario renderiza la página real en un iframe al
// ANCHO DE REFERENCIA del grupo de viewport activo, así que el layout del iframe es
// el mismo donde se capturaron los clicks y las posiciones absolutas ya coinciden.
// (Antes se hacía (y/docH)·frameH: convertía un píxel absoluto en proporción del alto
// del documento EL DÍA DEL CLICK y lo re-multiplicaba por el alto de HOY. Como el
// contenido es dinámico —un dashboard con más pacientes es más alto— el mapa entero
// se estiraba o comprimía y los puntos caían fuera de su elemento.)
//
// Excepción: los clicks con yFixed=true se capturaron sobre un elemento
// fixed/sticky (sidebar, header pegajoso) y guardan clientY —relativo al viewport—,
// que es justo donde se ven. En el visor el iframe muestra la página desde arriba,
// así que también se dibujan en y = p.y sin sumar nada. Sólo se excluyen del cálculo
// del alto del escenario (no describen contenido del documento).

import type { HeatPoint } from "@/lib/analytics/types";

export type DeviceKey = "desktop" | "tablet" | "mobile";

/** Grupos de viewport. Mezclarlos rompe la alineación: un click de móvil (vw≈375)
 *  dibujado sobre un layout renderizado a 1280 cae donde no hay nada. */
export const DEVICE_GROUPS: { key: DeviceKey; label: string; min: number }[] = [
  { key: "desktop", label: "Escritorio", min: 1024 },
  { key: "tablet", label: "Tablet", min: 640 },
  { key: "mobile", label: "Móvil", min: 0 },
];

/** Margen bajo el click más profundo, para que su blob no quede cortado. */
const STAGE_MARGIN = 120;
/** Techo de cordura del escenario (datos basura no deben crear un lienzo infinito). */
const STAGE_MAX = 20_000;
/** Diferencia relativa a partir de la cual avisamos que la página cambió de tamaño. */
const MISMATCH_RATIO = 0.4;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function median(nums: number[]): number {
  const arr = nums.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
}

/** Percentil (método del más cercano por encima). pct en 0..100. */
export function percentile(nums: number[], pct: number): number {
  const arr = nums.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const idx = clamp(Math.ceil((pct / 100) * arr.length) - 1, 0, arr.length - 1);
  return arr[idx];
}

export function deviceOf(vw: number): DeviceKey {
  if (vw >= 1024) return "desktop";
  if (vw >= 640) return "tablet";
  return "mobile";
}

export function filterByDevice(points: HeatPoint[], key: DeviceKey): HeatPoint[] {
  return points.filter((p) => deviceOf(p.vw) === key);
}

export function countByDevice(points: HeatPoint[]): Record<DeviceKey, number> {
  const out: Record<DeviceKey, number> = { desktop: 0, tablet: 0, mobile: 0 };
  points.forEach((p) => {
    out[deviceOf(p.vw)] += 1;
  });
  return out;
}

/** Grupo con MÁS clicks (default del selector). Escritorio si no hay datos. */
export function dominantDevice(points: HeatPoint[]): DeviceKey {
  const counts = countByDevice(points);
  return DEVICE_GROUPS.reduce<DeviceKey>(
    (best, g) => (counts[g.key] > counts[best] ? g.key : best),
    "desktop",
  );
}

/** Ancho al que se renderiza el iframe = mediana de los vw del grupo activo. */
export function referenceWidth(points: HeatPoint[]): number {
  return clamp(median(points.map((p) => p.vw)) || 1280, 320, 2560);
}

/**
 * Alto del escenario: el alto real del iframe, pero nunca menos que el percentil 95
 * de las Y de los clicks (+ margen) para no recortar los que quedaron por debajo del
 * contenido actual. P95 y no el máximo: un solo outlier no debe estirar el lienzo.
 */
export function stageHeight(points: HeatPoint[], frameH: number): number {
  const ys = points.filter((p) => !p.yFixed).map((p) => p.y);
  const deep = percentile(ys, 95);
  const need = deep > 0 ? Math.ceil(deep + STAGE_MARGIN) : 0;
  return Math.min(STAGE_MAX, Math.max(frameH > 0 ? frameH : 0, need));
}

/**
 * ¿El alto de la página HOY difiere mucho del docH típico cuando se capturaron los
 * clicks? Si sí, la alineación vertical es aproximada y hay que decirlo (evita
 * perseguir un bug que no existe).
 */
export function sizeMismatch(points: HeatPoint[], frameH: number): boolean {
  const med = median(points.map((p) => p.docH));
  if (!med || frameH <= 0) return false;
  return Math.abs(frameH - med) / med > MISMATCH_RATIO;
}
