// Orthodontics — agrupamiento por OrthoPhaseKey con cap 50 por columna. SPEC §6.2.
//
// Construye el shape `Map<OrthoPhaseKey, OrthoKanbanCard[]>` que el server
// component de la página dedicada (/dashboard/specialties/orthodontics)
// consume para renderizar el board.

import type { OrthoPhaseKey } from "@prisma/client";
import type { OrthoKanbanCard } from "@/lib/types/orthodontics";
import { PHASE_ORDER } from "./phase-machine";

export const KANBAN_COLUMN_CAP = 50;

/** Resultado del agrupamiento — incluye truncated count para banner UI. */
export interface KanbanGroup {
  phaseKey: OrthoPhaseKey;
  cards: OrthoKanbanCard[];
  /** Total real de pacientes activos en esta fase (puede exceder KANBAN_COLUMN_CAP). */
  totalCount: number;
  /** Cards omitidos por el cap. UI muestra banner cuando >0. */
  truncatedCount: number;
}

/**
 * Agrupa cards por fase actual, ordena por `monthInTreatment` desc dentro de
 * cada columna, y aplica cap 50. Las fases vacías se incluyen para que la UI
 * dibuje las 6 columnas siempre.
 */
export function groupCardsByPhase(
  cards: OrthoKanbanCard[],
): Map<OrthoPhaseKey, KanbanGroup> {
  const buckets = new Map<OrthoPhaseKey, OrthoKanbanCard[]>();
  for (const phase of PHASE_ORDER) {
    buckets.set(phase, []);
  }
  for (const card of cards) {
    const list = buckets.get(card.currentPhaseKey);
    if (list) list.push(card);
  }

  const result = new Map<OrthoPhaseKey, KanbanGroup>();
  for (const phase of PHASE_ORDER) {
    const list = buckets.get(phase) ?? [];
    list.sort((a, b) => b.monthInTreatment - a.monthInTreatment);
    const totalCount = list.length;
    const trimmed = list.slice(0, KANBAN_COLUMN_CAP);
    result.set(phase, {
      phaseKey: phase,
      cards: trimmed,
      totalCount,
      truncatedCount: Math.max(0, totalCount - trimmed.length),
    });
  }
  return result;
}

/** Calcula `progressPct` clamped a [0, 100] desde monthInTreatment / estimated. */
export function progressPct(monthInTreatment: number, estimated: number): number {
  if (estimated <= 0) return 0;
  const raw = (monthInTreatment / estimated) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** Etiqueta de la fase para los headers de columna del kanban. */
export const PHASE_LABELS: Record<OrthoPhaseKey, string> = {
  ALIGNMENT: "Alineación",
  LEVELING: "Nivelación",
  SPACE_CLOSURE: "Cierre de espacios",
  DETAILS: "Detalles",
  FINISHING: "Finalización",
  RETENTION: "Retención",
};
