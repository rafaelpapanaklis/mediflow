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
 * nada que ver con contratar el plan de la clínica.
 *
 * Decisión de Rafael (26-oct-2026): «Solo el super-admin puede renovar, cancelar,
 * etc.». Pagar/activar, cambiar de plan, cambiar el método de pago, el portal de
 * Stripe, cancelar y comprar usuarios extra son SOLO del dueño (SUPER_ADMIN). Un
 * ADMIN ve el plan y su estado en solo lectura (`puedeVerSuscripcion`).
 */
export function isClinicBillingAdmin(role: string | null | undefined): boolean {
  return role === "SUPER_ADMIN";
}

/**
 * Ver la suscripción sin tocarla: el dueño y los administradores. Solo para lecturas
 * (GET del contexto de facturación y del método de pago vigente); ningún cobro ni
 * cambio pasa por aquí.
 */
export function puedeVerSuscripcion(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/** Texto para quien ve la suscripción pero no la puede cambiar (es/en en `shell.subscriptionTab.soloDueno`). */
export const MENSAJE_SOLO_DUENO = "Solo el dueño de la cuenta puede cambiar o pagar el plan.";

/** Cuerpo 403 estándar de los endpoints de suscripción. */
export function notClinicBillingAdminResponse() {
  return {
    error: MENSAJE_SOLO_DUENO,
    code: "FORBIDDEN_NOT_CLINIC_ADMIN",
  };
}
