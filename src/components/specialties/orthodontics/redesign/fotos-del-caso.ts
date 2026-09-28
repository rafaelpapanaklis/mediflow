// Ortodoncia — qué se puede hacer con los juegos de fotos que ya carga la ficha
// (`historicalPhotoSets` del bundle, con las URLs firmadas por vista en `slots`).
// PURO: lo usan «Comparar» (ModalCompare) y el botón «Reporte de avance (PDF)»
// de Documentos, y lo prueban los tests en node.

import type { CompareSet } from "./drawers/ModalCompare";
import type { PhotoSetSummary, PhotoStage } from "./sections/SectionPhotos";

/** Etapas que se comparan contra el juego inicial (T0). */
export const ETAPAS_POSTERIORES: readonly PhotoStage[] = ["T1", "T2", "CONTROL"];

export const MOTIVO_SIN_REPORTE_DE_AVANCE = "Hace falta el juego de fotos inicial y uno posterior";

function tieneFotos(s: PhotoSetSummary): boolean {
  return Object.values(s.slots ?? {}).some((v) => Boolean(v?.url));
}

function masReciente(a: PhotoSetSummary, b: PhotoSetSummary): PhotoSetSummary {
  const fa = a.date ? Date.parse(a.date) : Number.NEGATIVE_INFINITY;
  const fb = b.date ? Date.parse(b.date) : Number.NEGATIVE_INFINITY;
  return fb > fa ? b : a;
}

/**
 * ¿Sale el «Reporte de avance»? La misma regla que su ruta
 * (`progress-report-pdf`): un juego T0 y uno posterior (T2, T1 o CONTROL).
 */
export function hayReporteDeAvance(sets: readonly PhotoSetSummary[]): boolean {
  return sets.some((s) => s.stage === "T0") && sets.some((s) => ETAPAS_POSTERIORES.includes(s.stage));
}

/** El juego de esa etapa con fotos, el más reciente (en CONTROL hay uno por visita). */
export function juegoParaComparar(sets: readonly PhotoSetSummary[], stage: PhotoStage): CompareSet | null {
  const candidatos = sets.filter((s) => s.stage === stage && tieneFotos(s));
  if (candidatos.length === 0) return null;
  const elegido = candidatos.reduce(masReciente);
  const photos: Record<string, string | null> = {};
  for (const [slotId, v] of Object.entries(elegido.slots ?? {})) photos[slotId] = v?.url || null;
  return { stage, takenAt: elegido.date, photos };
}

/** Etapas posteriores que tienen fotos para ponerlas junto al inicial. */
export function etapasParaComparar(sets: readonly PhotoSetSummary[]): PhotoStage[] {
  return ETAPAS_POSTERIORES.filter((e) => sets.some((s) => s.stage === e && tieneFotos(s)));
}

/** «Comparar» solo tiene sentido con fotos en el inicial y en al menos una etapa posterior. */
export function sePuedeComparar(sets: readonly PhotoSetSummary[]): boolean {
  return juegoParaComparar(sets, "T0") !== null && etapasParaComparar(sets).length > 0;
}

/** Con qué etapa se abre la comparación: la posterior más reciente («actual»). */
export function etapaActualParaComparar(sets: readonly PhotoSetSummary[]): PhotoStage | null {
  const posteriores = sets.filter((s) => ETAPAS_POSTERIORES.includes(s.stage) && tieneFotos(s));
  if (posteriores.length === 0) return null;
  return posteriores.reduce(masReciente).stage;
}
