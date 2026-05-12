// Orthodontics — compliance derivada de los últimos 3 controles. SPEC §6.3 + §11.5.

import type { ControlAttendance } from "@prisma/client";
import type { ComplianceSummary } from "@/lib/types/orthodontics";

export interface ControlForCompliance {
  attendance: ControlAttendance;
  scheduledAt: Date;
  performedAt: Date | null;
}

/**
 * Toma una lista de controles ordenados por `scheduledAt` desc y calcula
 * el resumen de compliance basado en los últimos 3.
 *
 * Reglas SPEC §11.5:
 *   - 3/3 ATTENDED                         → ok
 *   - 2/3 con 1 issue (RESCHEDULED|NO_SHOW)→ warning
 *   - 1/3 con 2 issues                     → warning (downgrade visual a danger en card)
 *   - 0/3 ATTENDED                         → danger
 *   - <3 controles                         → insufficient (no se penaliza con menos data)
 */
export function summarizeCompliance(
  controls: ControlForCompliance[],
): ComplianceSummary {
  const sorted = [...controls].sort(
    (a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime(),
  );
  const last3 = sorted.slice(0, 3);

  if (last3.length < 3) {
    const attended = last3.filter((c) => c.attendance === "ATTENDED").length;
    return { level: "insufficient", attended };
  }

  const attended = last3.filter((c) => c.attendance === "ATTENDED").length as
    | 0
    | 1
    | 2
    | 3;
  const lastNoShow =
    last3.find((c) => c.attendance === "NO_SHOW")?.scheduledAt ?? null;

  if (attended === 3) {
    return { level: "ok", attended: 3 };
  }
  if (attended === 0) {
    return { level: "danger", attended: 0, lastNoShow };
  }
  return { level: "warning", attended, lastNoShow };
}

/** Indica si la compliance está en zona de riesgo de drop (0/3 ATTENDED). */
export function hasDropRisk(summary: ComplianceSummary): boolean {
  return summary.level === "danger";
}
