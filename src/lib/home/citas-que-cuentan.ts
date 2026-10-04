// Cuántas citas «hay» hoy (ws1-t1, tercera ronda — N-41).
//
// EL FALLO QUE CIERRA: el Hoy de recepción decía «Agenda de hoy · 3 citas» con 2 canceladas, y el del doctor
// «2 pacientes hoy · 0 completados» con sus dos citas canceladas; la Agenda y Analítica ya no las contaban.
// Decisión 9 (primera ronda): una cita cancelada no es una cita del día. Se siguen LISTANDO (con su etiqueta
// «Cancelada»), pero no cuentan. Puro.

export function citasQueCuentan<T extends { status: string }>(citas: readonly T[]): number {
  return citas.filter((c) => c.status !== "CANCELLED").length;
}
