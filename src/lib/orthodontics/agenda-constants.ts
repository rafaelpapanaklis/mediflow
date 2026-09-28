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

// Ola 1 (ws1-t4, Control y agenda, sep-2026) — C7 del documento de alcance
// («NUEVO Tipos de cita de ortodoncia»): el catálogo de motivos que
// `new-appointment-dialog.tsx` ofrece como chips cuando el módulo de
// Ortodoncia está activo. A propósito NO pasan por `t()` (i18n): igual que
// TIPO_CITA_CONTROL_ORTO, son el valor exacto que queda en
// `Appointment.type` (texto libre) y que el resto de partes (Recepción, el
// tablero) van a comparar por string — traducirlos rompería esa
// comparación en clínicas con la UI en inglés. Español fijo, a propósito.
export const ORTHO_APPOINTMENT_REASONS: readonly string[] = [
  "Valoración de ortodoncia",
  "Toma de registros de ortodoncia",
  "Colocación de aparatología",
  TIPO_CITA_CONTROL_ORTO,
  "Urgencia de ortodoncia",
  "Retiro de aparatología",
  "Control de retención",
];
