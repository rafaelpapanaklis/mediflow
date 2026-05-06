// Implants — pure helpers para los KPIs de la página agregada.

import type { ImplantStatus } from "@prisma/client";
import type { ImplantPatientRow, ImplantSpecialtyKpis } from "./load-patients";

const PROSTHETIC_STATUSES: ImplantStatus[] = [
  "UNCOVERED",
  "LOADED_PROVISIONAL",
  "LOADED_DEFINITIVE",
];

/**
 * Pure helper para los 3 contadores derivados de las filas (el cuarto KPI
 * requiere count query). Apto para tests con datos mock.
 */
export function computeImplantCountsFromRows(
  rows: ImplantPatientRow[],
): Omit<ImplantSpecialtyKpis, "pendingAnnualControls"> {
  const activeImplants = rows.filter(
    (r) => r.status !== "REMOVED" && r.status !== "FAILED",
  ).length;
  const inHealing = rows.filter((r) => r.status === "OSSEOINTEGRATING").length;
  const inProsthetic = rows.filter((r) => PROSTHETIC_STATUSES.includes(r.status)).length;
  return { activeImplants, inHealing, inProsthetic };
}
