import { NextResponse, type NextRequest } from "next/server";
import { changeRealtyPlan, prismaRealtyBillingDb } from "@/lib/realty/billing";
import { getRealtyPlan, getRealtyPlans } from "@/lib/realty/plans";
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
 * POST /api/realty/billing/change-plan — cambia de plan con PRORRATEO.
 *
 * Subir: se cobra hoy la diferencia (always_invoice). Si la tarjeta rechaza,
 * el plan NO cambia (error_if_incomplete). Bajar: queda crédito para la
 * próxima factura. La FECHA DE RENOVACIÓN NUNCA SE MUEVE.
 */
export async function POST(req: NextRequest) {
  const auth = await requireRealtyBilling();
  if (auth instanceof NextResponse) return auth;
  const stripe = requireRealtyStripe();
  if (stripe instanceof NextResponse) return stripe;

  const body = await readJson(req);
  const targetId = body.plan;
  if (!isRealtyPlanId(targetId)) {
    return NextResponse.json({ error: "Plan inválido", code: "BAD_PLAN" }, { status: 400 });
  }

  try {
    const [plans, currentPlan, targetPlan] = await Promise.all([
      getRealtyPlans(),
      getRealtyPlan(auth.account.plan),
      getRealtyPlan(targetId),
    ]);
    const result = await changeRealtyPlan({
      stripe,
      db: prismaRealtyBillingDb(),
      account: auth.account,
      currentPlan,
      targetPlan,
      plans,
    });
    return NextResponse.json(result);
  } catch (err) {
    return realtyBillingErrorResponse(err);
  }
}
