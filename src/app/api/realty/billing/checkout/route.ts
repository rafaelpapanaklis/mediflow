import { NextResponse, type NextRequest } from "next/server";
import {
  createRealtyCheckoutSession,
  resolveRealtyBaseUrl,
  type RealtyBillingInterval,
} from "@/lib/realty/billing";
import { getRealtyPlan } from "@/lib/realty/plans";
import { isRealtyPlanId } from "@/lib/realty/plan-shared";
import {
  readJson,
  realtyBillingErrorResponse,
  requireRealtyBilling,
  requireRealtyStripe,
} from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/realty/billing/checkout — arranca el cobro del plan.
 *
 * El producto y el precio de Stripe NO existen antes de esto: nacen aquí,
 * resueltos por `lookup_key` desde `realty_plan_configs`. Nada se da de alta
 * a mano en el dashboard de Stripe (así fue como barber terminó con
 * productos huérfanos).
 */
export async function POST(req: NextRequest) {
  const auth = await requireRealtyBilling();
  if (auth instanceof NextResponse) return auth;
  const stripe = requireRealtyStripe();
  if (stripe instanceof NextResponse) return stripe;

  const body = await readJson(req);
  const planId = body.plan;
  if (!isRealtyPlanId(planId)) {
    return NextResponse.json({ error: "Plan inválido", code: "BAD_PLAN" }, { status: 400 });
  }
  const interval: RealtyBillingInterval = body.interval === "year" ? "year" : "month";

  try {
    const plan = await getRealtyPlan(planId);
    const { url, sessionId } = await createRealtyCheckoutSession({
      stripe,
      account: auth.account,
      plan,
      interval,
      baseUrl: resolveRealtyBaseUrl(req.url),
      fallbackEmail: auth.ctx.user.email,
    });
    return NextResponse.json({ url, sessionId });
  } catch (err) {
    return realtyBillingErrorResponse(err);
  }
}
