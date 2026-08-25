import { NextResponse, type NextRequest } from "next/server";
import {
  confirmRealtyCheckoutSession,
  getRealtyBillingAccount,
  prismaRealtyBillingDb,
} from "@/lib/realty/billing";
import { isRealtySubscriptionActive } from "@/lib/realty/plan-shared";
import {
  readJson,
  realtyBillingErrorResponse,
  requireRealtyBilling,
  requireRealtyStripe,
} from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/realty/billing/confirm — al volver de Stripe.
 *
 * Cierra el hueco entre el pago y la llegada del webhook: la pantalla
 * pregunta aquí, esto relee la sesión en Stripe y aplica la suscripción por
 * la MISMA ruta que el webhook (idempotente). Sin esto, quien paga ve
 * "pendiente" unos segundos y algunos vuelven a pagar.
 */
export async function POST(req: NextRequest) {
  const auth = await requireRealtyBilling();
  if (auth instanceof NextResponse) return auth;
  const stripe = requireRealtyStripe();
  if (stripe instanceof NextResponse) return stripe;

  const body = await readJson(req);
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) {
    return NextResponse.json(
      { error: "Falta el identificador de la sesión de pago.", code: "BAD_SESSION" },
      { status: 400 },
    );
  }

  try {
    const result = await confirmRealtyCheckoutSession(
      stripe,
      prismaRealtyBillingDb(),
      auth.account,
      sessionId,
    );
    // Se relee la fila para responder con el estado REAL ya escrito.
    const fresh = await getRealtyBillingAccount(auth.ctx);
    return NextResponse.json({
      ...result,
      subscriptionStatus: fresh.subscriptionStatus,
      plan: fresh.plan,
      active: isRealtySubscriptionActive(fresh),
    });
  } catch (err) {
    return realtyBillingErrorResponse(err);
  }
}
