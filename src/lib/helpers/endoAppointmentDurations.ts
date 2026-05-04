// Endodontics — sugerencia de duración de cita por motivo. Spec §10.1

/**
 * Sugiere duración (en minutos) según el texto libre del motivo.
 * El doctor puede editar manualmente; este helper solo pre-llena.
 *
 * - Control / seguimiento → 45 min (corto, solo radiografía + revisión).
 * - Retratamiento → 90 min (más complejo que TC primario).
 * - Cirugía apical / apicectomía → 90 min.
 * - TC primario → 90 min.
 * - Pulpotomía de emergencia → 30 min.
 * - Cualquier otro motivo endodóntico → 60 min default.
 */
export function suggestEndoAppointmentDuration(reason: string): number {
  const lower = reason.toLowerCase();
  if (lower.includes("control") || lower.includes("seguimiento")) return 45;
  if (lower.includes("retratamiento")) return 90;
  if (lower.includes("apicectom") || lower.includes("cirug")) return 90;
  if (lower.includes("tc") || lower.includes("tratamiento de conduct")) return 90;
  if (lower.includes("pulpotom")) return 30;
  return 60;
}

/**
 * Detecta si el motivo de la cita es endodóntico (para activar pre-fill
 * SOAP, sugerencia de duración, banner de TC activo, etc.). Insensible
 * a mayúsculas y robusto a typos comunes.
 */
export function isEndodonticReason(reason: string): boolean {
  const lower = reason.toLowerCase();
  return (
    lower.includes("endo") ||
    lower.includes("conduct") ||
    lower.includes("pulp") ||
    lower.includes("apicectom") ||
    lower.includes("retratamiento") ||
    lower.includes("control endodóntico") ||
    lower.includes("control endodontico")
  );
}
