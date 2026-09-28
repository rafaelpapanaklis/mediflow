// Ortodoncia — X1: las personas que se cuelgan de un caso (responsable del
// pago, doctor tratante, doctor que refirió) llegan como ids del navegador y
// NO se dan por buenas: tienen que ser de la clínica de la sesión (y el
// responsable puede ser el de un hermano: decisión 5). Aquí vive solo la regla, pura y
// con test; la consulta está en `validar-personas-del-caso-db.ts`.

export interface PersonasDelCaso {
  /** Guardian — de esta clínica (puede ser el de un hermano: decisión 5). */
  responsibleGuardianId?: string | null;
  /** User de esta clínica que atiende pacientes. */
  treatingDoctorId?: string | null;
  /** DoctorContact (directorio de la clínica). */
  referredByDoctorId?: string | null;
}

export type PersonaDelCaso = keyof PersonasDelCaso;

export const MENSAJE_PERSONA_AJENA: Record<PersonaDelCaso, string> = {
  responsibleGuardianId:
    "El responsable del pago no está registrado en tu clínica. Elige uno de la lista o regístralo de nuevo.",
  treatingDoctorId:
    "El doctor tratante no es un doctor activo de tu clínica. Elige uno de la lista.",
  referredByDoctorId:
    "El doctor que refirió no está en el directorio de tu clínica. Elige uno de la lista.",
};

export const MENSAJE_SIN_CLINICA = "No se pudo identificar tu clínica. Vuelve a iniciar sesión.";

const ORDEN: PersonaDelCaso[] = ["responsibleGuardianId", "treatingDoctorId", "referredByDoctorId"];

/**
 * Qué ids hay que comprobar contra la base. Se salta lo vacío (quitar a la
 * persona siempre se puede) y lo que ya estaba guardado en el caso con ese
 * mismo valor: reenviar el doctor de siempre aunque hoy esté dado de baja no
 * debe bloquear el resto de la edición.
 */
export function idsPorComprobar(
  pedidas: PersonasDelCaso,
  actuales: PersonasDelCaso = {},
): Partial<Record<PersonaDelCaso, string>> {
  const fuera: Partial<Record<PersonaDelCaso, string>> = {};
  for (const k of ORDEN) {
    const v = pedidas[k];
    if (typeof v !== "string" || v.length === 0) continue;
    if (actuales[k] != null && actuales[k] === v) continue;
    fuera[k] = v;
  }
  return fuera;
}

/**
 * Con lo que la base encontró (`true` = sí es de la clínica), el mensaje de
 * la PRIMERA persona ajena, o `null` si todas están bien. Lo que no se pidió
 * comprobar no cuenta.
 */
export function motivoPersonaAjena(
  porComprobar: Partial<Record<PersonaDelCaso, string>>,
  encontradas: Partial<Record<PersonaDelCaso, boolean>>,
): string | null {
  for (const k of ORDEN) {
    if (porComprobar[k] === undefined) continue;
    if (encontradas[k] !== true) return MENSAJE_PERSONA_AJENA[k];
  }
  return null;
}
