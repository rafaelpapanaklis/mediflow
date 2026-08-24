import { NextResponse } from "next/server";
import { BarberPaymentsError, handleBarberPaymentsWebhook } from "@/lib/barber/payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Webhook de Stripe del CLIENTE FINAL de la barbería (membresías y
 * anticipos).
 *
 * ⚠️ FRONTERA CON T6 — este endpoint es DISTINTO del de la suscripción del
 * SaaS y usa OTRO secreto (BARBER_PAYMENTS_STRIPE_WEBHOOK_SECRET).
 *
 *   Endpoint de Stripe:  https://TU_DOMINIO/api/barber/payments/webhook
 *   Eventos a marcar (SOLO estos tres):
 *      · payment_intent.succeeded
 *      · payment_intent.payment_failed
 *      · payment_intent.canceled
 *
 * NO marcar aquí checkout.session.*, customer.subscription.* ni invoice.*:
 * esos son de T6 / del dental. La renovación de una membresía se detecta por
 * el PaymentIntent de su factura, no por invoice.paid — así ningún tipo de
 * evento vive en los dos endpoints y nada se procesa dos veces.
 *
 * El cuerpo se lee CRUDO (req.text()): firmar sobre el JSON reparseado
 * rompería la verificación.
 */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const signature = req.headers.get("stripe-signature");
    const out = await handleBarberPaymentsWebhook(raw, signature);
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof BarberPaymentsError) {
      // 4xx → Stripe no reintenta (firma mala). 5xx → sí reintenta.
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("[barber/payments/webhook] error inesperado:", err);
    return NextResponse.json({ error: "Webhook error" }, { status: 500 });
  }
}
