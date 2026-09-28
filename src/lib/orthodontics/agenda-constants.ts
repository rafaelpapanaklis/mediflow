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

/**
 * H40: citas de un caso de ortodoncia en las que también tiene sentido abrir la
 * hoja de control (urgencia por bracket caído, colocación, retiro, control de
 * retención), no solo el «Control de ortodoncia» mensual. SOLO decide si el
 * panel de la cita ofrece la hoja: la facturación automática sigue colgada de
 * `esCitaControlOrto` (signTreatmentCard.ts) y no cambia.
 */
const TIPOS_CITA_CON_HOJA = [
  TIPO_CITA_CONTROL_ORTO,
  "Urgencia de ortodoncia",
  "Colocación de aparatología",
  "Retiro de aparatología",
  "Control de retención",
];

export function esCitaOrtoConHoja(tipo: string | null | undefined): boolean {
  return tipo != null && TIPOS_CITA_CON_HOJA.includes(tipo);
}

// Ola 1 (ws1-t4, Control y agenda, sep-2026) — C7 del documento de alcance
// («NUEVO Tipos de cita de ortodoncia»): el catálogo de motivos vivía aquí,
// como lista fija. Ola 1 (ws1-t3, Acceso y permisos, ajuste): unificado con
// el catálogo editable de Configuración (`src/lib/orthodontics/
// clinic-settings-db.ts`, `DEFAULT_ORTHO_APPOINTMENT_TYPES`) — esa lista es
// ahora la ÚNICA fuente de los textos (y de sus valores por defecto);
// `new-appointment-dialog.tsx` los pide vía `/api/orthodontics/context`, que
// devuelve el catálogo de la clínica (el suyo si lo personalizó en
// Configuración, si no los defaults). Sin este re-export: quien necesite el
// catálogo para agendar importa de `clinic-settings-db.ts`, no de aquí — así
// no vuelven a existir dos listas que puedan divergir.
