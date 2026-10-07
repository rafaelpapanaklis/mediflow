import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/plan-status";

/**
 * Qué `subscriptionStatus` escribir cuando llega `customer.subscription.created|updated`.
 *
 * Stripe NO garantiza el orden de entrega: al contratar con tarjeta salen casi a la vez
 * `customer.subscription.created` (status «incomplete»), `invoice.paid`, `checkout.session.completed`
 * (que deja la clínica en «active») y `customer.subscription.updated` («active»). Si el «created»
 * viejo llega al final, pisaba «active» con «incomplete» y la clínica quedaba bloqueada pese a haber
 * pagado (caso real: Centro Dental Salamanca, Clínica anual, 7-oct-2026).
 *
 * Reglas: (1) manda el estado VIVO de Stripe (`vivo`) si se pudo leerlo; el del evento es solo el
 * respaldo. (2) Un «incomplete» nunca baja una clínica que ya está activa/en prueba/pagada con esa
 * misma suscripción (en Stripe «incomplete» solo existe ANTES del primer pago: tras el pago nunca
 * se vuelve a él). Devuelve `undefined` = no tocar el estado.
 */
export function estadoDeSuscripcionAEscribir(args: {
  actual: { status: string | null; subscriptionId: string | null };
  evento: { id: string; status: string };
  vivo?: string | null;
}): string | undefined {
  const efectivo = args.vivo || args.evento.status;
  const yaActiva = args.actual.status !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(args.actual.status);
  const mismaSuscripcion = args.actual.subscriptionId === null || args.actual.subscriptionId === args.evento.id;
  if (efectivo === "incomplete" && yaActiva && mismaSuscripcion) return undefined;
  return efectivo;
}
