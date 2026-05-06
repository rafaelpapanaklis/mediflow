// Endodontics — pure helpers para los KPIs de la página agregada.

import type { EndoPatientRow, EndoSpecialtyKpis } from "./load-patients";

/**
 * Pure helper para los 3 contadores derivados de las filas (el cuarto
 * KPI requiere un count query). Apto para tests con datos mock.
 */
export function computeEndoCountsFromRows(
  rows: EndoPatientRow[],
): Omit<EndoSpecialtyKpis, "pendingFollowUps"> {
  const activeTreatments = rows.filter((r) => r.outcomeStatus === "EN_CURSO").length;
  const retreatmentsActive = rows.filter(
    (r) => r.treatmentType === "RETRATAMIENTO" && r.outcomeStatus === "EN_CURSO",
  ).length;
  const pendingRestorations = rows.filter((r) => r.needsRestoration).length;
  return { activeTreatments, retreatmentsActive, pendingRestorations };
}
