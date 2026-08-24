import { NextResponse, type NextRequest } from "next/server";
import { getBarberPlan } from "@/lib/barber/plans";
import { isBarberPlanId } from "@/lib/barber/plan-shared";
import { countBarberUsage, limitAllows, planLimit, type BarberLimitKey } from "@/lib/barber/gating";
import { previewBarberPlanChange } from "@/lib/barber/billing";
import type { BarberChangePreviewDTO, BarberLimitWarningDTO } from "@/components/barber/billing/shared";
import { billingErrorResponse, readJsonBody, requireBarberBilling, requireBarberStripe } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/barber/billing/change-plan/preview  { plan }
 * Simula el cambio SIN efectos: cuánto se cobra HOY (upgrade: prorrateo con
 * always_invoice), qué se cobrará en la renovación y si el plan destino
 * dejaría a la barbería por encima de sus límites (no se borra nada; se avisa).
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
  if (body.plan === auth.shop.plan) {
    return NextResponse.json({ error: "Ya estás en este plan.", code: "SAME_PLAN" }, { status: 400 });
  }

  try {
    const [targetPlan, currentPlan, usage] = await Promise.all([
      getBarberPlan(body.plan),
      getBarberPlan(auth.shop.plan),
      countBarberUsage(auth.shop.id),
    ]);
    const preview = await previewBarberPlanChange({ stripe, shop: auth.shop, currentPlan, targetPlan });
    const limitWarnings: BarberLimitWarningDTO[] = (["barbers", "branches"] as BarberLimitKey[])
      .map((key) => ({ key, used: usage[key], max: planLimit(targetPlan, key) }))
      .filter((w) => !limitAllows(w.max, w.used));
    const payload: BarberChangePreviewDTO = { ...preview, targetPlanId: targetPlan.id, limitWarnings };
    return NextResponse.json(payload);
  } catch (err) {
    return billingErrorResponse(err);
  }
}
