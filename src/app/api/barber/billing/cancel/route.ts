import { NextResponse } from "next/server";
import { getBarberPlans } from "@/lib/barber/plans";
import { prismaBillingDb, setBarberSubscriptionCancel } from "@/lib/barber/billing";
import { billingErrorResponse, requireBarberBilling, requireBarberStripe } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/barber/billing/cancel
 * Programa la cancelación al FIN del periodo pagado (cancel_at_period_end).
 * El plan sigue activo hasta esa fecha; al llegar, Stripe manda
 * customer.subscription.deleted y el webhook deja la barbería en "canceled".
 */
export async function POST() {
  const auth = await requireBarberBilling();
  if (auth instanceof NextResponse) return auth;
  const stripe = requireBarberStripe();
  if (stripe instanceof NextResponse) return stripe;
  try {
    const plans = await getBarberPlans();
    const result = await setBarberSubscriptionCancel(stripe, prismaBillingDb(), auth.shop, true, plans);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return billingErrorResponse(err);
  }
}
