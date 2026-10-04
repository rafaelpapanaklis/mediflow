// ─────────────────────────────────────────────────────────────────────────────
// Desde cuándo cuenta una cita al CERRAR la consulta (tercera auditoría, F-2).
//
// La regla de la agenda (N-42, `completarNoFutura`) no deja completar una cita que todavía no empieza: una cita del
// 7-oct no se da por atendida el 4. Pero una consulta INICIADA hoy, temprano, en una cita de hoy más tarde (cita de
// las 14:00, el paciente llegó y se le atendió a las 06:21) quedaba abierta: «Completar consulta» daba 409 y la
// salida era editar la hora de la cita.
//
// Aquí: si la consulta ya se inició (`IN_PROGRESS` con `startedAt`) y la cita es de HOY en la zona de la clínica, la
// regla se mide contra el inicio REAL (`startedAt`), que es cuando de verdad empezó. Una cita de otro día sigue
// rechazándose igual que siempre. PURO.
// ─────────────────────────────────────────────────────────────────────────────

function dia(d: Date, zona: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function inicioParaCompletar(
  cita: { status: string; startsAt: Date; startedAt?: Date | null },
  ahora: Date,
  zona: string | null | undefined,
): Date {
  const z = zona || "America/Mexico_City";
  if (cita.status === "IN_PROGRESS" && cita.startedAt && cita.startedAt < cita.startsAt && dia(cita.startsAt, z) === dia(ahora, z)) {
    return cita.startedAt;
  }
  return cita.startsAt;
}
