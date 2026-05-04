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
 * POST /api/billing/checkout
 *
 * Crea una Stripe Checkout Session para que la clínica del usuario
 * activo renueve/active su suscripción a la plataforma MediFlow.
 *
 * - Auth: getCurrentUser (cualquier rol logueado).
 * - Multi-tenant: clinicId siempre se toma del contexto, NUNCA del body.
 * - Precio: tomado del módulo `lib/billing/plans` (single source of
 *   truth). Se crea con `price_data` dinámico para no requerir Price IDs
 *   pre-creados en el dashboard de Stripe.
 * - Webhook: la activación real se hace en
 *   `/api/webhooks/stripe` cuando llega `checkout.session.completed`
 *   con `metadata.kind === 'platform-subscription'`.
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

  const stripe = getStripeSafe();
  if (!stripe) {
    return NextResponse.json(stripeUnavailableResponse(), { status: 503 });
  }

  const planId: PlanId = parsed.data.plan;
  const plan = getPlan(planId);

  // Reusar customer existente si la clínica ya tiene uno. Si no, crear.
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      id: true,
      name: true,
      email: true,
      stripeCustomerId: true,
    },
  });
  if (!clinic) {
    return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
  }

  let customerId = clinic.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: clinic.email ?? user.email ?? undefined,
      name: clinic.name,
      metadata: { clinicId: clinic.id, source: "mediflow" },
    });
    customerId = customer.id;
    await prisma.clinic.update({
      where: { id: clinic.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    new URL(req.url).origin;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    customer_update: { address: "auto" },
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "mxn",
          unit_amount: plan.priceMxn * 100,
          recurring: { interval: "month" },
          product_data: {
            name: `MediFlow ${plan.name} — Suscripción mensual`,
            metadata: { plan: plan.id },
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      clinicId: clinic.id,
      plan: plan.id,
      kind: "platform-subscription",
    },
    subscription_data: {
      metadata: {
        clinicId: clinic.id,
        plan: plan.id,
        kind: "platform-subscription",
      },
    },
    success_url: `${baseUrl}/dashboard/suspended/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/dashboard/suspended`,
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe no devolvió URL de checkout" },
      { status: 502 },
    );
  }

  const { ipAddress, userAgent } = extractAuditMeta(req);
  await logAudit({
    clinicId: clinic.id,
    userId: user.id,
    entityType: "subscription",
    entityId: session.id,
    action: "create",
    changes: {
      _created: {
        before: null,
        after: { plan: plan.id, priceMxn: plan.priceMxn, sessionId: session.id },
      },
    },
    ipAddress,
    userAgent,
  });

  return NextResponse.json({ url: session.url });
}
