import { NextResponse, type NextRequest } from "next/server";
import { getBarberPlan } from "@/lib/barber/plans";
import { isBarberPlanId } from "@/lib/barber/plan-shared";
import {
  createBarberCheckoutSession,
  isBarberBillingInterval,
  resolveBarberBaseUrl,
} from "@/lib/barber/billing";
import { billingErrorResponse, readJsonBody, requireBarberBilling, requireBarberStripe } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/barber/billing/checkout  { plan, interval?: "month" | "year" }
 *
 * Crea la sesión de Stripe Checkout (modo suscripción, tarjeta) para que la
 * BARBERÍA contrate su plan de DaleControl. El precio sale de
 * barber_plan_configs (ensureBarberStripePrice); el primer mes con
 * firstMonthPrice se aplica como cupón "once" solo en la primera contratación
 * mensual. La activación real la hace el webhook (y confirm al volver).
 * Con una suscripción viva responde 409 ALREADY_SUBSCRIBED (jamás dos).
 */
export async function POST(req: NextRequest) {
  const auth = await requireBarberBilling();
  if (auth instanceof NextResponse) return auth;
  const stripe = requireBarberStripe();
  if (stripe instanceof NextResponse) return stripe;

  const body = await readJsonBody(req);
  if (!isBarberPlanId(body.plan)) {
    return NextResponse.json({ error: "Plan inválido.", code: "INVALID_PLAN" }, { status: 400 });
  }
  const interval = body.interval ?? "month";
  if (!isBarberBillingInterval(interval)) {
    return NextResponse.json({ error: "Ciclo inválido.", code: "INVALID_INTERVAL" }, { status: 400 });
  }

  try {
    const plan = await getBarberPlan(body.plan);
    const { url } = await createBarberCheckoutSession({
      stripe,
      shop: auth.shop,
      plan,
      interval,
      baseUrl: resolveBarberBaseUrl(req.url),
      fallbackEmail: auth.ctx.user.email,
    });
    return NextResponse.json({ url });
  } catch (err) {
    return billingErrorResponse(err);
  }
}
