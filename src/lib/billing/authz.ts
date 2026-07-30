/**
 * Quién puede tocar la SUSCRIPCIÓN de la plataforma (plan de la clínica).
 *
 * FUENTE ÚNICA para el preview y para el cambio de plan: el endpoint que cobra y
 * el que solo simula tienen que exigir lo mismo. Antes el preview validaba admin
 * y el que ejecuta el cobro NO, así que cualquier usuario logueado de la clínica
 * (recepción, doctor) podía disparar un cargo real con un fetch a mano — el tab
 * de Suscripción está oculto para ellos, pero eso es autorización de UI, no de API.
 *
 * NO se usan las keys de permisos (`billing.*`): esas son de la facturación de
 * PACIENTES (recepción tiene `billing.charge` para cobrar en caja) y no tienen
 * nada que ver con contratar el plan de la clínica. El criterio es el mismo que
 * usa el tab en `settings-client.tsx`: dueño/admin.
 */
export function isClinicBillingAdmin(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/** Cuerpo 403 estándar de los endpoints de suscripción. */
export function notClinicBillingAdminResponse() {
  return {
    error: "Solo el dueño o un administrador de la clínica puede cambiar el plan.",
    code: "FORBIDDEN_NOT_CLINIC_ADMIN",
  };
}
