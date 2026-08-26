import type { Prisma } from "@prisma/client";

/**
 * SUB-01 · Caducar la suscripción del PAGADOR MANUAL (SPEI / OXXO / alta a mano
 * desde /admin). Núcleo PURO: el criterio vive aquí para poder fijarlo con tests
 * y para que el cron, el SQL de diagnóstico y cualquier futura pantalla usen
 * exactamente la misma definición.
 *
 * EL AGUJERO QUE CIERRA
 * ---------------------
 * `activatePlatformSubscription` (webhooks/stripe/route.ts) atiende tanto el
 * pago con tarjeta como `checkout.session.async_payment_succeeded` (SPEI/OXXO),
 * y en los dos casos escribe `subscriptionStatus: "active"` con
 * trialEndsAt/nextBillingDate a un periodo vista. Pero en SPEI/OXXO
 * `subscriptionId` es null: NO hay suscripción de Stripe que renueve ni webhook
 * que avise al vencer. Y el gate único (`isPlanExpired`) trata "active" como
 * suscripción viva mire la fecha que mire. Resultado: un pago de $419 y acceso
 * indefinido. Peor, /admin/payments lista las morosas con
 * `subscriptionStatus: { not: "active" }`, así que estas clínicas ni salían en
 * la lista.
 *
 * POR QUÉ "past_due" Y NO "unpaid"
 * --------------------------------
 * "past_due" ya EXISTE y ya está cableado en todas partes: es lo que escribe el
 * propio webhook de Stripe cuando falla el cobro de una tarjeta
 * (webhooks/stripe/route.ts:289), lo pinta /admin/payments como morosa, lo
 * cuenta el aviso de /admin/layout.tsx y lo traduce el export de afiliados como
 * "Pago vencido". "unpaid" no lo mapea NADIE: la clínica saldría con un estado
 * en blanco en cuatro pantallas. No se inventa un estado nuevo.
 *
 * ⚠️ LAS SEDES (SUCURSALES) NO SE TOCAN — LEER ANTES DE RELAJAR EL FILTRO ⚠️
 * -------------------------------------------------------------------------
 * Una sede creada desde /api/clinics nace con la MISMA forma que un pagador
 * manual vencido: `subscriptionStatus: "active"`, sin `stripeSubscriptionId`,
 * `monthlyPrice: 0` y `trialEndsAt: new Date()` — o sea, un trial que vence en
 * el instante en que se crea, porque a la sede la mantiene viva el "active", no
 * la fecha (va INCLUIDA en la suscripción de la madre).
 *
 * Lo único que las distingue es `nextBillingDate`: la sede NUNCA lo recibe
 * (queda null), y en cambio todo pagador manual lo tiene fijado, sea por el
 * webhook de SPEI/OXXO o por el alta a mano de /admin/billing. De ahí el
 * `nextBillingDate: { not: null }` del filtro: no es cosmético, es lo que evita
 * suspender todas las sucursales de todas las clínicas multi-sede del producto.
 * Si alguien lo quita, el cron apaga sedes que sí están pagadas.
 *
 * El schema no tiene `parentClinicId`, así que no hay forma más directa de
 * excluirlas. El día que exista, este filtro debería pasar a excluir por el
 * padre y dejar de depender de un null.
 */

/** El estado al que se devuelve al pagador manual vencido. */
export const MANUAL_LAPSE_STATUS = "past_due";

/**
 * Los dos campos de fecha son "hasta cuándo pagó": `manualPaidUntil` (ver
 * @/lib/billing/proration) es el MÁXIMO de los dos. Exigir que AMBOS estén en el
 * pasado es exactamente `manualPaidUntil(clinic) < now`, expresado de una forma
 * que Prisma puede filtrar en la BD sin traerse la tabla entera.
 *
 * Que hagan falta los dos no es redundante:
 *   • el webhook de SPEI/OXXO mueve los DOS al mismo valor,
 *   • /admin/billing (verify_payment y activate_clinic) y /admin/subscriptions
 *     mueven hoy los dos (manualPeriodFields: trialEndsAt nunca hacia atrás),
 *     pero las filas activadas ANTES de ese cambio siguen con trialEndsAt
 *     viejo hasta que corra el backfill sql/sub-02-renovacion-*.sql.
 * Mirar solo nextBillingDate suspendería a quien tenga trial vivo por delante;
 * mirar solo trialEndsAt suspendería a toda clínica activada desde /admin
 * antes del backfill.
 */
export type LapseCandidate = {
  subscriptionStatus?: string | null;
  stripeSubscriptionId?: string | null;
  nextBillingDate?: Date | string | null;
  trialEndsAt?: Date | string | null;
};

export function shouldLapseManualSubscription(clinic: LapseCandidate, now: Date): boolean {
  // Hoy tiene acceso. Lo que ya está en past_due / cancelled / paused no se
  // vuelve a tocar (idempotencia: el cron puede correr mil veces).
  if ((clinic.subscriptionStatus ?? null) !== "active") return false;

  // Tarjeta: Stripe renueva sola y ya manda invoice.payment_failed /
  // subscription.deleted. Tocar esto sería suspender a quien SÍ paga.
  if (clinic.stripeSubscriptionId) return false;

  // Sede/sucursal (ver el bloque de arriba) — y, en general, cualquier clínica a
  // la que nunca se le fijó un fin de periodo.
  const nextBillingDate = toDate(clinic.nextBillingDate);
  if (!nextBillingDate) return false;
  if (nextBillingDate >= now) return false;

  // Y tampoco le queda trial ni prepago por delante.
  const trialEndsAt = toDate(clinic.trialEndsAt);
  if (trialEndsAt && trialEndsAt >= now) return false;

  return true;
}

/**
 * El MISMO criterio como `where` de Prisma, para que el cron no tenga que
 * traerse todas las clínicas a memoria. `shouldLapseManualSubscription` se
 * vuelve a aplicar sobre cada fila leída: el where filtra en la BD y el
 * predicado es el candado — si los dos se desincronizan, el test lo canta.
 */
export function manualLapseWhere(now: Date): Prisma.ClinicWhereInput {
  return {
    subscriptionStatus: "active",
    stripeSubscriptionId: null,
    nextBillingDate: { not: null, lt: now },
    trialEndsAt: { lt: now },
  };
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
