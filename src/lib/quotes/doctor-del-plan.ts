// Con qué DOCTOR nace el plan de tratamiento de un presupuesto (revisión final
// de ws1-t2, fallo 4). Regla pura, sin I/O; la consulta vive en la ruta
// POST /api/quotes/[id]/treatment-plan.
//
// Antes: `quote.createdById ?? quien pulsa`. El plan de P-0017 quedó a nombre
// de «T9final Recepcion», que no atiende. Ahora el doctor del plan tiene que
// cumplir la regla única de «quién atiende» de la Agenda (ws1-t10:
// roles-que-atienden.ts — rol que atiende, cuenta activa y «Aparece en la
// agenda»), y se busca en este orden:
//
//   1. el que se eligió en la tarjeta (si se eligió: si no atiende, error);
//   2. quien hizo el presupuesto;
//   3. el doctor de cabecera del paciente.
//
// Si ninguno atiende, NO se inventa (ni recepción, ni el primero de la lista,
// ni quien pulsa «Crear plan»): la ruta contesta 409 con la lista para elegir.

/**
 * El primer candidato que está entre los que atienden, o null. `atienden` es el
 * resultado de buscar los candidatos con `{ clinicId, ...RECIBE_CITAS_WHERE }`.
 */
export function doctorDelPlan(
  candidatos: ReadonlyArray<string | null | undefined>,
  atienden: ReadonlyArray<string>,
): string | null {
  for (const id of candidatos) if (id && atienden.includes(id)) return id;
  return null;
}

export const FRASE_ELEGIR_DOCTOR_DEL_PLAN =
  "Elige el doctor del plan: ni quien hizo el presupuesto ni el doctor de cabecera del paciente atienden en la Agenda.";
