// Orthodontics — pure helpers para los KPIs de la página agregada.
// Aislado de load-patients.ts (que importa prisma en runtime) para que los
// tests puedan ejecutarse sin DATABASE_URL.

import type { OrthoTreatmentStatus } from "@prisma/client";
import type {
  OrthoPatientRow,
  OrthoSpecialtyKpis,
} from "./load-patients";

const ACTIVE_PLAN_STATUSES: OrthoTreatmentStatus[] = [
  "PLANNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "RETENTION",
];

/**
 * Deriva los KPIs spec a partir de las filas y el conteo separado de
 * citas de hoy. Pure — apto para tests con datos mock.
 */
export function computeOrthoKpis(
  rows: OrthoPatientRow[],
  todayAppointments: number,
): OrthoSpecialtyKpis {
  const activeTreatments = rows.filter(
    (r) =>
      r.treatmentPlanId !== null &&
      ACTIVE_PLAN_STATUSES.includes(r.status as OrthoTreatmentStatus),
  ).length;

  const overdueRows = rows.filter(
    (r) => r.paymentStatus === "LIGHT_DELAY" || r.paymentStatus === "SEVERE_DELAY",
  );
  const overduePaymentsCount = overdueRows.length;
  const overduePaymentsAmountMxn = overdueRows.reduce((s, r) => s + r.amountOverdueMxn, 0);

  const finishingSoon = rows.filter((r) => {
    if (r.estimatedDurationMonths === null || r.monthInTreatment === null) return false;
    const remaining = r.estimatedDurationMonths - r.monthInTreatment;
    return remaining >= 0 && remaining <= 1 && r.status === "IN_PROGRESS";
  }).length;

  return {
    activeTreatments,
    todayAppointments,
    overduePaymentsCount,
    overduePaymentsAmountMxn,
    finishingSoon,
  };
}
