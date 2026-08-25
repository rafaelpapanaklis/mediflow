import { NextResponse, type NextRequest } from "next/server";
import { previewRealtyPlanChange } from "@/lib/realty/billing";
import { getRealtyPlan } from "@/lib/realty/plans";
import { isRealtyPlanId } from "@/lib/realty/plan-shared";
import {
  readJson,
  realtyBillingErrorResponse,
  requireRealtyBilling,
  requireRealtyStripe,
} from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/realty/billing/change-plan/preview — cuánto se cobra HOY.
 *
 * Si la simulación de Stripe no es de confianza (no trae líneas de prorrateo,
 * o trae además la renovación del siguiente ciclo), se devuelve
 * `dueTodayCents: null` y la pantalla dice "no se pudo calcular" en vez de
 * enseñar un número inflado.
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
    const [currentPlan, targetPlan] = await Promise.all([
      getRealtyPlan(auth.account.plan),
      getRealtyPlan(targetId),
    ]);
    const preview = await previewRealtyPlanChange({
      stripe,
      account: auth.account,
      currentPlan,
      targetPlan,
    });
    return NextResponse.json(preview);
  } catch (err) {
    return realtyBillingErrorResponse(err);
  }
}
