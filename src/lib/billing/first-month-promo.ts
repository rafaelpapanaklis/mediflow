import type Stripe from "stripe";
import type { PlanId } from "@/lib/billing/plans";
import { FIRST_MONTH_PROMO_MXN } from "@/lib/plan-shared";

/**
 * PROMO DE PRIMER MES ($19 / $29 / $39 MXN + IVA según plan).
 *
 * Reglas de negocio (fuente: matriz de precios jul-2026):
 *  - SOLO suscripciones MENSUALES con tarjeta (Checkout mode "subscription").
 *    El plan anual y los pagos únicos SPEI/OXXO NO aplican.
 *  - SOLO la PRIMERA contratación de la clínica (ver isFirstContract).
 *    Reactivaciones y cambios de plan (change-plan) NO aplican.
 *  - NO es trial: el primer mes SE COBRA al precio promo; desde el segundo
 *    ciclo Stripe cobra el precio normal (cupón con duration "once").
 */

/**
 * Primera contratación = la clínica NUNCA tuvo una suscripción (Stripe o
 * legacy — esos campos no se limpian al cancelar) NI un periodo pagado/
 * activado (nextBillingDate solo se fija al activar por webhook o admin).
 */
export function isFirstContract(clinic: {
  stripeSubscriptionId: string | null;
  subscriptionId: string | null;
  nextBillingDate: Date | null;
}): boolean {
  return !clinic.stripeSubscriptionId && !clinic.subscriptionId && !clinic.nextBillingDate;
}

/**
 * Garantiza en Stripe un cupón "once" que deja la PRIMERA factura mensual en
 * el precio promo y devuelve su id. El id embebe el monto descontado
 * (p. ej. dc-first-month-basic-40000): los cupones de Stripe son inmutables,
 * así que si el precio del plan cambia en /admin se genera un cupón nuevo con
 * el monto correcto en vez de reusar uno viejo. Idempotente: retrieve →
 * create si falta; una carrera de doble create (resource_already_exists) se
 * ignora. Devuelve null si el plan no tiene promo o el descuento no es > 0.
 */
export async function ensureFirstMonthCoupon(
  stripe: Stripe,
  plan: { id: PlanId; name: string; priceMxnMonthly: number },
): Promise<string | null> {
  const promoMxn = FIRST_MONTH_PROMO_MXN[plan.id];
  if (!promoMxn) return null;
  const amountOffCents = Math.round((plan.priceMxnMonthly - promoMxn) * 100);
  if (amountOffCents <= 0) return null;

  const id = `dc-first-month-${plan.id.toLowerCase()}-${amountOffCents}`;

  try {
    await stripe.coupons.retrieve(id);
    return id;
  } catch (err: any) {
    // resource_missing (404) = aún no existe → lo creamos abajo. Cualquier
    // otro error (red/auth) se propaga: mejor fallar el checkout que cobrar
    // el mes completo cuando la UI prometió el precio promo.
    if (err?.statusCode !== 404 && err?.code !== "resource_missing") throw err;
  }

  try {
    await stripe.coupons.create({
      id,
      amount_off: amountOffCents,
      currency: "mxn",
      duration: "once",
      name: `Primer mes ${plan.name} a $${promoMxn} MXN`,
    });
  } catch (err: any) {
    if (err?.code !== "resource_already_exists") throw err;
  }
  return id;
}
