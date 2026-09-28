// Orthodontics — Control y agenda (ws1-t4): predicates puros (sin imports
// server-only). Se cargan desde la server action Y desde los tests
// unitarios — mismo patrón que `_predicates.ts` (auth-context → next/headers
// rompe si se importa fuera de un request de Next). Archivo propio en vez de
// añadir a `_predicates.ts` (compartido, sin dueño fijo en esta ronda de
// arreglos — REPORTE-ws1-t1.md, «Revisión cruzada»): evita tocar un archivo
// que no es mío esta ronda.

/**
 * Decide, a partir de los dos permisos relevantes, si el lookup de
 * `getTreatmentPlanIdForAppointment` puede seguir y si el llamador puede
 * además abrir la hoja CLÍNICA (BotonHojaControl). Antes del arreglo, el
 * lookup exigía `medicalRecord.view` a secas y recepción (solo
 * `billing.view`) se quedaba sin nada — ni el resumen de cobranza que sí
 * necesita para cobrar.
 */
export function resolveTreatmentPlanAccess(perms: {
  canClinical: boolean;
  canBilling: boolean;
  /**
   * H67: quien solo puede VER el expediente no debe ver «Registrar control»
   * (firmar exige editar y el botón daba error de permiso). Sin este dato,
   * se cae al criterio de antes (`canClinical`).
   */
  canClinicalEdit?: boolean;
}): { allowed: boolean; canOpenClinicalCard: boolean } {
  return {
    allowed: perms.canClinical || perms.canBilling,
    canOpenClinicalCard: perms.canClinicalEdit ?? perms.canClinical,
  };
}
