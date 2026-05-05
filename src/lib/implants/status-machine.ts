// Implants — máquina de estados de currentStatus. Spec §5 helpers.
// 10 transiciones válidas. REMOVED es estado terminal.
// FUNCTIONAL no regresa a PLANNED (decisión de irreversibilidad clínica).

import type { ImplantStatus } from "@prisma/client";

/**
 * Transiciones válidas por estado origen. Si la transición destino
 * es `REMOVED`, la server action `removeImplant` debe encargarse — no
 * se hace por `updateImplantStatus` directo (Spec §5).
 */
const TRANSITIONS: Readonly<Record<ImplantStatus, ReadonlyArray<ImplantStatus>>> = {
  PLANNED: ["PLACED", "REMOVED"],
  PLACED: ["OSSEOINTEGRATING", "FAILED", "REMOVED"],
  OSSEOINTEGRATING: [
    "UNCOVERED",
    "LOADED_PROVISIONAL",
    "LOADED_DEFINITIVE",
    "COMPLICATION",
    "FAILED",
    "REMOVED",
  ],
  UNCOVERED: [
    "LOADED_PROVISIONAL",
    "LOADED_DEFINITIVE",
    "COMPLICATION",
    "FAILED",
    "REMOVED",
  ],
  LOADED_PROVISIONAL: [
    "LOADED_DEFINITIVE",
    "COMPLICATION",
    "FAILED",
    "REMOVED",
  ],
  LOADED_DEFINITIVE: ["FUNCTIONAL", "COMPLICATION", "FAILED", "REMOVED"],
  FUNCTIONAL: ["COMPLICATION", "FAILED", "REMOVED"],
  COMPLICATION: ["FUNCTIONAL", "FAILED", "REMOVED"],
  FAILED: ["REMOVED"],
  REMOVED: [], // terminal
};

/** True si `from` puede transicionar a `to`. */
export function isValidTransition(from: ImplantStatus, to: ImplantStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Lista de estados destino válidos desde `from`. */
export function nextValidStatuses(from: ImplantStatus): ReadonlyArray<ImplantStatus> {
  return TRANSITIONS[from];
}

/** Estado terminal — no admite ninguna transición saliente. */
export function isTerminal(status: ImplantStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
