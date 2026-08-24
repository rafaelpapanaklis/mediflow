import { NextResponse } from "next/server";
import { getBarberPlans } from "@/lib/barber/plans";
import { getBarberGate } from "@/lib/barber/gating";
import { getBarberBillingSummary, getBarberStripe } from "@/lib/barber/billing";
import { toBarberGateDTO, type BarberBillingStatusDTO } from "@/components/barber/billing/shared";
import { billingErrorResponse, requireBarberBilling } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/barber/billing/status
 * Gate por plan (plan resuelto, estado, uso vs límites) + resumen de Stripe
 * (suscripción, tarjeta, facturas y cobros rechazados). Lo usa la pantalla
 * de suscripción para refrescarse tras un pago/cambio.
 */
export async function GET() {
  const auth = await requireBarberBilling();
  if (auth instanceof NextResponse) return auth;
  try {
    const [plans, gate] = await Promise.all([getBarberPlans(), getBarberGate(auth.ctx)]);
    const summary = await getBarberBillingSummary(getBarberStripe(), auth.shop, plans);
    const payload: BarberBillingStatusDTO = { gate: toBarberGateDTO(gate), summary };
    return NextResponse.json(payload);
  } catch (err) {
    return billingErrorResponse(err);
  }
}
