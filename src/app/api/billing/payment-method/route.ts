import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isClinicBillingAdmin, notClinicBillingAdminResponse } from "@/lib/billing/authz";
import { getLiveSubscriptionSnapshot, type StripeLivePaymentMethod } from "@/lib/admin/stripe-payment-method";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface PaymentMethodResponse {
  /** Lo que Stripe dice HOY del método con el que se cobra la suscripción. */
  paymentMethod: StripeLivePaymentMethod;
}

/**
 * GET /api/billing/payment-method
 *
 * Método de pago VIGENTE en Stripe de la clínica de la sesión, para
 * Configuración → Suscripción. Es la misma lectura que hace /admin
 * (`@/lib/admin/stripe-payment-method`): `Clinic.paymentMethodCollected` solo
 * lo escribe el alta y no sirve para saber si hay tarjeta.
 *
 * Nunca falla por Stripe: si no contesta, devuelve `state: "unavailable"` y la
 * pantalla no afirma nada. Sin cliente en Stripe, `state: "none"`. Solo lectura; no crea, no cobra, no modifica.
 * `clinicId` sale de la sesión, nunca del cliente.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!isClinicBillingAdmin(user.role)) {
    return NextResponse.json(notClinicBillingAdminResponse(), { status: 403 });
  }
  if (!user.clinicId) {
    return NextResponse.json({ error: "Sin clínica en la sesión" }, { status: 401 });
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: user.clinicId },
    select: { stripeCustomerId: true, stripeSubscriptionId: true },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  // Sin cliente en Stripe no hay tarjeta guardada en Stripe: eso es un «no
  // hay», no un «no sé». (/admin lo pinta como «no disponible» porque allí
  // señala un alta a medias; aquí se le habla a la clínica.)
  const paymentMethod: StripeLivePaymentMethod = clinic.stripeCustomerId
    ? (
        await getLiveSubscriptionSnapshot({
          stripeCustomerId: clinic.stripeCustomerId,
          stripeSubscriptionId: clinic.stripeSubscriptionId ?? null,
        })
      ).paymentMethod
    : { state: "none" };

  const body: PaymentMethodResponse = { paymentMethod };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
