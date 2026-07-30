import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import { getResolvedPlan } from "@/lib/plans";
import {
  changeDirection,
  daysRemainingUntil,
  isLiveSubscriptionStatus,
  planAmountCents,
  type BillingInterval,
} from "@/lib/billing/proration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ plan: z.enum(PLAN_IDS) });

export interface ChangePlanPreviewLine {
  description: string;
  /** MXN (no centavos). Negativo = crédito a favor. */
  amount: number;
}

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

/** Solo el dueño/admin de la clínica ve importes de facturación. */
function isClinicAdmin(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
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
  if (!isClinicAdmin(user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
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
      nextBillingDate: (clinic.nextBillingDate ?? clinic.trialEndsAt)?.toISOString() ?? null,
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
      interval: item?.price.recurring?.interval === "year" ? "year" : "month",
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
  if (!isClinicAdmin(user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
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
  // El plan es solo una preferencia hasta que la clínica activa/paga: no hay
  // cobro inmediato que previsualizar.
  if (!clinic.stripeSubscriptionId) {
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

  const interval: BillingInterval = item.price.recurring?.interval === "year" ? "year" : "month";
  const targetCents = planAmountCents(targetPlan, interval);
  const currentCents = item.price.unit_amount ?? planAmountCents(currentPlan, interval);
  const direction = changeDirection(currentCents, targetCents);

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

  const previewItems = [
    {
      id: item.id,
      quantity: item.quantity ?? 1,
      price_data: {
        currency: item.price.currency ?? "mxn",
        product: productId,
        recurring: { interval },
        unit_amount: targetCents,
      },
    },
  ];

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
  if (!rawLines.some((line) => line.proration)) {
    console.warn("[change-plan preview] la simulación no trae líneas de prorrateo; no se muestra importe");
    return NextResponse.json({ ...baseline, unavailable: true });
  }

  const lines: ChangePlanPreviewLine[] = rawLines.map((line) => {
    const amount = (line.amount ?? 0) / 100;
    if (line.proration) {
      return {
        description:
          amount < 0
            ? `Crédito por el tiempo no usado del plan ${currentPlan.name}`
            : `Plan ${targetPlan.name} por los ${daysRemaining} día(s) que te quedan`,
        amount,
      };
    }
    return { description: line.description ?? "Concepto", amount };
  });

  return NextResponse.json({
    ...baseline,
    currency: (invoice.currency ?? item.price.currency ?? "mxn").toUpperCase(),
    // `amount_due` ya trae el prorrateo + los InvoiceItems pendientes del
    // customer (excedentes CFDI) + el saldo a favor: es EXACTAMENTE lo que se
    // cobrará hoy.
    amountDueNow: Math.max(0, (invoice.amount_due ?? 0) / 100),
    lines,
  } satisfies ChangePlanPreview);
}

/** Fin del periodo en curso: en la suscripción o, en versiones nuevas de la API, en el item. */
function subscriptionPeriodEnd(sub: Stripe.Subscription): number | undefined {
  return ((sub as any).current_period_end
    ?? (sub as any).items?.data?.[0]?.current_period_end) as number | undefined;
}
