import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import { getResolvedPlan, getPlanLimits } from "@/lib/plans";
import { logAudit, extractAuditMeta } from "@/lib/audit";
import {
  changeDirection,
  chargeFailureMessage,
  isLiveSubscriptionStatus,
  isStripeChargeFailure,
  planAmountCents,
} from "@/lib/billing/proration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  plan: z.enum(PLAN_IDS),
});

/**
 * POST /api/billing/change-plan
 *
 * Cambia el plan de la clínica. Dos caminos según cómo paga:
 *
 *  1. SUSCRIPCIÓN DE TARJETA VIVA (`stripeSubscriptionId`):
 *     - UPGRADE   → `always_invoice` + `error_if_incomplete`: Stripe cobra AHORA
 *       solo el diferencial de los días que quedan del periodo y, si la tarjeta
 *       rechaza, la operación falla completa (el plan superior NO queda gratis).
 *       La fecha de renovación NO se mueve (jamás fijamos el ancla del ciclo),
 *       así que en la fecha original se cobra el mes/año COMPLETO del plan nuevo.
 *     - DOWNGRADE → `create_prorations` (como siempre): el crédito a favor se
 *       aplica a la próxima factura, sin nota de crédito inmediata.
 *
 *  2. SIN SUSCRIPCIÓN DE TARJETA: el plan es solo una preferencia, se actualiza
 *     in-place y se cobra al activar en /dashboard/suspended (que preselecciona
 *     este plan).
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
      name: true,
      email: true,
      plan: true,
      subscriptionStatus: true,
      trialEndsAt: true,
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

  const currentPlan = await getResolvedPlan(clinic.plan);
  const { ipAddress, userAgent } = extractAuditMeta(req);

  /** Aplica el plan en la BD sin cobrar (preferencia / diferencial nulo). */
  const applyInPlace = async (event: string, extra?: Record<string, unknown>) => {
    const planLimits = await getPlanLimits(targetPlanId);
    await prisma.clinic.update({
      where: { id: clinic.id },
      data: {
        plan: targetPlanId,
        aiTokensLimit: planLimits.aiTokensDefault,
      },
    });
    await logAudit({
      clinicId: clinic.id,
      userId: user.id,
      entityType: "subscription",
      entityId: clinic.id,
      action: "update",
      changes: {
        plan: { before: clinic.plan, after: targetPlanId },
        _source: { before: null, after: { event, priceMxn: targetPlan.priceMxn, ...(extra ?? {}) } },
      },
      ipAddress,
      userAgent,
    });
    return NextResponse.json({ mode: "in-place", plan: targetPlanId });
  };

  // ───────────────────────────────────────────────────────────────────────────
  // (2) SIN SUSCRIPCIÓN DE TARJETA
  // ───────────────────────────────────────────────────────────────────────────
  // El plan es solo una preferencia: se actualiza in-place y el cobro ocurre
  // cuando el usuario "Activa/paga" su plan en /dashboard/suspended (que
  // preselecciona este plan). NO tocamos subscriptionStatus.
  if (!clinic.stripeSubscriptionId) {
    return applyInPlace("self-service-change-plan-unpaid");
  }

  // ───────────────────────────────────────────────────────────────────────────
  // (1) SUSCRIPCIÓN DE TARJETA
  // ───────────────────────────────────────────────────────────────────────────
  const stripe = getStripeSafe();
  if (!stripe) {
    return NextResponse.json(stripeUnavailableResponse(), { status: 503 });
  }

  // Stripe requiere el `id` del subscription item para reemplazar su price — no
  // acepta el subscriptionId directo. Lo obtenemos.
  // El try/catch es necesario: una suscripción borrada en Stripe devolvía un 500
  // crudo al usuario.
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(clinic.stripeSubscriptionId, {
      expand: ["items.data"],
    });
  } catch (err: any) {
    const code = err?.code ?? err?.raw?.code;
    if (code === "resource_missing") {
      return NextResponse.json(
        {
          code: "SUBSCRIPTION_MISSING",
          error:
            'Tu suscripción ya no existe en Stripe. Vuelve a activarla con "Activar / pagar mi plan" y elige el plan que quieres.',
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { code: "STRIPE_ERROR", error: err?.message ?? "Stripe no respondió" },
      { status: 502 },
    );
  }

  // Una suscripción cancelada/incompleta no se puede modificar ni cobrar: hay
  // que reactivarla. Antes se intentaba el update y Stripe reventaba con 500.
  if (!isLiveSubscriptionStatus(sub.status)) {
    return NextResponse.json(
      {
        code: "SUBSCRIPTION_NOT_LIVE",
        error: `Tu suscripción no está activa en Stripe (estado: ${sub.status}). Reactívala con "Activar / pagar mi plan" y elige el plan que quieres.`,
      },
      { status: 409 },
    );
  }

  const item = sub.items.data[0];
  if (!item) {
    return NextResponse.json(
      { error: "Suscripción sin items en Stripe" },
      { status: 500 },
    );
  }

  // Respetamos el INTERVALO de la suscripción actual: si es ANUAL debe seguir
  // anual al cambiar de plan (antes se creaba siempre mensual → una suscripción
  // anual quedaba convertida a price mensual: bug). Mensual sigue mensual.
  // Default defensivo a mensual si Stripe no reporta `recurring` (no debería
  // ocurrir en una suscripción viva). El monto sale del ciclo del plan nuevo.
  const isAnnual = item.price.recurring?.interval === "year";
  const interval = isAnnual ? "year" : "month";
  const unitAmount = planAmountCents(targetPlan, interval);

  // Dirección del cambio comparando el importe del plan destino contra el del
  // price ACTUAL de la suscripción (mismo intervalo). Si el price no expone
  // `unit_amount` (tarifas por tramos), caemos al precio configurado del plan.
  const currentUnitAmount = item.price.unit_amount ?? planAmountCents(currentPlan, interval);
  const direction = changeDirection(currentUnitAmount, unitAmount);
  const isUpgrade = direction === "upgrade";

  // Creamos el price nuevo on-the-fly (mismo patrón que el checkout
  // self-service) para evitar mantener Price IDs pre-creados.
  const newPrice = await stripe.prices.create({
    currency: "mxn",
    unit_amount: unitAmount,
    recurring: { interval: isAnnual ? "year" : "month" },
    product_data: {
      name: `DaleControl ${targetPlan.name} — Suscripción ${isAnnual ? "anual" : "mensual"}`,
      metadata: { plan: targetPlan.id },
    },
  });

  // UPGRADE: "always_invoice" factura y COBRA el prorrateo de inmediato (antes
  // era "create_prorations", que lo posponía a la factura de la renovación), y
  // "error_if_incomplete" hace fallar toda la operación si la tarjeta rechaza
  // (con el default `allow_incomplete` el plan superior quedaba aplicado gratis).
  // DOWNGRADE: se conserva "create_prorations" — el crédito a favor va a la
  // próxima factura, sin nota de crédito inmediata.
  //
  // NO fijamos el ancla del ciclo de facturación: el default de Stripe la deja
  // sin cambio, y eso es justo lo que queremos — la fecha de renovación NO se
  // mueve y en esa fecha se cobra el periodo COMPLETO del plan nuevo.
  //
  // Sin idempotencyKey a propósito: una clave estable haría que Stripe repitiera
  // la respuesta cacheada (incluido el error) cuando el usuario corrige su
  // tarjeta y reintenta. El doble clic ya es inocuo — con el price nuevo puesto,
  // un segundo update no genera prorrateo.
  let updated: Stripe.Subscription;
  try {
    updated = await stripe.subscriptions.update(clinic.stripeSubscriptionId, {
      items: [{ id: item.id, price: newPrice.id }],
      proration_behavior: isUpgrade ? "always_invoice" : "create_prorations",
      ...(isUpgrade ? { payment_behavior: "error_if_incomplete" as const } : {}),
      metadata: {
        ...(sub.metadata ?? {}),
        clinicId: clinic.id,
        plan: targetPlan.id,
        kind: "platform-subscription",
      },
    });
  } catch (err: any) {
    // El cobro del diferencial falló → Stripe NO aplicó el price nuevo. No
    // escribimos clinic.plan: la clínica se queda en su plan actual.
    await logAudit({
      clinicId: clinic.id,
      userId: user.id,
      entityType: "subscription",
      entityId: clinic.stripeSubscriptionId,
      action: "update",
      changes: {
        _source: {
          before: null,
          after: {
            event: "self-service-change-plan-failed",
            attemptedPlan: targetPlan.id,
            direction,
            code: err?.code ?? err?.raw?.code ?? null,
            declineCode: err?.decline_code ?? err?.raw?.decline_code ?? null,
          },
        },
      },
      ipAddress,
      userAgent,
    }).catch(() => {});

    if (isStripeChargeFailure(err)) {
      return NextResponse.json(
        { code: "UPGRADE_PAYMENT_FAILED", error: chargeFailureMessage(err) },
        { status: 402 },
      );
    }
    return NextResponse.json(
      { code: "STRIPE_ERROR", error: err?.message ?? "Stripe rechazó el cambio de plan" },
      { status: 502 },
    );
  }

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

  await logAudit({
    clinicId: clinic.id,
    userId: user.id,
    entityType: "subscription",
    entityId: clinic.stripeSubscriptionId,
    action: "update",
    changes: {
      plan: { before: clinic.plan, after: targetPlanId },
      _source: {
        before: null,
        after: {
          event: "self-service-change-plan",
          billing: isAnnual ? "annual" : "monthly",
          direction,
          prorationBehavior: isUpgrade ? "always_invoice" : "create_prorations",
          priceMxn: unitAmount / 100,
        },
      },
    },
    ipAddress,
    userAgent,
  });

  return NextResponse.json({
    mode: "in-place",
    plan: targetPlanId,
    status: updated.status,
    direction,
    chargedNow: isUpgrade,
  });
}
