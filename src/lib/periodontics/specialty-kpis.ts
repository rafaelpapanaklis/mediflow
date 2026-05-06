// Periodontics — pure helpers para los KPIs de la página agregada.

import type { PeriodontalPhase } from "@prisma/client";

export interface PerioPlanInput {
  currentPhase: PeriodontalPhase;
  nextEvaluationAt: Date | null;
}

/**
 * Pure helper: clasifica los planes en mantenimientos vencidos
 * (PHASE_4 con nextEvaluationAt vencido) vs reevaluaciones pendientes
 * (otra fase con nextEvaluationAt vencido).
 */
export function classifyPerioPlans(
  plans: PerioPlanInput[],
  now: Date,
): { overdueMaintenance: number; pendingReevaluations: number } {
  let overdueMaintenance = 0;
  let pendingReevaluations = 0;
  for (const p of plans) {
    if (!p.nextEvaluationAt || p.nextEvaluationAt >= now) continue;
    if (p.currentPhase === "PHASE_4") overdueMaintenance++;
    else pendingReevaluations++;
  }
  return { overdueMaintenance, pendingReevaluations };
}
