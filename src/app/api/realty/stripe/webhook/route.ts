import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getRealtyPlans } from "@/lib/realty/plans";
import {
  getRealtyStripe,
  handleRealtyStripeEvent,
  isRealtyWebhookEventType,
  prismaRealtyBillingDb,
} from "@/lib/realty/billing";

// Raw body para verificar la firma: sin body-parsing automático.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/realty/stripe/webhook — webhook de la SUSCRIPCIÓN a DaleControl
 * de las cuentas de inmuebles.
 *
 * Eventos que atiende:
 *   checkout.session.completed · checkout.session.async_payment_succeeded ·
 *   checkout.session.async_payment_failed · checkout.session.expired ·
 *   customer.subscription.created · .updated · .deleted · .paused · .resumed
 *
 * 🔴 SECRETO PROPIO: `REALTY_STRIPE_WEBHOOK_SECRET`, SIN fallback. Stripe
 * firma cada endpoint con su propio whsec_; el del dental jamás validaría una
 * firma dirigida aquí (`constructEvent` tiraría "Firma inválida" → 400 en
 * TODOS los eventos). Caer a él no activaría nada: convertiría un 503 honesto
 * ("sin configurar", que Stripe reintenta) en un 400 engañoso.
 *
 * La LLAVE del cliente sí cascadea (REALTY_STRIPE_SECRET_KEY ||
 * STRIPE_SECRET_KEY): es la misma cuenta de Stripe.
 *
 * AISLAMIENTO: como la cuenta de Stripe es la misma, los webhooks del dental
 * y de barber TAMBIÉN reciben estos eventos. Los ignoran porque nuestros
 * objetos no llevan `metadata.clinicId` ni `dc_vertical: "barber"`, y el
 * customer no es de ninguna clínica ni barbería. Y este endpoint ignora los
 * suyos exigiendo `dc_vertical: "realty"` / `dc_kind: "realty-subscription"`.
 *
 * IDEMPOTENCIA sin tabla de eventos: no se cobra ni se inserta nada. Cada
 * evento relee la suscripción VIVA en Stripe y escribe su estado ABSOLUTO
 * sobre `realty_accounts`. Un evento repetido o fuera de orden converge al
 * mismo estado.
 */
export async function POST(req: NextRequest) {
  const stripe = getRealtyStripe();
  const secret = process.env.REALTY_STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json(
      {
        error: "Webhook de DaleControl Inmuebles sin configurar",
        code: "STRIPE_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Falta stripe-signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Firma inválida: ${err?.message ?? ""}` },
      { status: 400 },
    );
  }

  if (!isRealtyWebhookEventType(event.type)) {
    return NextResponse.json({ received: true, handled: false, action: "ignored-type" });
  }

  try {
    const plans = await getRealtyPlans();
    const outcome = await handleRealtyStripeEvent(
      stripe,
      prismaRealtyBillingDb(),
      event,
      { plans },
    );
    console.log(
      "[realty webhook]",
      JSON.stringify({ id: event.id, type: event.type, ...outcome }),
    );
    return NextResponse.json({ received: true, ...outcome });
  } catch (err: any) {
    // 500 → Stripe reintenta. Solo se llega aquí por fallos transitorios
    // (BD caída, red), nunca por un evento ajeno.
    console.error(
      "[realty webhook] error procesando",
      event.id,
      event.type,
      err?.message ?? err,
    );
    return NextResponse.json(
      { error: err?.message ?? "Error procesando el evento" },
      { status: 500 },
    );
  }
}
