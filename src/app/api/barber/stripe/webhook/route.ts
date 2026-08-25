import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getBarberPlans } from "@/lib/barber/plans";
import {
  getBarberStripe,
  handleBarberStripeEvent,
  isBarberWebhookEventType,
  prismaBillingDb,
} from "@/lib/barber/billing";

// Raw body para verificar la firma: sin body-parsing automático.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/barber/stripe/webhook — webhook de la SUSCRIPCIÓN de la barbería.
 *
 * Endpoint y secreto PROPIOS (BARBER_STRIPE_WEBHOOK_SECRET), distintos del
 * dental (/api/webhooks/stripe) y del de T4 (membresías/anticipos del
 * cliente final). La LLAVE del cliente sí cae a STRIPE_SECRET_KEY (ver
 * billing.ts: misma cuenta), pero este secreto NO tiene fallback a
 * propósito: Stripe firma cada endpoint con su propio whsec_, y el del
 * dental nunca validaría una firma dirigida a esta URL. Sin la variable el
 * endpoint responde 503 y Stripe reintenta.
 * Tipos de evento que se suscriben en Stripe para ESTE
 * endpoint — y solo estos:
 *   checkout.session.completed · checkout.session.async_payment_succeeded ·
 *   checkout.session.async_payment_failed · checkout.session.expired ·
 *   customer.subscription.created · customer.subscription.updated ·
 *   customer.subscription.deleted · customer.subscription.paused ·
 *   customer.subscription.resumed
 * T4 escucha payment_intent.* (y los de sus membresías): sin solape.
 *
 * Idempotente por construcción: no cobra, no inserta; relee la suscripción
 * viva y escribe su estado absoluto (ver handleBarberStripeEvent). Un evento
 * ajeno (dental, T4, otro kind) responde 200 sin tocar nada; un fallo
 * transitorio responde 500 para que Stripe reintente.
 */
export async function POST(req: NextRequest) {
  const stripe = getBarberStripe();
  const secret = process.env.BARBER_STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json(
      { error: "Webhook de DaleControl Barber sin configurar", code: "STRIPE_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Falta stripe-signature" }, { status: 400 });

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    return NextResponse.json({ error: `Firma inválida: ${err?.message ?? ""}` }, { status: 400 });
  }

  if (!isBarberWebhookEventType(event.type)) {
    return NextResponse.json({ received: true, handled: false, action: "ignored-type" });
  }

  try {
    const plans = await getBarberPlans();
    const outcome = await handleBarberStripeEvent(stripe, prismaBillingDb(), event, { plans });
    console.log(
      "[barber webhook]",
      JSON.stringify({ id: event.id, type: event.type, ...outcome }),
    );
    return NextResponse.json({ received: true, ...outcome });
  } catch (err: any) {
    console.error("[barber webhook] error procesando", event.id, event.type, err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Error procesando el evento" }, { status: 500 });
  }
}
