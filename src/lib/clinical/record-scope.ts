/**
 * Los dos fragmentos de `where` que deciden QUÉ notas de expediente se leen.
 *
 * Viven aquí, en un módulo PURO sin imports, y no en `@/lib/branches`, por dos
 * razones: `branches` importa `server-only` (no se puede probar con
 * `tsx --test`), y estos dos fragmentos son la clase de código donde un error
 * de composición no falla — filtra de más o de menos, en silencio.
 *
 * `@/lib/branches` los re-exporta, así que los callers históricos no cambian.
 *
 * ── CÓMO SE COMBINAN (importa) ──────────────────────────────────────────────
 * Los dos pueden ocupar la clave `OR`. Dos `OR` en el MISMO objeto se pisan: el
 * segundo gana y la otra restricción desaparece sin error ni aviso. Por eso van
 * SIEMPRE en el array de un `AND`:
 *
 *   where: {
 *     AND: [sharedRecordScope(clinicId, visibles), ownPrivateRecordsOnly(userId)],
 *     patientId,
 *   }
 */

/**
 * Scope de MedicalRecord para las superficies compartidas — la mitad de SEDE.
 *
 * Las notas marcadas `isPrivate` son del doctor que las escribió. Al compartir
 * entre sedes hay que ser MÁS estricto, no menos: de una sede AJENA nunca se
 * leen notas privadas, porque el doctor que las escribió no tiene siquiera fila
 * User en la sede que las está leyendo (los ids de doctor son por clínica, así
 * que "es mía" es indecidible cruzando la frontera).
 *
 * Devuelve el filtro de clínica pelado cuando no hay nada compartido, así la
 * query queda idéntica a la de siempre. OJO: ese caso —el normal, una clínica
 * sola— NO mira `isPrivate`. Ésa es la mitad que cubre el helper de abajo.
 */
export function sharedRecordScope(
  activeClinicId: string,
  visibleClinicIds: string[],
): Record<string, unknown> {
  const others = visibleClinicIds.filter((id) => id !== activeClinicId);
  if (others.length === 0) return { clinicId: activeClinicId };
  return {
    OR: [
      { clinicId: activeClinicId },
      { clinicId: { in: others }, isPrivate: false },
    ],
  };
}

/**
 * La otra mitad: la de la sede PROPIA. Dentro de la misma clínica, la nota
 * privada la ve SÓLO su autor.
 *
 * Faltaba en la ficha (API y SSR), el timeline, `/api/clinical` y el PDF de
 * nota, que con una clínica sola entregaban el SOAP privado de cualquier doctor
 * a quien abriera el expediente, recepción incluida (P1-N2, auditoría
 * 2026-08-06).
 *
 * Sin excepción para admin, igual que en `/api/records`: "privada" quiere decir
 * privada. Un admin que necesite leerla tiene la bitácora y la BD, no la ficha.
 */
export function ownPrivateRecordsOnly(viewerUserId: string): Record<string, unknown> {
  return { OR: [{ isPrivate: false }, { isPrivate: true, doctorId: viewerUserId }] };
}
