import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import { getResolvedPlan } from "@/lib/plans";
import {
  buildPreviewSubscriptionItems,
  changeDirection,
  daysRemainingUntil,
  hasProrationLines,
  isLiveSubscriptionStatus,
  manualPaidUntil,
  mapPreviewLines,
  planAmountCents,
  previewAmountDueNow,
  resolveChangeDirection,
  subscriptionItemInterval,
  subscriptionPeriodEndSeconds,
  type BillingInterval,
  type ChangePlanPreviewLine,
} from "@/lib/billing/proration";
import { buildManualUpgradeQuote } from "@/lib/billing/manual-upgrade";
import { isClinicBillingAdmin, notClinicBillingAdminResponse } from "@/lib/billing/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ plan: z.enum(PLAN_IDS) });

export type { ChangePlanPreviewLine };

export interface ChangePlanPreview {
  /** "subscription" = tarjeta viva | "manual" = SPEI/OXXO pagado | "in-place" = aún no paga. */
  mode: "subscription" | "manual" | "in-place";
  direction: "upgrade" | "downgrade" | "same";
  interval: BillingInterval;
  currency: string;
  /** Lo que se cobra AHORA (MXN). 0 = sin cobro inmediato. */
  amountDueNow: number;
  daysRemaining: number;
  nextBillingDate: string | null;
  /** Periodo COMPLETO del plan destino que se cobrará en la renovación (MXN). */
  nextAmount: number;
  lines: ChangePlanPreviewLine[];
  /** true = Stripe no pudo simular la factura; el monto exacto no es confiable. */
  unavailable: boolean;
}

/**
 * GET /api/billing/change-plan/preview
 *
 * Contexto de facturación de la clínica, SIN simular nada: lo usa el panel para
 * pintar los precios en el INTERVALO real de la suscripción (una clínica anual
 * veía precios mensuales, así que el delta que le mostrábamos era falso).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!isClinicBillingAdmin(user.role)) {
    return NextResponse.json(notClinicBillingAdminResponse(), { status: 403 });
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: user.clinicId },
    select: {
      id: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      nextBillingDate: true,
      stripeSubscriptionId: true,
    },
  });
  if (!clinic) {
    return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
  }

  if (!clinic.stripeSubscriptionId) {
    return NextResponse.json({
      hasSubscription: false,
      interval: null,
      status: clinic.subscriptionStatus ?? null,
      // MISMO "pagado-hasta" que usa el POST para cotizar: el panel decide con
      // esta fecha si ofrecer el CTA de pagar el periodo nuevo.
      nextBillingDate: manualPaidUntil(clinic)?.toISOString() ?? null,
    });
  }

  const stripe = getStripeSafe();
  if (!stripe) {
    return NextResponse.json({
      hasSubscription: true,
      interval: null,
      status: clinic.subscriptionStatus ?? null,
      nextBillingDate: clinic.nextBillingDate?.toISOString() ?? null,
    });
  }

  // Un fallo de Stripe aquí NO debe romper el tab: se devuelve interval null y
  // el panel cae al comportamiento anterior (precios mensuales).
  try {
    const sub = await stripe.subscriptions.retrieve(clinic.stripeSubscriptionId, {
      expand: ["items.data"],
    });
    const item = sub.items.data[0];
    const periodEnd = subscriptionPeriodEnd(sub);
    return NextResponse.json({
      hasSubscription: true,
      interval: subscriptionItemInterval(item),
      status: sub.status,
      live: isLiveSubscriptionStatus(sub.status),
      nextBillingDate: periodEnd
        ? new Date(periodEnd * 1000).toISOString()
        : clinic.nextBillingDate?.toISOString() ?? null,
    });
  } catch {
    return NextResponse.json({
      hasSubscription: true,
      interval: null,
      status: clinic.subscriptionStatus ?? null,
      nextBillingDate: clinic.nextBillingDate?.toISOString() ?? null,
    });
  }
}

/**
 * POST /api/billing/change-plan/preview
 *
 * Simula el cambio de plan y devuelve EXACTAMENTE lo que se cobrará ahora, sin
 * ningún efecto: ni crea prices, ni toca la suscripción, ni escribe en la BD.
 *
 * Con suscripción de tarjeta usa la simulación de factura de Stripe con
 * `proration_behavior: "always_invoice"`, así que el total incluye TODO lo que
 * caerá en esa factura — incluidos los InvoiceItems pendientes a nivel customer
 * (p. ej. los excedentes CFDI que suma el cron de `lib/cfdi-overage.ts`, que con
 * `always_invoice` se adelantan a la factura del upgrade en vez de esperar a la
 * mensualidad). Por eso el importe que ve el cliente es el real.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
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
    return NextResponse.json({ error: "plan inválido" }, { status: 400 });
  }

  const targetPlanId: PlanId = parsed.data.plan;
  const clinic = await prisma.clinic.findUnique({
    where: { id: user.clinicId },
    select: {
      id: true,
      plan: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      nextBillingDate: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
    },
  });
  if (!clinic) {
    return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
  }
  if (clinic.plan === targetPlanId) {
    return NextResponse.json({ error: "Ya estás en este plan" }, { status: 400 });
  }

  const targetPlan = await getResolvedPlan(targetPlanId);
  const currentPlan = await getResolvedPlan(clinic.plan);

  // ── Sin suscripción de tarjeta ────────────────────────────────────────────
  if (!clinic.stripeSubscriptionId) {
    const manualPaid = clinic.subscriptionStatus === "active" || clinic.subscriptionStatus === "paid";
    if (!manualPaid) {
      // Aún no paga: el plan es solo preferencia, no hay cobro que previsualizar.
      const payload: ChangePlanPreview = {
        mode: "in-place",
        direction: changeDirection(currentPlan.priceMxn * 100, targetPlan.priceMxn * 100),
        interval: "month",
        currency: "MXN",
        amountDueNow: 0,
        daysRemaining: 0,
        nextBillingDate: null,
        nextAmount: targetPlan.priceMxn,
        lines: [],
        unavailable: false,
      };
      return NextResponse.json(payload);
    }

    const quote = await buildManualUpgradeQuote({
      clinicId: clinic.id,
      // Misma definición de "pagado-hasta" que el POST que cobra: si divergen,
      // el modal cotiza un periodo distinto del que se factura.
      paidUntil: manualPaidUntil(clinic),
      currentPlan,
      targetPlan,
    });
    const payload: ChangePlanPreview = {
      mode: "manual",
      direction: quote.direction,
      interval: quote.interval,
      currency: "MXN",
      amountDueNow: quote.chargeable ? quote.diffCents / 100 : 0,
      daysRemaining: quote.daysRemaining,
      nextBillingDate: quote.periodEnd?.toISOString() ?? null,
      nextAmount: quote.targetCents / 100,
      lines: quote.chargeable
        ? [
            {
              description: `Diferencia al plan ${targetPlan.name} por ${quote.daysRemaining} día(s) restantes`,
              amount: quote.diffCents / 100,
            },
          ]
        : [],
      unavailable: false,
    };
    return NextResponse.json(payload);
  }

  // ── Con suscripción de tarjeta ────────────────────────────────────────────
  const stripe = getStripeSafe();
  if (!stripe) {
    return NextResponse.json(stripeUnavailableResponse(), { status: 503 });
  }

  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(clinic.stripeSubscriptionId, {
      expand: ["items.data"],
    });
  } catch (err: any) {
    const code = err?.code ?? err?.raw?.code;
    return NextResponse.json(
      {
        code: code === "resource_missing" ? "SUBSCRIPTION_MISSING" : "STRIPE_ERROR",
        error: err?.message ?? "Stripe no respondió",
      },
      { status: code === "resource_missing" ? 409 : 502 },
    );
  }

  if (!isLiveSubscriptionStatus(sub.status)) {
    return NextResponse.json(
      { code: "SUBSCRIPTION_NOT_LIVE", error: `Suscripción no activa (${sub.status})` },
      { status: 409 },
    );
  }

  const item = sub.items.data[0];
  if (!item) {
    return NextResponse.json({ code: "NO_ITEMS", error: "Suscripción sin items" }, { status: 409 });
  }

  const interval: BillingInterval = subscriptionItemInterval(item);
  const targetCents = planAmountCents(targetPlan, interval);
  const currentCents = item.price.unit_amount ?? planAmountCents(currentPlan, interval);
  // MISMO criterio que el POST que cobra (tier como veto): si divergen, el modal
  // anuncia un cobro inmediato que no ocurre, o al revés.
  const direction = resolveChangeDirection({
    currentCents,
    targetCents,
    currentPlanId: clinic.plan,
    targetPlanId,
  });

  const periodEnd = subscriptionPeriodEnd(sub);
  const nextBillingDate = periodEnd
    ? new Date(periodEnd * 1000)
    : clinic.nextBillingDate ?? null;
  const daysRemaining = daysRemainingUntil(nextBillingDate);

  const baseline: ChangePlanPreview = {
    mode: "subscription",
    direction,
    interval,
    currency: (item.price.currency ?? "mxn").toUpperCase(),
    amountDueNow: 0,
    daysRemaining,
    nextBillingDate: nextBillingDate?.toISOString() ?? null,
    nextAmount: targetCents / 100,
    lines: [],
    unavailable: false,
  };

  // Solo el UPGRADE cobra de inmediato (always_invoice). En downgrade el cambio
  // real usa create_prorations: no hay factura hoy, así que no gastamos una
  // llamada a Stripe simulando una que no se va a emitir.
  if (direction !== "upgrade") {
    return NextResponse.json(baseline);
  }

  // El product del price ACTUAL se reutiliza para la simulación: `price_data`
  // exige un product existente y crear uno nuevo por cada preview ensuciaría la
  // cuenta de Stripe con objetos basura. El importe (lo único que afecta el
  // prorrateo) sí es el del plan destino; las descripciones de las líneas de
  // prorrateo las reescribimos abajo con los nombres reales de los planes.
  const productId = typeof item.price.product === "string" ? item.price.product : item.price.product?.id;

  // Sin product no podemos armar el `price_data`, y simular SIN cambiar el
  // importe devolvería la factura del próximo ciclo — un número muy distinto al
  // del prorrateo. Antes que mostrar un monto equivocado, "no disponible".
  if (!productId) {
    console.warn("[change-plan preview] price sin product; no se puede simular");
    return NextResponse.json({ ...baseline, unavailable: true });
  }

  const previewItems = buildPreviewSubscriptionItems({
    itemId: item.id,
    quantity: item.quantity ?? 1,
    currency: item.price.currency ?? "mxn",
    productId,
    interval,
    targetCents,
  });

  let invoice: any = null;
  let previewError: string | null = null;
  try {
    // SDK 22 expone `invoices.createPreview` (reemplazó a `retrieveUpcoming`).
    invoice = await (stripe.invoices as any).createPreview({
      customer: clinic.stripeCustomerId ?? undefined,
      subscription: clinic.stripeSubscriptionId,
      subscription_details: {
        items: previewItems,
        proration_behavior: "always_invoice",
      },
    });
  } catch (err: any) {
    previewError = err?.message ?? "createPreview falló";
    // Fallback al endpoint legacy `GET /v1/invoices/upcoming`, que es el que
    // corresponde a la versión de API que la app tiene pineada (2024-06-20) por
    // si la cuenta aún no acepta create_preview.
    try {
      invoice = await stripe.rawRequest("GET", "/v1/invoices/upcoming", {
        subscription: clinic.stripeSubscriptionId,
        subscription_items: previewItems,
        subscription_proration_behavior: "always_invoice",
      } as any);
      previewError = null;
    } catch (err2: any) {
      previewError = `${previewError} / upcoming: ${err2?.message ?? "falló"}`;
    }
  }

  if (!invoice) {
    console.warn("[change-plan preview] simulación no disponible:", previewError);
    // El panel muestra un aviso genérico y deja cancelar: NUNCA bloqueamos el
    // cambio de plan por no poder previsualizar.
    return NextResponse.json({ ...baseline, unavailable: true });
  }

  const rawLines: any[] = invoice.lines?.data ?? [];

  // Red de seguridad sobre dinero real: una factura de prorrateo SIEMPRE trae
  // líneas con `proration: true` (crédito del tiempo no usado + tiempo restante
  // del plan nuevo). Si no hay ninguna, lo que devolvió Stripe no es el cobro
  // inmediato que vamos a hacer (p. ej. es la factura del próximo ciclo) y
  // mostrar ese importe engañaría al cliente: preferimos "no disponible".
  if (!hasProrationLines(rawLines)) {
    console.warn("[change-plan preview] la simulación no trae líneas de prorrateo; no se muestra importe");
    return NextResponse.json({ ...baseline, unavailable: true });
  }

  const lines: ChangePlanPreviewLine[] = mapPreviewLines(rawLines, {
    currentPlanName: currentPlan.name,
    targetPlanName: targetPlan.name,
    daysRemaining,
  });

  // `amount_due` trae el prorrateo + los InvoiceItems pendientes del customer
  // (excedentes CFDI) + el saldo a favor: es lo que se cobrará hoy... SIEMPRE
  // QUE la factura simulada sea la del cobro inmediato. Si Stripe devolvió la
  // del próximo ciclo (trae la renovación completa además del prorrateo),
  // `amount_due` está inflado por un periodo entero y NO se muestra importe.
  const amountDueNow = previewAmountDueNow(invoice, periodEnd);
  if (amountDueNow === null) {
    console.warn("[change-plan preview] la simulación incluye la renovación; no se muestra importe");
    return NextResponse.json({ ...baseline, unavailable: true });
  }

  return NextResponse.json({
    ...baseline,
    currency: (invoice.currency ?? item.price.currency ?? "mxn").toUpperCase(),
    amountDueNow,
    lines,
  } satisfies ChangePlanPreview);
}

/** Fin del periodo en curso: en la suscripción o, en versiones nuevas de la API, en el item. */
function subscriptionPeriodEnd(sub: Stripe.Subscription): number | undefined {
  return subscriptionPeriodEndSeconds(sub);
}
