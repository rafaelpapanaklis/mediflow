import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { getPlan, PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import { logAudit, extractAuditMeta } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  plan: z.enum(PLAN_IDS),
});

/**
 * POST /api/billing/change-plan
 *
 * Cambia el plan de la suscripción activa de la clínica con prorrateo
 * automático de Stripe. Si la clínica todavía no tiene subscription
 * activa, devuelve `{ redirectUrl }` apuntando al checkout self-service
 * para que cree una nueva.
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
  const targetPlan = getPlan(targetPlanId);

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

  // Sin suscripción activa → no se puede hacer "update" en Stripe.
  // Devolvemos la URL del checkout self-service para que la cree.
  if (!clinic.stripeSubscriptionId) {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.NEXTAUTH_URL ??
      new URL(req.url).origin;
    return NextResponse.json({
      mode: "checkout",
      redirectUrl: `${baseUrl}/dashboard/suspended?prefill=${targetPlanId}`,
    });
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
      name: `MediFlow ${targetPlan.name} — Suscripción mensual`,
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
  await prisma.clinic.update({
    where: { id: clinic.id },
    data: { plan: targetPlanId, subscriptionStatus: updated.status },
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
