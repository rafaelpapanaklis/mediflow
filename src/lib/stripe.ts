import Stripe from "stripe";

// Cliente Stripe. La app NO debe crashear si Stripe no está configurado.
// - getStripe()     → API antigua (throws): se mantiene para endpoints
//                     existentes que dependen de Stripe sí o sí.
// - getStripeSafe() → API nueva (returns null si falta STRIPE_SECRET_KEY):
//                     úsala en código que debe mostrar "Configurar Stripe
//                     primero" en vez de crashear.

export const STRIPE_SETUP_INSTRUCTIONS = [
  "1) Crea una cuenta en https://stripe.com (Modo de prueba primero).",
  "2) En Vercel → Settings → Environment Variables agrega:",
  "   - STRIPE_SECRET_KEY         (sk_test_... o sk_live_...)",
  "   - STRIPE_WEBHOOK_SECRET     (whsec_... del endpoint de webhook)",
  "   - STRIPE_PRICE_ID_BASIC     (price_... del producto BASIC)",
  "   - STRIPE_PRICE_ID_PRO       (price_... del producto PRO)",
  "   - STRIPE_PRICE_ID_CLINIC    (price_... del producto CLINIC)",
  "3) Crea un Webhook en Stripe → https://TU_DOMINIO/api/webhooks/stripe",
  "   Eventos: customer.subscription.created/.updated/.deleted, invoice.paid, invoice.payment_failed.",
  "4) Redeploy en Vercel y refresca esta página.",
].join("\n");

let _stripe: Stripe | null = null;

function buildClient(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY not configured");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20" as any,
  });
}

function getStripe(): Stripe {
  if (!_stripe) _stripe = buildClient();
  return _stripe;
}

export default getStripe;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Devuelve el cliente de Stripe o `null` si falta STRIPE_SECRET_KEY. */
export function getStripeSafe(): Stripe | null {
  if (!isStripeConfigured()) return null;
  try {
    if (!_stripe) _stripe = buildClient();
    return _stripe;
  } catch {
    return null;
  }
}

export function getPriceIdForPlan(plan: string): string | null {
  switch (plan) {
    case "BASIC":  return process.env.STRIPE_PRICE_ID_BASIC  ?? null;
    case "PRO":    return process.env.STRIPE_PRICE_ID_PRO    ?? null;
    case "CLINIC": return process.env.STRIPE_PRICE_ID_CLINIC ?? null;
    default:       return null;
  }
}

export function stripeUnavailableResponse() {
  return {
    error: "Stripe no está configurado",
    instructions: STRIPE_SETUP_INSTRUCTIONS,
  };
}
