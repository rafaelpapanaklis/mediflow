// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, sep-2026). H14:
// cumplimiento de elásticos/horas de uso, reportado por el paciente día a
// día. Puro — sin Prisma, sin React. El umbral 70% ya existía como
// constante suelta en __tests__/elastics-compliance.test.ts; esta es la
// implementación real detrás de ese umbral.

export const LOW_COMPLIANCE_THRESHOLD = 70;

export interface ElasticsLogEntry {
  /** YYYY-MM-DD, un registro por día (upsert en la base). */
  date: string;
  wornHours: number | null;
  usedElastics: boolean;
}

export interface ComplianceSummary {
  windowDays: number;
  loggedDays: number;
  /** % de días de la ventana que cumplieron la meta. Días sin registrar cuentan como no cumplidos. */
  compliancePct: number | null;
  avgHours: number | null;
  isLow: boolean;
}

/**
 * Un día "cumple" si registró horas ≥ la meta, o si no se registran horas
 * pero el paciente marcó que sí usó elásticos/alineador ese día.
 */
export function summarizeElasticsCompliance(
  logs: ElasticsLogEntry[],
  opts: { windowDays: number; targetHoursPerDay: number },
): ComplianceSummary {
  const metDays = logs.filter((l) => {
    if (typeof l.wornHours === "number") return l.wornHours >= opts.targetHoursPerDay;
    return l.usedElastics;
  }).length;

  const hoursLogged = logs
    .map((l) => l.wornHours)
    .filter((h): h is number => typeof h === "number");
  const avgHours = hoursLogged.length
    ? round1(hoursLogged.reduce((acc, h) => acc + h, 0) / hoursLogged.length)
    : null;

  const compliancePct = opts.windowDays > 0 ? round1((metDays / opts.windowDays) * 100) : null;

  return {
    windowDays: opts.windowDays,
    loggedDays: logs.length,
    compliancePct,
    avgHours,
    isLow: compliancePct !== null && compliancePct < LOW_COMPLIANCE_THRESHOLD,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
