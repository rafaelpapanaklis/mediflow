// Orthodontics — Ola 1 (ws1-t4, Control y agenda, sep-2026), C1 del documento de alcance.
//
// Gap real (REPORTE-ws1-t8.md): la cabecera del caso muestra "arco actual" a partir del
// OrthoWireStep con status === "ACTIVE" (adapter.ts), pero ese status lo pone quien planea la
// secuencia de arcos (Alta del caso) — no se actualiza solo cuando el doctor anota en una hoja de
// control que YA cambió de arco. Recomendación del alcance: "mostrar como arco actual el último que
// se anotó en un control". Función pura, sin I/O — la usa `adapter.ts` (adaptToOrthoRedesignViewModel).

import type { TreatmentCardDTO, WireStepDTO } from "@/components/specialties/orthodontics/redesign/types";

/**
 * El arco actual del caso: el `wireTo` de la hoja de control FIRMADA más reciente (por
 * `visitDate`), y si no hay ninguna hoja firmada con wire anotado, cae al wire con
 * `status === "ACTIVE"` de la secuencia planeada (comportamiento de antes de C1, para casos sin
 * controles todavía).
 */
export function resolveCurrentWire(
  wireSteps: readonly WireStepDTO[],
  treatmentCards: readonly TreatmentCardDTO[],
): WireStepDTO | null {
  const lastSignedWithWire = treatmentCards
    .filter((c) => c.status === "SIGNED" && c.wireTo)
    .slice()
    .sort((a, b) => new Date(b.visitDate).getTime() - new Date(a.visitDate).getTime())[0];

  if (lastSignedWithWire?.wireTo) return lastSignedWithWire.wireTo;

  return wireSteps.find((w) => w.status === "ACTIVE") ?? null;
}
