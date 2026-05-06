// Pediatrics — pure helpers para los KPIs de la página agregada.

import type {
  PediatricPatientRow,
  PediatricSpecialtyKpis,
} from "./load-patients";

/**
 * Pure helper para los 3 contadores derivados de las filas (el cuarto
 * KPI necesita data adicional). Apto para tests con datos mock.
 */
export function computePediatricCountsFromRows(
  rows: PediatricPatientRow[],
): Omit<PediatricSpecialtyKpis, "eruptionControls"> {
  const activePatients = rows.length;
  const pendingProphylaxis = rows.filter((r) => r.cariesRecallDue).length;
  const highOrExtremeCambra = rows.filter(
    (r) => r.cambra === "alto" || r.cambra === "extremo",
  ).length;
  return { activePatients, pendingProphylaxis, highOrExtremeCambra };
}
