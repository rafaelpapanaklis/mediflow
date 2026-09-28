// Ortodoncia — Ola 0 (ws1-t1): el texto de Appointment.type para una cita de
// CONTROL de ortodoncia (decisión 2 de la arquitectura, REPORTE-ws1-t8.md).
//
// `Appointment.type` es texto libre, no un enum (prisma/schema.prisma). Una
// sola constante para que quien CREA la cita (parte «Control y agenda»,
// new-appointment-dialog.tsx) y quien la LEE (RanuraCita, Recepción, el
// cron de alertas) comparen exactamente el mismo texto — nada de que uno
// escriba "Control ortodoncia" y otro busque "Control de Ortodoncia".
export const TIPO_CITA_CONTROL_ORTO = "Control de ortodoncia";

/** ¿Esta cita es un control de ortodoncia? Compara por el texto exacto de arriba. */
export function esCitaControlOrto(tipo: string | null | undefined): boolean {
  return tipo === TIPO_CITA_CONTROL_ORTO;
}
