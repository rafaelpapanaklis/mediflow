// Cómo Reportes nombra y cuenta los estados de cita.
//
// 12i (ticket 3 de BEVADENT): el mapa de etiquetas de la gráfica «Citas por
// estado» no tenía SCHEDULED, CHECKED_IN, IN_CHAIR ni CHECKED_OUT y pintaba el
// código crudo («SCHEDULED», «CHECKED_OUT») — BEVADENT tiene 22 y 3 de esas.
// Y la «tasa de atención» no contaba CHECKED_OUT, que también es una cita
// atendida (el paciente salió después de COMPLETED).
//
// Puro (sin React ni Prisma) para poder probarlo. Las llaves son del
// diccionario `analytics.reports.*`, es y en.

/** Estado de cita → llave del diccionario. Cubre los 10 del enum de la base. */
export const STATUS_LABEL_KEYS: Record<string, string> = {
  PENDING: "analytics.reports.statusPending",
  SCHEDULED: "analytics.reports.statusScheduled",
  CONFIRMED: "analytics.reports.statusConfirmed",
  CHECKED_IN: "analytics.reports.statusCheckedIn",
  IN_CHAIR: "analytics.reports.statusInChair",
  IN_PROGRESS: "analytics.reports.statusInProgress",
  COMPLETED: "analytics.reports.statusCompleted",
  CHECKED_OUT: "analytics.reports.statusCheckedOut",
  CANCELLED: "analytics.reports.statusCancelled",
  NO_SHOW: "analytics.reports.statusNoShow",
};

/** Una cita «atendida»: el paciente vino y se le atendió (COMPLETED y su cierre, CHECKED_OUT). */
export const ESTADOS_ATENDIDOS: readonly string[] = ["COMPLETED", "CHECKED_OUT"];

/**
 * El nombre que se ve en la gráfica. Un estado que no se conozca (uno nuevo del
 * enum al que aún nadie le puso etiqueta) sale como «Otro», nunca como el
 * código en inglés.
 */
export function nombreDeEstado(status: string, t: (key: string) => string): string {
  const llave = STATUS_LABEL_KEYS[status];
  return llave ? t(llave) : t("analytics.reports.statusOther");
}

/** % de citas atendidas sobre el total, redondeado; 0 sin citas. */
export function tasaDeAtendidas(porEstado: ReadonlyArray<{ status: string; _count: { id: number } }>): number {
  const total = porEstado.reduce((s, b) => s + b._count.id, 0);
  if (total <= 0) return 0;
  const atendidas = porEstado.filter((b) => ESTADOS_ATENDIDOS.includes(b.status)).reduce((s, b) => s + b._count.id, 0);
  return Math.round((atendidas / total) * 100);
}
