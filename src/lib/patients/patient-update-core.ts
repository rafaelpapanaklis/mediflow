import type { z } from "zod";
import { patientSchema } from "@/lib/validations";

/**
 * PAC-01 · El payload del `prisma.patient.update` del PUT de /api/patients/[id],
 * como función PURA para poder fijarlo con tests sin BD ni HTTP.
 *
 * LA REGLA, y es la única que importa: **un campo que el body no trae NO se
 * escribe**. En una edición, la ausencia de un campo significa "no lo toques",
 * nunca "vacíalo". Prisma trata `undefined` como "no tocar esta columna", así
 * que la regla se cumple sola SIEMPRE QUE el schema no rellene el hueco con un
 * default — ver el comentario largo de `patientSchema` en @/lib/validations.
 *
 * Lo que este módulo aporta encima del spread es la parte que sí necesita
 * criterio, campo a campo, y que un `...data` pelado se comía en silencio:
 *
 *   dob    → string vacío o ausente ⇒ undefined (intacta). NO se puede borrar
 *            una fecha de nacimiento por este camino; nunca se pudo.
 *   email  → string vacío ⇒ undefined (intacta), no cadena vacía en BD.
 *   gender → ausente ⇒ intacto. Antes había un `?? "OTHER"` que, sumado al
 *            `.default("OTHER")` del schema, reescribía el género de cualquier
 *            paciente cuyo body no lo mandara.
 *   curp   → se normaliza a mayúsculas sin espacios cuando viene con valor;
 *            `null` EXPLÍCITO sí borra (el modal lo manda cuando el estado CURP
 *            deja de ser COMPLETE), y ausente deja la columna intacta.
 *
 * Los cuatro arrays clínicos (allergies, chronicConditions, currentMedications,
 * tags) no aparecen aquí a propósito: viajan en el spread y su semántica la fija
 * el schema. Ausentes ⇒ `undefined` ⇒ intactos. `[]` explícito ⇒ se vacían, que
 * es lo correcto cuando el usuario borra el último elemento a mano.
 */
export type PatientEditInput = z.infer<typeof patientSchema>;

export function patientUpdateData(parsed: PatientEditInput): Record<string, unknown> {
  return {
    // El spread SOLO trae claves del schema (zod descarta las demás) y, de esas,
    // solo las que el body traía: el resto llegan como `undefined`.
    ...parsed,
    dob:    parsed.dob ? new Date(parsed.dob) : undefined,
    email:  parsed.email || undefined,
    // Explícito aunque el spread ya lo llevaría: es el campo donde vivía el
    // `?? "OTHER"` que pisaba el género, y conviene que se lea.
    gender: parsed.gender,
    curp:   parsed.curp ? parsed.curp.toUpperCase().trim() : parsed.curp,
  };
}

/**
 * Atajo para el route handler: valida el body crudo con `patientSchema` y
 * devuelve tanto lo parseado (el PUT necesita curp/curpStatus/passportNo para
 * el chequeo NOM-024 antes de escribir) como el payload de Prisma.
 * Lanza ZodError si el body no valida, igual que antes.
 */
export function parsePatientUpdate(body: unknown): {
  parsed: PatientEditInput;
  data: Record<string, unknown>;
} {
  const parsed = patientSchema.parse(body);
  return { parsed, data: patientUpdateData(parsed) };
}
