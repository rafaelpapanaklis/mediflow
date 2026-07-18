import "server-only";
import { prisma } from "@/lib/prisma";
import { getStripeSafe } from "@/lib/stripe";
import type Stripe from "stripe";

/**
 * Cobro del EXCEDENTE de facturas CFDI (timbres por encima del cupo del plan).
 *
 * Reúsa el PATRÓN probado de chargeOffSession (src/lib/ai-billing/recharge.ts)
 * pero SIN monedero: aquí es un cobro directo. Dinero en centavos MXN (en MXN la
 * unidad mínima de Stripe ES el centavo → `amountCents` va tal cual, sin ×100).
 *
 * Idempotencia por idempotencyKey estable (clinicId+period): reintentos del cron
 * colapsan en el mismo PaymentIntent/InvoiceItem y jamás cobran doble.
 */

/** metadata.kind que marca un PaymentIntent/InvoiceItem como excedente CFDI.
 *  El webhook de Stripe gatea por este valor para NO tocar los ai-topup. */
export const CFDI_OVERAGE_KIND = "cfdi-overage";

/**
 * SubscriptionInvoice.method del adeudo manual por excedente CFDI. A propósito
 * FUERA de la lista de pendingTransfers del admin (transfer/deposit/oxxo/paypal)
 * para que verify_payment NO lo mal-active como una mensualidad; es solo un
 * adeudo visible/collectable en el panel de la clínica.
 */
export const CFDI_OVERAGE_METHOD = "cfdi_overage";

export type OverageMode = "monthly_sub" | "annual_card" | "manual";

export interface OverageBilling {
  mode: OverageMode;
  customerId: string | null;
  paymentMethodId: string | null;
  subscriptionId: string | null;
}

const LIVE_SUB_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"]);

/**
 * Resuelve CÓMO se cobra el excedente de una clínica, combinando campos locales
 * con una consulta EN VIVO a Stripe (el intervalo mensual/anual y la tarjeta por
 * defecto NO se guardan en la DB local, viven en la suscripción). Best-effort:
 * si Stripe no está configurado o la suscripción no vive, cae a "manual".
 *
 *  - monthly_sub → suscripción Stripe MENSUAL viva: el excedente se suma como
 *    InvoiceItem a la próxima mensualidad.
 *  - annual_card → suscripción Stripe ANUAL viva con tarjeta: cobro off-session
 *    el día 1.
 *  - manual → sin suscripción viva (SPEI/OXXO/pago único): adeudo registrado.
 */
export async function resolveOverageBilling(clinic: {
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
}): Promise<OverageBilling> {
  const base: OverageBilling = {
    mode: "manual",
    customerId: clinic.stripeCustomerId,
    paymentMethodId: clinic.stripePaymentMethodId,
    subscriptionId: clinic.stripeSubscriptionId,
  };
  if (!clinic.stripeSubscriptionId) return base;

  const stripe = getStripeSafe();
  if (!stripe) return base;

  try {
    const sub = await stripe.subscriptions.retrieve(clinic.stripeSubscriptionId, {
      expand: ["items.data", "default_payment_method"],
    });
    if (!LIVE_SUB_STATUSES.has(sub.status)) return base;

    const interval = sub.items.data[0]?.price?.recurring?.interval;
    const subPm =
      typeof sub.default_payment_method === "string"
        ? sub.default_payment_method
        : sub.default_payment_method?.id ?? null;
    const paymentMethodId = subPm ?? clinic.stripePaymentMethodId ?? null;
    const customerId =
      (typeof sub.customer === "string" ? sub.customer : sub.customer?.id) ??
      clinic.stripeCustomerId ??
      null;

    if (!customerId) return base;

    if (interval === "year") {
      return { mode: "annual_card", customerId, paymentMethodId, subscriptionId: sub.id };
    }
    // month (o cualquier otro intervalo recurrente) → InvoiceItem en la mensualidad.
    return { mode: "monthly_sub", customerId, paymentMethodId, subscriptionId: sub.id };
  } catch {
    return base;
  }
}

export interface OffSessionResult {
  status: "succeeded" | "failed";
  paymentIntentId: string | null;
  error?: string;
}

/**
 * Cobra el excedente CFDI OFF-SESSION (clínica anual con tarjeta). Espejo de
 * chargeOffSession, sin acreditar monedero. En fallo NO deja rastro de cobro
 * (el cron lo convierte en adeudo manual visible).
 */
export async function chargeOverageOffSession(params: {
  clinicId: string;
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  period: string;
}): Promise<OffSessionResult> {
  const amount = Math.floor(params.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { status: "failed", paymentIntentId: null, error: "Monto inválido" };
  }

  const stripe = getStripeSafe();
  if (!stripe) return { status: "failed", paymentIntentId: null, error: "Stripe no configurado" };

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount,
        currency: "mxn",
        customer: params.customerId,
        payment_method: params.paymentMethodId,
        off_session: true,
        confirm: true,
        description: `MediFlow — Facturas CFDI adicionales ${params.period}`,
        metadata: {
          kind: CFDI_OVERAGE_KIND,
          clinicId: params.clinicId,
          period: params.period,
          amountCents: String(amount),
        },
      },
      // Un solo cobro por clínica/periodo aunque el cron corra dos veces.
      { idempotencyKey: `cfdi-overage:${params.clinicId}:${params.period}` },
    );
    if (pi.status === "succeeded") return { status: "succeeded", paymentIntentId: pi.id };
    // requires_action / requires_payment_method / processing → no se cobró.
    return { status: "failed", paymentIntentId: pi.id, error: `requires_action:${pi.status}` };
  } catch (err: any) {
    const code = err?.code ?? err?.raw?.code;
    const failedPi: Stripe.PaymentIntent | undefined = err?.raw?.payment_intent ?? err?.payment_intent;
    return { status: "failed", paymentIntentId: failedPi?.id ?? null, error: code ?? err?.message ?? "Cobro rechazado" };
  }
}

/**
 * Suma el excedente CFDI como InvoiceItem a la próxima factura de la mensualidad
 * (clínica mensual con suscripción Stripe). Idempotente por idempotencyKey.
 */
export async function addOverageInvoiceItem(params: {
  clinicId: string;
  customerId: string;
  amountCents: number;
  period: string;
  overage: number;
}): Promise<{ ok: boolean; invoiceItemId: string | null; error?: string }> {
  const amount = Math.floor(params.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, invoiceItemId: null, error: "Monto inválido" };
  }

  const stripe = getStripeSafe();
  if (!stripe) return { ok: false, invoiceItemId: null, error: "Stripe no configurado" };

  try {
    const item = await stripe.invoiceItems.create(
      {
        customer: params.customerId,
        amount,
        currency: "mxn",
        description: `Facturas CFDI adicionales ${params.period} (${params.overage} × timbre)`,
        metadata: { kind: CFDI_OVERAGE_KIND, clinicId: params.clinicId, period: params.period },
      },
      { idempotencyKey: `cfdi-overage-item:${params.clinicId}:${params.period}` },
    );
    return { ok: true, invoiceItemId: item.id };
  } catch (err: any) {
    return { ok: false, invoiceItemId: null, error: err?.message ?? "Error InvoiceItem" };
  }
}

/**
 * Backstop de webhook: reconcilia un cobro off-session de excedente CFDI cuando
 * llega payment_intent.succeeded/failed. El cron ya marca el resultado de forma
 * síncrona; esto solo cubre el caso raro de que el proceso muriera entre el
 * cobro y la escritura en DB. Idempotente: NO toca periodos ya cerrados
 * (billedAt seteado) para no pisar la decisión del cron (p. ej. un adeudo manual
 * creado tras un fallo).
 */
export async function reconcileOverageFromWebhook(
  pi: { id: string; metadata?: Stripe.Metadata | null },
  ok: boolean,
): Promise<void> {
  const clinicId = pi.metadata?.clinicId;
  const period = pi.metadata?.period;
  if (!clinicId || !period) return;

  const row = await prisma.cfdiUsage.findUnique({
    where: { clinicId_period: { clinicId, period } },
    select: { billedAt: true },
  });
  if (!row || row.billedAt) return; // el cron ya cerró el periodo: no re-tocar.

  await prisma.cfdiUsage.update({
    where: { clinicId_period: { clinicId, period } },
    data: {
      billingStatus: ok ? "charged" : "failed",
      stripeRef: pi.id,
      billedAt: new Date(),
    },
  });
}
