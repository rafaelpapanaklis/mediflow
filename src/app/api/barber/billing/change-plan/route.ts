import { NextResponse, type NextRequest } from "next/server";
import { getBarberPlan, getBarberPlans } from "@/lib/barber/plans";
import { isBarberPlanId } from "@/lib/barber/plan-shared";
import { changeBarberPlan, prismaBillingDb } from "@/lib/barber/billing";
import { billingErrorResponse, readJsonBody, requireBarberBilling, requireBarberStripe } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/barber/billing/change-plan  { plan }
 *
 * Cambia el plan de la suscripción VIVA conservando su ciclo (mensual/anual):
 *  · UPGRADE   → always_invoice + error_if_incomplete: se cobra AHORA solo el
 *    diferencial de los días que quedan; si la tarjeta rechaza, nada cambia
 *    (402 UPGRADE_PAYMENT_FAILED). La fecha de renovación NO se mueve.
 *  · DOWNGRADE → create_prorations: crédito a la próxima factura, sin cobro.
 *    Si la barbería queda por encima de los límites del plan nuevo NO se
 *    borra nada: el gate bloquea nuevas altas y la pantalla avisa.
 * Sin suscripción viva → 409 (hay que contratar, no cambiar).
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
    const [plans, targetPlan, currentPlan] = await Promise.all([
      getBarberPlans(),
      getBarberPlan(body.plan),
      getBarberPlan(auth.shop.plan),
    ]);
    const result = await changeBarberPlan({
      stripe,
      db: prismaBillingDb(),
      shop: auth.shop,
      currentPlan,
      targetPlan,
      plans,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return billingErrorResponse(err);
  }
}
