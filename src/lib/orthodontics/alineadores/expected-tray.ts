// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, sep-2026).
// H12: seguimiento de alineadores. Puro — sin Prisma, sin React.

export interface ExpectedTrayInput {
  startedAt: Date;
  totalTrays: number;
  changeIntervalDays: number;
  today?: Date;
}

export interface ExpectedTrayResult {
  /** Número de alineador que el paciente debería traer hoy, acotado a [1, totalTrays]. */
  expectedTray: number;
  daysSinceStart: number;
  /** true si ya pasó la fecha del último alineador planeado (candidato a refinamiento o retención). */
  isPastLastTray: boolean;
}

/** Qué número de alineador correspondería hoy según la fecha de inicio y el intervalo de cambio. */
export function computeExpectedTray(input: ExpectedTrayInput): ExpectedTrayResult {
  const today = input.today ?? new Date();
  const intervalDays = Math.max(1, input.changeIntervalDays);
  const totalTrays = Math.max(1, input.totalTrays);
  const daysSinceStart = Math.max(
    0,
    Math.floor((today.getTime() - input.startedAt.getTime()) / 86_400_000),
  );
  const raw = Math.floor(daysSinceStart / intervalDays) + 1;
  const expectedTray = Math.min(Math.max(1, raw), totalTrays);
  return { expectedTray, daysSinceStart, isPastLastTray: raw > totalTrays };
}

export type TrayComplianceStatus = "on-track" | "behind" | "ahead";

export interface TrayComplianceResult {
  delta: number;
  status: TrayComplianceStatus;
}

/** Compara el alineador que el paciente dice traer contra el esperado. */
export function compareTrayToExpected(currentTray: number, expectedTray: number): TrayComplianceResult {
  const delta = currentTray - expectedTray;
  return { delta, status: delta === 0 ? "on-track" : delta < 0 ? "behind" : "ahead" };
}
