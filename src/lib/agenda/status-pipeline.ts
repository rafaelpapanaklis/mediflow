import type { AppointmentStatus } from "./types";

/**
 * Pipeline visual de estados (camino feliz). Estados terminales (CANCELLED,
 * NO_SHOW) van por el menú "Más" en la card y panel detail.
 */
export const STATUS_PIPELINE: AppointmentStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_PROGRESS",
  "COMPLETED",
];

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED:    "Programada",
  CONFIRMED:    "Confirmada",
  CHECKED_IN:   "Check-in",
  IN_CHAIR:     "En sillón",
  IN_PROGRESS:  "En consulta",
  COMPLETED:    "Completada",
  CHECKED_OUT:  "Check-out",
  CANCELLED:    "Cancelada",
  NO_SHOW:      "No vino",
};

/**
 * Etiqueta para el botón de "siguiente estado" (acción, no estado).
 */
export const NEXT_STATUS_ACTION_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED:    "Programar",
  CONFIRMED:    "Confirmar",
  CHECKED_IN:   "Check-in",
  IN_CHAIR:     "Sentar en sillón",
  IN_PROGRESS:  "Iniciar consulta",
  COMPLETED:    "Completar",
  CHECKED_OUT:  "Check-out",
  CANCELLED:    "",
  NO_SHOW:      "",
};

export interface NextStep {
  status: AppointmentStatus;
  label: string;
}

/**
 * Devuelve el "siguiente estado lógico" (paso adelante en el pipeline) o null
 * si el estado es terminal o ya está al final.
 */
export function nextLogicalStatus(current: AppointmentStatus): NextStep | null {
  // Terminales pueden re-abrir → SCHEDULED (sólo admin a nivel server,
  // pero la UI muestra el botón; el server rechazará si rol insuficiente).
  if (current === "CANCELLED" || current === "NO_SHOW") {
    return { status: "SCHEDULED", label: "Re-abrir" };
  }
  const idx = STATUS_PIPELINE.indexOf(current);
  if (idx === -1 || idx >= STATUS_PIPELINE.length - 1) return null;
  const next = STATUS_PIPELINE[idx + 1]!;
  return { status: next, label: NEXT_STATUS_ACTION_LABEL[next] };
}

/**
 * Estados "off-the-rails" disponibles desde el estado actual (sólo para
 * mostrar en el menú "Más"; la state machine real vive en transitions.ts y
 * será la última palabra).
 */
export function offRailsStatuses(current: AppointmentStatus): AppointmentStatus[] {
  if (current === "CANCELLED" || current === "NO_SHOW") return ["SCHEDULED"];
  if (current === "COMPLETED") return [];
  // En curso (IN_PROGRESS) o anterior: cancelar siempre; no-show sólo si
  // todavía no comenzó.
  if (current === "IN_PROGRESS") return ["CANCELLED"];
  return ["CANCELLED", "NO_SHOW"];
}

/**
 * Posición del estado actual en el pipeline para visualización.
 * Estados terminales caen "fuera" del pipeline (índice -1).
 */
export function pipelinePosition(current: AppointmentStatus): number {
  return STATUS_PIPELINE.indexOf(current);
}

export function isTerminal(status: AppointmentStatus): boolean {
  return status === "CANCELLED" || status === "NO_SHOW" || status === "COMPLETED";
}
