import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import { getResolvedPlan, getPlanLimits } from "@/lib/plans";
import { logAudit, extractAuditMeta } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  plan: z.enum(PLAN_IDS),
});

/**
 * POST /api/billing/change-plan
 *
 * Cambia el plan de la clínica.
 *  - Con suscripción activa de Stripe: hace el `update` con prorrateo
 *    automático del periodo en curso.
 *  - En trial / sin suscripción: el plan es solo una preferencia (aún no se
 *    cobra), así que actualiza `clinic.plan` in-place. El cobro ocurre luego
 *    cuando el usuario "Activa/paga" su plan en /dashboard/suspended (que
 *    preselecciona este plan).
 * En ambos casos devuelve `{ mode: "in-place", plan }`.
 *
 * Multi-tenant: clinicId siempre del ctx, NUNCA del body.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "plan inválido", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const targetPlanId: PlanId = parsed.data.plan;
  const targetPlan = await getResolvedPlan(targetPlanId);

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      id: true,
      plan: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
    },
  });
  if (!clinic) {
    return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
  }

  if (clinic.plan === targetPlanId) {
    return NextResponse.json(
      { error: "Ya estás en este plan" },
      { status: 400 },
    );
  }

  // Sin suscripción activa (trial / pending_payment): el plan es solo una
  // preferencia — durante el trial no se cobra. Actualizamos clinic.plan
  // in-place de inmediato; el cobro ocurre cuando el usuario "Activa/paga"
  // su plan en /dashboard/suspended (que preselecciona este plan).
  // NO tocamos subscriptionStatus (sigue trial/pending hasta que pague).
  if (!clinic.stripeSubscriptionId) {
    const planLimits = await getPlanLimits(targetPlanId);
    await prisma.clinic.update({
      where: { id: clinic.id },
      data: {
        plan: targetPlanId,
        aiTokensLimit: planLimits.aiTokensDefault,
      },
    });

    const { ipAddress, userAgent } = extractAuditMeta(req);
    await logAudit({
      clinicId: clinic.id,
      userId: user.id,
      entityType: "subscription",
      entityId: clinic.id,
      action: "update",
      changes: {
        plan: { before: clinic.plan, after: targetPlanId },
        _source: { before: null, after: { event: "self-service-change-plan-trial", priceMxn: targetPlan.priceMxn } },
      },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ mode: "in-place", plan: targetPlanId });
  }

  const stripe = getStripeSafe();
  if (!stripe) {
    return NextResponse.json(stripeUnavailableResponse(), { status: 503 });
  }

  // Stripe requiere el `id` del subscription item para reemplazar su
  // price — no acepta el subscriptionId directo. Lo obtenemos.
  const sub = await stripe.subscriptions.retrieve(clinic.stripeSubscriptionId, {
    expand: ["items.data"],
  });
  const item = sub.items.data[0];
  if (!item) {
    return NextResponse.json(
      { error: "Suscripción sin items en Stripe" },
      { status: 500 },
    );
  }

  // Creamos el price nuevo on-the-fly (mismo patrón que el checkout
  // self-service) para evitar mantener Price IDs pre-creados.
  const newPrice = await stripe.prices.create({
    currency: "mxn",
    unit_amount: targetPlan.priceMxn * 100,
    recurring: { interval: "month" },
    product_data: {
      name: `DaleControl ${targetPlan.name} — Suscripción mensual`,
      metadata: { plan: targetPlan.id },
    },
  });

  const updated = await stripe.subscriptions.update(clinic.stripeSubscriptionId, {
    items: [{ id: item.id, price: newPrice.id }],
    proration_behavior: "create_prorations",
    metadata: {
      ...(sub.metadata ?? {}),
      clinicId: clinic.id,
      plan: targetPlan.id,
      kind: "platform-subscription",
    },
  });

  // Actualizamos plan local de inmediato (el webhook
  // customer.subscription.updated también llega y refresca status, pero
  // no toca clinic.plan — ese es nuestro tracking local).
  const planLimits = await getPlanLimits(targetPlanId);
  await prisma.clinic.update({
    where: { id: clinic.id },
    data: {
      plan: targetPlanId,
      subscriptionStatus: updated.status,
      aiTokensLimit: planLimits.aiTokensDefault,
    },
  });

  const { ipAddress, userAgent } = extractAuditMeta(req);
  await logAudit({
    clinicId: clinic.id,
    userId: user.id,
    entityType: "subscription",
    entityId: clinic.stripeSubscriptionId,
    action: "update",
    changes: {
      plan: { before: clinic.plan, after: targetPlanId },
      _source: { before: null, after: { event: "self-service-change-plan", priceMxn: targetPlan.priceMxn } },
    },
    ipAddress,
    userAgent,
  });

  return NextResponse.json({
    mode: "in-place",
    plan: targetPlanId,
    status: updated.status,
  });
}
