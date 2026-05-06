// Periodontics — recordatorios de mantenimiento perio (puro, no-IO).
// SPEC §13.1 (Berna) + COMMIT 11.

import type { ClinicalReminderType, PeriodontalRiskCategory } from "@prisma/client";

export type MaintenanceMonths = 3 | 4 | 6;

/**
 * Mapea recall meses (Berna recomienda 3/4/6) al valor enum schema. Si la
 * entrada no es uno de los 3, redondea al más cercano para encajar.
 */
export function maintenanceReminderTypeForMonths(
  months: number,
): ClinicalReminderType {
  const clamped: MaintenanceMonths = months <= 3 ? 3 : months <= 4 ? 4 : 6;
  switch (clamped) {
    case 3:
      return "perio_maintenance_3m";
    case 4:
      return "perio_maintenance_4m";
    case 6:
      return "perio_maintenance_6m";
  }
}

export function recallMonthsForRisk(
  risk: PeriodontalRiskCategory | null | undefined,
): MaintenanceMonths {
  switch (risk) {
    case "ALTO":
      return 3;
    case "MODERADO":
      return 4;
    case "BAJO":
      return 6;
    default:
      // Conservador: sin evaluación de riesgo previa, asumir recall corto
      // (3m) hasta que el doctor evalúe formalmente.
      return 3;
  }
}

export function dueDateForMaintenance(
  months: MaintenanceMonths,
  from: Date = new Date(),
): Date {
  const out = new Date(from);
  out.setMonth(out.getMonth() + months);
  return out;
}

export const MAINTENANCE_REMINDER_TYPES = [
  "perio_maintenance_3m",
  "perio_maintenance_4m",
  "perio_maintenance_6m",
] as const satisfies ReadonlyArray<ClinicalReminderType>;
