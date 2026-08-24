import { NextResponse } from "next/server";
import { getBarberPlans } from "@/lib/barber/plans";
import { prismaBillingDb, setBarberSubscriptionCancel } from "@/lib/barber/billing";
import { billingErrorResponse, requireBarberBilling, requireBarberStripe } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/barber/billing/resume
 * Revierte una cancelación programada (cancel_at_period_end=false) mientras
 * la suscripción siga viva. Tras el fin del periodo ya no hay nada que
 * reanudar: se contrata de nuevo con checkout.
 */
export async function POST() {
  const auth = await requireBarberBilling();
  if (auth instanceof NextResponse) return auth;
  const stripe = requireBarberStripe();
  if (stripe instanceof NextResponse) return stripe;
  try {
    const plans = await getBarberPlans();
    const result = await setBarberSubscriptionCancel(stripe, prismaBillingDb(), auth.shop, false, plans);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return billingErrorResponse(err);
  }
}
