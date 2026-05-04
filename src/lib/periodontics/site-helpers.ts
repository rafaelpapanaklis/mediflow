// Periodontics — orden de captura, mapeo de sitios, categorías de diente. SPEC §5.4

import type { ToothCategory } from "./types";

// FDI orden tradicional sondaje (operador a la derecha mirando al paciente).
// Superior: del 18 al 11, luego 21 al 28. Inferior: del 48 al 41, luego 31 al 38.
export const FDI_ORDER_UPPER: readonly number[] = [
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
];
export const FDI_ORDER_LOWER: readonly number[] = [
  48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38,
];
export const FDI_ALL: readonly number[] = [...FDI_ORDER_UPPER, ...FDI_ORDER_LOWER];

/** Cuadrante FDI (1-4) del diente. */
export function quadrantOfFdi(fdi: number): 1 | 2 | 3 | 4 {
  return Math.floor(fdi / 10) as 1 | 2 | 3 | 4;
}

/**
 * Orden lógico de los 6 sitios al sondear: vestibular MV → MB → DV,
 * luego palatino DL → ML → MB_PAL.
 * SPEC §5.4 + §6.3 (vestibular arriba en ambas arcadas).
 *
 * TODO: validar con periodoncista real si prefiere arcada inferior
 * espejada (lingual arriba). Decisión actual: vestibular arriba en
 * ambas arcadas (Florida Probe convention según SPEC §6.3).
 */
export const SITE_CAPTURE_ORDER = ["MV", "MB", "DV", "DL", "ML", "MB_PAL"] as const;

export type SitePos = typeof SITE_CAPTURE_ORDER[number];

/**
 * Dado el sitio actual (fdi, position), devuelve el siguiente en el
 * orden de captura. Devuelve null cuando ya está en el último sitio
 * del último diente (38).
 */
export function nextSite(fdi: number, position: SitePos): { fdi: number; position: SitePos } | null {
  const sIdx = SITE_CAPTURE_ORDER.indexOf(position);
  if (sIdx === -1) return null;
  if (sIdx < SITE_CAPTURE_ORDER.length - 1) {
    return { fdi, position: SITE_CAPTURE_ORDER[sIdx + 1]! };
  }
  // Saltar al primer sitio del siguiente diente.
  const fIdx = FDI_ALL.indexOf(fdi);
  if (fIdx === -1 || fIdx === FDI_ALL.length - 1) return null;
  return { fdi: FDI_ALL[fIdx + 1]!, position: SITE_CAPTURE_ORDER[0]! };
}

/** Análogo a `nextSite` pero hacia atrás (Shift+Tab). */
export function prevSite(fdi: number, position: SitePos): { fdi: number; position: SitePos } | null {
  const sIdx = SITE_CAPTURE_ORDER.indexOf(position);
  if (sIdx === -1) return null;
  if (sIdx > 0) {
    return { fdi, position: SITE_CAPTURE_ORDER[sIdx - 1]! };
  }
  const fIdx = FDI_ALL.indexOf(fdi);
  if (fIdx <= 0) return null;
  return { fdi: FDI_ALL[fIdx - 1]!, position: SITE_CAPTURE_ORDER[SITE_CAPTURE_ORDER.length - 1]! };
}

/**
 * Categoría visual del diente para elegir SVG en `<ToothCenter />`.
 * Diferencia incisivos superiores e inferiores porque la silueta cambia.
 */
export function toothCategory(fdi: number): ToothCategory {
  const last = fdi % 10;
  const isUpper = fdi < 30;
  if (last === 1 || last === 2) return isUpper ? "incisor_upper" : "incisor_lower";
  if (last === 3) return "canine";
  if (last === 4 || last === 5) return "premolar";
  return "molar";
}

/** Sitio vestibular (MV/MB/DV) vs lingual/palatino (DL/ML/MB_PAL). */
export function isFacialSite(p: SitePos): boolean {
  return p === "MV" || p === "MB" || p === "DV";
}

/** Sitio interproximal (MV/DV/MB_PAL/DL) — usado por classifyPerio2017 §5.4. */
export function isInterproximalSite(p: SitePos): boolean {
  return p === "MV" || p === "DV" || p === "MB_PAL" || p === "DL";
}

/** Devuelve el cuadrante (Q1/Q2/Q3/Q4) en formato de label. */
export function quadrantLabel(fdi: number): "Q1" | "Q2" | "Q3" | "Q4" {
  const q = quadrantOfFdi(fdi);
  return `Q${q}` as "Q1" | "Q2" | "Q3" | "Q4";
}
