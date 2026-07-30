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
  PLAN_UPGRADE_DIFF_KIND,
  changeDirection,
  chargeFailureMessage,
  isLiveSubscriptionStatus,
  isStripeChargeFailure,
  planAmountCents,
} from "@/lib/billing/proration";
import { buildManualUpgradeQuote } from "@/lib/billing/manual-upgrade";
import { isClinicBillingAdmin, notClinicBillingAdminResponse } from "@/lib/billing/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  plan: z.enum(PLAN_IDS),
  // Solo aplica al Checkout de diferencial de clínicas SPEI/OXXO (ver abajo).
  // "card" abre tarjeta + OXXO; "spei"/"oxxo" fuerzan un único método.
  method: z.enum(["card", "spei", "oxxo"]).optional(),
});

/**
 * Clínicas que YA pagaron el periodo en curso por SPEI/OXXO: pago único, sin
 * suscripción en Stripe. Antes subían de plan GRATIS por el resto del periodo;
 * ahora se les cobra el diferencial prorrateado (ver bloque MANUAL).
 * "paid" es legado (nada lo escribe hoy) pero cuenta como periodo pagado.
 */
const MANUAL_PAID_STATUSES = ["active", "paid"];

/**
 * POST /api/billing/change-plan
 *
 * Cambia el plan de la clínica. Tres caminos según cómo paga:
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
 *  2. SPEI/OXXO YA PAGADO (`subscriptionStatus` activo, sin suscripción):
 *     UPGRADE → devuelve una sesión de Checkout `mode: "payment"` por el
 *     diferencial prorrateado; el plan se aplica cuando el webhook confirma el
 *     pago, SIN mover `trialEndsAt`/`nextBillingDate` (el periodo no se
 *     extiende: solo mejora el plan). DOWNGRADE → 409 (ver abajo).
 *
 *  3. SIN PAGAR AÚN (`pending_payment` / sin suscripción): el plan es solo una
 *     preferencia, se actualiza in-place y se cobra al activar en
 *     /dashboard/suspended (que preselecciona este plan).
 *
 * Multi-tenant: clinicId siempre del ctx, NUNCA del body.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  // Este endpoint COBRA (el upgrade con tarjeta factura de inmediato). Solo
  // dueño/admin, igual que el preview y que el tab de Suscripción: sin esto
  // cualquier usuario logueado de la clínica podía dispararlo con un fetch.
  if (!isClinicBillingAdmin(user.role)) {
    return NextResponse.json(notClinicBillingAdminResponse(), { status: 403 });
  }

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
  // SIN SUSCRIPCIÓN DE TARJETA
  // ───────────────────────────────────────────────────────────────────────────
  if (!clinic.stripeSubscriptionId) {
    const manualPaid = MANUAL_PAID_STATUSES.indexOf(clinic.subscriptionStatus ?? "") >= 0;

    // (3) Todavía no pagó (pending_payment / sin status): el plan es solo una
    // preferencia. Se cobra al activar. NO tocamos subscriptionStatus.
    if (!manualPaid) {
      return applyInPlace("self-service-change-plan-unpaid");
    }

    // (2) SPEI/OXXO ya pagado: cobramos el diferencial prorrateado de los días
    // que le quedan. Sin esto la clínica subía de plan gratis por el resto del
    // periodo (fuga de ingresos).
    const quote = await buildManualUpgradeQuote({
      clinicId: clinic.id,
      paidUntil: clinic.trialEndsAt,
      currentPlan,
      targetPlan,
    });

    // DOWNGRADE en SPEI/OXXO → se RECHAZA. La clínica ya pagó el periodo
    // completo del plan actual: bajarlo a medio periodo le quitaría lo pagado y
    // no hay devolución para pagos manuales. Al pagar el siguiente periodo elige
    // el plan menor (el checkout de /dashboard/suspended aplica el que elija).
    if (quote.direction === "downgrade") {
      return NextResponse.json(
        {
          code: "MANUAL_DOWNGRADE_NOT_SUPPORTED",
          error:
            "Ya pagaste el periodo en curso de tu plan actual, así que no lo bajamos a medio periodo. " +
            "Al pagar tu próximo periodo elige el plan menor y se aplicará desde ahí. Si necesitas bajarlo antes, escríbenos a soporte.",
        },
        { status: 409 },
      );
    }

    // Nada que cobrar: periodo ya vencido (0 días), planes del mismo precio o
    // diferencial por debajo del mínimo que Stripe acepta. Aplicamos el plan.
    if (!quote.chargeable) {
      return applyInPlace("self-service-change-plan-manual-free", {
        reason: quote.diffCents > 0 ? "below-stripe-minimum" : "no-days-remaining",
        daysRemaining: quote.daysRemaining,
        diffMxn: quote.diffCents / 100,
      });
    }

    const stripe = getStripeSafe();
    if (!stripe) {
      return NextResponse.json(stripeUnavailableResponse(), { status: 503 });
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
    const automaticTax = process.env.STRIPE_AUTOMATIC_TAX === "true";

    const meta = {
      kind: PLAN_UPGRADE_DIFF_KIND,
      clinicId: clinic.id,
      plan: targetPlan.id,
      fromPlan: clinic.plan,
      daysRemaining: String(quote.daysRemaining),
      interval: quote.interval,
    };

    const method = parsed.data.method ?? "card";
    const isSpei = method === "spei";
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      customer: customerId,
      customer_update: { address: "auto" },
      ...(automaticTax ? { automatic_tax: { enabled: true } } : {}),
      // "card" abre también OXXO para que una clínica que paga en efectivo pueda
      // liquidar la diferencia sin tarjeta. SPEI necesita su propio bloque de
      // opciones, así que va sola (mismo patrón que /api/billing/checkout).
      payment_method_types: isSpei
        ? ["customer_balance"]
        : method === "oxxo"
          ? ["oxxo"]
          : ["card", "oxxo"],
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
            unit_amount: quote.diffCents,
            product_data: {
              name: `DaleControl — Diferencia a plan ${targetPlan.name} (${quote.daysRemaining} días restantes)`,
              metadata: { plan: targetPlan.id, kind: PLAN_UPGRADE_DIFF_KIND },
            },
          },
          quantity: 1,
        },
      ],
      metadata: meta,
      payment_intent_data: { metadata: meta },
      success_url: `${baseUrl}/dashboard/settings?tab=subscription&upgrade=pending`,
      cancel_url: `${baseUrl}/dashboard/settings?tab=subscription`,
    };

    // Idempotencia contra el doble cobro: si el usuario vuelve atrás y repite el
    // cambio, Stripe devuelve LA MISMA sesión en vez de crear un segundo cobro
    // por la misma diferencia. La clave incluye los días restantes, así que si el
    // importe cambia (pasó un día) sí se crea una sesión nueva.
    const idemBase = `plan-upgrade-diff:${clinic.id}:${targetPlan.id}:${quote.interval}:${quote.daysRemaining}:${method}`;

    let session: Stripe.Checkout.Session | null = null;
    try {
      session = await stripe.checkout.sessions.create(sessionParams, { idempotencyKey: idemBase });
    } catch (err: any) {
      // Si la cuenta no acepta OXXO para este monto/moneda, reintenta solo con
      // tarjeta antes de rendirse (clave distinta: los parámetros cambian).
      if (method === "card") {
        session = await stripe.checkout.sessions
          .create(
            { ...sessionParams, payment_method_types: ["card"] },
            { idempotencyKey: `${idemBase}:card-only` },
          )
          .catch(() => null);
      }
      if (!session) {
        return NextResponse.json(
          {
            code: "CHECKOUT_FAILED",
            error: err?.message ?? "No se pudo crear el cobro de la diferencia",
          },
          { status: 502 },
        );
      }
    }

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe no devolvió URL de checkout" },
        { status: 502 },
      );
    }

    // OJO: esta fila comparte `entityType`/`action` con la del checkout, que es
    // de donde `inferManualInterval` deduce el ciclo comprado. NO agregues aquí
    // una llave `billing`: el ciclo de esta fila es INFERIDO, no comprado, y
    // grabarlo cementaría una inferencia equivocada para siempre. Se llama
    // `interval` a propósito, y `pickPurchasedInterval` salta las filas sin
    // `billing` justo para no leer esta como si fuera una compra mensual.
    await logAudit({
      clinicId: clinic.id,
      userId: user.id,
      entityType: "subscription",
      entityId: session.id,
      action: "create",
      changes: {
        _created: {
          before: null,
          after: {
            event: "self-service-change-plan-manual-diff",
            fromPlan: clinic.plan,
            plan: targetPlan.id,
            interval: quote.interval,
            daysRemaining: quote.daysRemaining,
            diffMxn: quote.diffCents / 100,
            method,
            sessionId: session.id,
          },
        },
      },
      ipAddress,
      userAgent,
    });

    // El plan NO se toca aquí: lo aplica el webhook al confirmarse el pago.
    return NextResponse.json({
      mode: "checkout",
      url: session.url,
      plan: targetPlanId,
      amountMxn: quote.diffCents / 100,
      daysRemaining: quote.daysRemaining,
    });
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
