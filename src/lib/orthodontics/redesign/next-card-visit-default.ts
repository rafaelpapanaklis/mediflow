// H22 (QA ws1-t9) — pura, sin React.
//
// El cajón "Nuevo control" abierto DIRECTO desde la ficha (no desde una cita
// de la Agenda, que ya trae su propia hora real — ver
// getTreatmentCardContextForAppointment.ts) usaba `new Date().toISOString()`
// como fecha de la visita. "Próximo control en N semanas" hereda esa hora
// tal cual (mismo minuto, N semanas después): si alguien abre el cajón a
// las 03:24 (la hora del SERVIDOR, no la de la clínica), el control
// sugerido queda a las 03:24 — nada que ver con un horario de consulta.
//
// Si el paciente ya tiene una cita de control agendada para HOY, esa hora
// es la de consulta real y hay que usarla en vez de la del reloj del
// servidor en el instante del clic.
function esMismoDiaCalendario(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function proximaFechaDeVisitaPorDefecto(
  nextAppointmentIso: string | null | undefined,
  ahora: Date = new Date(),
): string {
  if (nextAppointmentIso) {
    const cita = new Date(nextAppointmentIso);
    if (!isNaN(cita.getTime()) && esMismoDiaCalendario(cita, ahora)) {
      return nextAppointmentIso;
    }
  }
  return ahora.toISOString();
}
