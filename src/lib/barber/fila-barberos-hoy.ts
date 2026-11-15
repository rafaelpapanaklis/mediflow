/**
 * Los barberos que la fila pública ofrece en «¿Con quién te quieres cortar?»
 * (lógica L3, 15-nov).
 *
 * La fila es para HOY. Antes salían todos los barberos activos, también el que
 * descansa hoy o el que no tiene horario: el cliente se anotaba con él y
 * esperaba a alguien que no iba a llegar.
 *
 * - Solo quien tiene un turno activo el día de hoy (en la zona de la barbería).
 * - Si NADIE en la barbería tiene horario cargado (barbería que solo usa la
 *   fila), no se filtra: no hay con qué decidir y quitar a todos sería peor.
 */

/** Día de la semana (0 = domingo, como BarberSchedule) en la zona dada. */
export function diaDeHoyEnZona(ahora: Date, timeZone: string): number {
  let corto: string;
  try {
    corto = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(ahora);
  } catch {
    corto = new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", weekday: "short" }).format(ahora);
  }
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(corto);
}

export function barberosQueTrabajanHoy<T extends { schedules: { dayOfWeek: number }[] }>(
  barberos: T[],
  hoy: number,
): T[] {
  const alguienConHorario = barberos.some((b) => b.schedules.length > 0);
  if (!alguienConHorario) return barberos;
  return barberos.filter((b) => b.schedules.some((s) => s.dayOfWeek === hoy));
}
