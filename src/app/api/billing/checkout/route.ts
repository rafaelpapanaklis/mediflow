import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import { getResolvedPlan } from "@/lib/plans";
import { ensureFirstMonthCoupon, isFirstContract } from "@/lib/billing/first-month-promo";
import { logAudit, extractAuditMeta } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  plan: z.enum(PLAN_IDS),
  // Método de pago. "card" = suscripción que auto-renueva. "spei"/"oxxo" = pago
  // único (asíncrono, NO auto-renueva). Default "card" para no romper
  // a los llamadores existentes (p. ej. las tarjetas de /dashboard/suspended).
  method: z.enum(["card", "spei", "oxxo"]).default("card"),
  // Ciclo de facturación. "annual" = 35% de descuento (plan.priceMxnAnnual).
  // Default "monthly" para no romper a los llamadores existentes.
  billing: z.enum(["monthly", "annual"]).default("monthly"),
});

/**
 * POST /api/billing/checkout
 *
 * Crea una Stripe Checkout Session para que la clínica del usuario
 * activo renueve/active su suscripción a la plataforma DaleControl.
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
  const plan = await getResolvedPlan(planId);

  // Reusar customer existente si la clínica ya tiene uno. Si no, crear.
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      id: true,
      name: true,
      email: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      // Para la promo de 1er mes (isFirstContract): suscripción legacy y
      // último periodo activado — no se limpian al cancelar.
      subscriptionId: true,
      nextBillingDate: true,
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

  const method = parsed.data.method;
  const billing = parsed.data.billing;

  // Rail de IVA (Stripe Tax): SOLO se activa si el env STRIPE_AUTOMATIC_TAX === "true".
  // Sin el env, el comportamiento es idéntico al actual (no se cobra IVA; se cobra
  // el precio anunciado tal cual). Stripe exige dirección del cliente para calcular
  // el impuesto — ya la recolectamos con `customer_update: { address: "auto" }` en
  // ambas sesiones. Antes de prender el flag, ver la guía de Stripe Tax en ORQUESTA.
  const automaticTax = process.env.STRIPE_AUTOMATIC_TAX === "true";

  // Tarjeta: si la clínica YA tiene una suscripción de tarjeta viva en Stripe,
  // NO crear una segunda (evita doble cobro recurrente). La mandamos al billing
  // portal para gestionar la existente (cambiar tarjeta, plan o cancelar).
  // SPEI/OXXO no aplican (pago único; cada pago EXTIENDE el periodo vía webhook).
  if (method === "card" && clinic.stripeSubscriptionId) {
    let existing: any = null;
    try {
      existing = await stripe.subscriptions.retrieve(clinic.stripeSubscriptionId);
    } catch {
      existing = null; // la suscripción ya no existe en Stripe → seguir con alta normal
    }
    const liveStatuses = ["active", "trialing", "past_due", "unpaid"];
    if (existing && liveStatuses.indexOf(existing.status) >= 0) {
      try {
        const portal = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${baseUrl}/dashboard/settings`,
        });
        return NextResponse.json({
          url: portal.url,
          portal: true,
          message: "Ya tienes una suscripción de tarjeta activa. Gestiónala (cambiar tarjeta, plan o cancelar) en el portal de Stripe.",
        });
      } catch {
        return NextResponse.json(
          {
            error: "Ya tienes una suscripción de tarjeta activa. Para cambiar tu plan o método de pago usa el portal de facturación o contacta a soporte.",
            alreadySubscribed: true,
          },
          { status: 409 },
        );
      }
    }
  }

  // Anual = 35% de descuento (priceMxnAnnual, fuente única de planes). El
  // PERIODO lo fija el webhook (nextBillingDate +1 año / +1 mes según billing).
  const unitAmount = (billing === "annual" ? plan.priceMxnAnnual : plan.priceMxn) * 100;

  // PROMO 1ER MES ($19/$29/$39 + IVA): SOLO tarjeta + ciclo mensual + PRIMERA
  // contratación de la clínica (reactivaciones y cambios de plan NO aplican;
  // change-plan ni siquiera pasa por aquí). Cupón "once": la 1a factura sale
  // al precio promo y desde la 2a Stripe cobra el precio normal. NO es trial.
  const applyFirstMonthPromo =
    method === "card" && billing === "monthly" && isFirstContract(clinic);
  const promoCouponId = applyFirstMonthPromo
    ? await ensureFirstMonthCoupon(stripe, plan)
    : null;

  // metadata compartida: el webhook discrimina por kind y activa según método+billing.
  const meta = {
    clinicId: clinic.id,
    plan: plan.id,
    kind: "platform-subscription",
    method,
    billing,
    firstMonthPromo: promoCouponId ? "1" : "0",
  };

  let session;
  if (method === "card") {
    // Tarjeta → suscripción mensual que se auto-renueva.
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      customer_update: { address: "auto" },
      ...(automaticTax ? { automatic_tax: { enabled: true } } : {}),
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "mxn",
            unit_amount: unitAmount,
            recurring: { interval: billing === "annual" ? "year" : "month" },
            product_data: {
              name: `DaleControl ${plan.name} — Suscripción ${billing === "annual" ? "anual" : "mensual"}`,
              metadata: { plan: plan.id },
            },
          },
          quantity: 1,
        },
      ],
      metadata: meta,
      subscription_data: { metadata: meta },
      // discounts es incompatible con allow_promotion_codes (no usamos códigos
      // manuales aquí); solo se manda cuando la promo aplica.
      ...(promoCouponId ? { discounts: [{ coupon: promoCouponId }] } : {}),
      success_url: `${baseUrl}/dashboard`,
      cancel_url: `${baseUrl}/dashboard/suspended`,
    });
  } else {
    // SPEI / OXXO → pago ÚNICO de 1 mes (asíncrono, NO auto-renueva). El usuario
    // recibe CLABE/voucher y deposita; la activación llega por
    // checkout.session.async_payment_succeeded. Una sesión de Checkout no mezcla
    // mode "subscription" con OXXO/SPEI, por eso aquí va mode "payment".
    const isSpei = method === "spei";
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      customer_update: { address: "auto" },
      ...(automaticTax ? { automatic_tax: { enabled: true } } : {}),
      payment_method_types: [isSpei ? "customer_balance" : "oxxo"],
      ...(isSpei
        ? {
            payment_method_options: {
              customer_balance: {
                funding_type: "bank_transfer",
                bank_transfer: { type: "mx_bank_transfer" },
              },
            },
          }
        : {}),
      line_items: [
        {
          price_data: {
            currency: "mxn",
            unit_amount: unitAmount,
            product_data: {
              name: `DaleControl ${plan.name} — ${billing === "annual" ? "1 año" : "1 mes"}`,
              metadata: { plan: plan.id },
            },
          },
          quantity: 1,
        },
      ],
      metadata: meta,
      payment_intent_data: { metadata: meta },
      // Vuelve al panel mostrando "esperando confirmación" (sigue pending_payment
      // hasta que Stripe confirme el depósito/voucher).
      success_url: `${baseUrl}/dashboard/suspended?pending=${method}`,
      cancel_url: `${baseUrl}/dashboard/suspended`,
    });
  }

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
        after: { plan: plan.id, priceMxn: plan.priceMxn, billing, amountMxn: unitAmount / 100, firstMonthCoupon: promoCouponId, sessionId: session.id },
      },
    },
    ipAddress,
    userAgent,
  });

  return NextResponse.json({ url: session.url });
}
