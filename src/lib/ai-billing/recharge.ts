import "server-only";
import { prisma } from "@/lib/prisma";
import getStripe, { getStripeSafe } from "@/lib/stripe";
import type Stripe from "stripe";
import type { RechargeResult } from "./types";

/**
 * Recargas del monedero de IA por Stripe (T3): guardar tarjeta (SetupIntent),
 * top-up on-session (Checkout) y auto-recarga off-session (chargeOffSession).
 * Dinero en centavos MXN (Int). En MXN la unidad mínima de Stripe ES el centavo,
 * así que `amountCents` se pasa tal cual a Stripe (NO se multiplica por 100).
 *
 * No importa wallet.ts (evita ciclo: wallet.ts importa triggerAutoRechargeIfNeeded
 * de aquí). Acredita el monedero vía prisma directamente, replicando el cobro
 * atómico de wallet.ts.
 */

/** Límites de una recarga (centavos MXN). */
export const MIN_TOPUP_CENTS = 5_000; // $50 MXN
export const MAX_TOPUP_CENTS = 2_000_000; // $20,000 MXN

/**
 * Cooldown anti doble-cobro de la auto-recarga: si ya existe una recarga Stripe
 * (PENDING/PAID) de la clínica dentro de esta ventana, no se vuelve a cobrar la
 * tarjeta. Misma ventana que el idempotencyKey de chargeOffSession.
 */
export const AUTO_RECHARGE_COOLDOWN_MS = 5 * 60 * 1000;

/** metadata.kind que marca un pago de Stripe como recarga / guardado de tarjeta del monedero. */
export const AI_TOPUP_KIND = "ai-topup";
export const AI_SETUP_KIND = "ai-setup";

/**
 * Asegura un Stripe Customer para la clínica (lo crea y persiste si falta).
 * Reusa el mismo Clinic.stripeCustomerId que la suscripción.
 */
export async function ensureClinicStripeCustomer(clinicId: string): Promise<string> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, name: true, email: true, stripeCustomerId: true },
  });
  if (!clinic) throw new Error("Clínica no encontrada");
  if (clinic.stripeCustomerId) return clinic.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: clinic.email ?? undefined,
    name: clinic.name,
    metadata: { clinicId: clinic.id, source: "mediflow" },
  });
  await prisma.clinic.update({
    where: { id: clinic.id },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

/**
 * ACREDITA una recarga pagada al monedero, IDEMPOTENTE por paymentIntentId.
 * Bloquea la fila del monedero (FOR UPDATE) para serializar el camino inline
 * (chargeOffSession) y el del webhook: si ambos llegan con el mismo PaymentIntent,
 * solo uno acredita. Replica el $transaction de wallet.ts (sin importarlo):
 * balance += amount + AiWalletTransaction(TOPUP, STRIPE) + AiTopup(PAID).
 */
export async function creditWalletFromStripe(params: {
  clinicId: string;
  amountCents: number;
  paymentIntentId: string;
}): Promise<{ credited: boolean; balanceAfterCents?: number }> {
  const amount = Math.floor(params.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) return { credited: false };

  // El update atómico exige que el monedero exista.
  await prisma.aiWallet.upsert({
    where: { clinicId: params.clinicId },
    create: { clinicId: params.clinicId },
    update: {},
  });

  return prisma.$transaction(async (tx) => {
    // Serializa por clínica: dos acreditaciones del mismo pago no corren a la vez.
    await tx.$queryRaw`SELECT id FROM ai_wallets WHERE "clinicId" = ${params.clinicId} FOR UPDATE`;

    const already = await tx.aiTopup.findFirst({
      where: { gatewayRef: params.paymentIntentId, status: "PAID" },
      select: { id: true },
    });
    if (already) return { credited: false };

    const wallet = await tx.aiWallet.update({
      where: { clinicId: params.clinicId },
      data: { balanceCents: { increment: amount } },
    });

    await tx.aiWalletTransaction.create({
      data: {
        clinicId: params.clinicId,
        type: "TOPUP",
        amountCents: amount,
        balanceAfterCents: wallet.balanceCents,
        source: "STRIPE",
        reference: params.paymentIntentId,
      },
    });

    // Transiciona un AiTopup previo (PENDING/FAILED) con este ref, o crea uno PAID.
    const prior = await tx.aiTopup.findFirst({
      where: { gatewayRef: params.paymentIntentId },
      select: { id: true },
    });
    if (prior) {
      await tx.aiTopup.update({
        where: { id: prior.id },
        data: { status: "PAID", method: "STRIPE", amountCents: amount, paidAt: new Date() },
      });
    } else {
      await tx.aiTopup.create({
        data: {
          clinicId: params.clinicId,
          amountCents: amount,
          method: "STRIPE",
          status: "PAID",
          gatewayRef: params.paymentIntentId,
          paidAt: new Date(),
        },
      });
    }

    return { credited: true, balanceAfterCents: wallet.balanceCents };
  });
}

/**
 * Registra un intento de recarga FALLIDO (marca para avisar a la clínica).
 * Idempotente por gatewayRef; best-effort (nunca lanza). NO acredita.
 */
export async function recordFailedTopup(
  clinicId: string,
  amountCents: number,
  gatewayRef: string | null,
): Promise<void> {
  try {
    if (gatewayRef) {
      const existing = await prisma.aiTopup.findFirst({ where: { gatewayRef }, select: { id: true } });
      if (existing) return;
    }
    await prisma.aiTopup.create({
      data: {
        clinicId,
        amountCents: Math.max(0, Math.floor(amountCents)),
        method: "STRIPE",
        status: "FAILED",
        gatewayRef: gatewayRef ?? undefined,
      },
    });
  } catch {
    // best-effort
  }
}

/** Crea un SetupIntent para guardar una tarjeta off-session. Devuelve clientSecret. */
export async function createWalletSetupIntent(
  clinicId: string,
): Promise<{ clientSecret: string; customerId: string }> {
  const stripe = getStripe();
  const customerId = await ensureClinicStripeCustomer(clinicId);
  const si = await stripe.setupIntents.create({
    customer: customerId,
    usage: "off_session",
    payment_method_types: ["card"],
    metadata: { kind: AI_SETUP_KIND, clinicId },
  });
  if (!si.client_secret) throw new Error("Stripe no devolvió client_secret");
  return { clientSecret: si.client_secret, customerId };
}

/**
 * Tras confirmar el SetupIntent en el cliente, persiste el PaymentMethod en
 * AiWallet.stripePaymentMethodId y lo deja como default del customer (cobro
 * off-session fiable). Verifica que el SetupIntent sea de esta clínica. Idempotente.
 */
export async function saveCardFromSetupIntent(
  clinicId: string,
  setupIntentId: string,
): Promise<{ ok: boolean; brand?: string; last4?: string; error?: string }> {
  const stripe = getStripe();
  const si = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });

  // Seguridad multi-tenant: el SetupIntent debe pertenecer a esta clínica.
  if (si.metadata?.clinicId && si.metadata.clinicId !== clinicId) {
    return { ok: false, error: "SetupIntent de otra clínica" };
  }
  if (si.status !== "succeeded") {
    return { ok: false, error: `Tarjeta no confirmada (${si.status})` };
  }

  const pm = si.payment_method as Stripe.PaymentMethod | string | null;
  const pmId = typeof pm === "string" ? pm : pm?.id;
  if (!pmId) return { ok: false, error: "Sin método de pago" };

  const customerId =
    (typeof si.customer === "string" ? si.customer : si.customer?.id) ??
    (await ensureClinicStripeCustomer(clinicId));

  try {
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: pmId },
    });
  } catch {
    // best-effort: si ya estaba como default, seguimos.
  }

  await prisma.aiWallet.upsert({
    where: { clinicId },
    create: { clinicId, stripePaymentMethodId: pmId },
    update: { stripePaymentMethodId: pmId },
  });

  const card = pm && typeof pm === "object" ? pm.card : undefined;
  return { ok: true, brand: card?.brand, last4: card?.last4 };
}

/** Guarda la tarjeta en el monedero SOLO si aún no hay una (no pisa la elección de la clínica). */
export async function setWalletCardIfEmpty(clinicId: string, paymentMethodId: string): Promise<void> {
  try {
    const wallet = await prisma.aiWallet.upsert({
      where: { clinicId },
      create: { clinicId },
      update: {},
      select: { stripePaymentMethodId: true },
    });
    if (wallet.stripePaymentMethodId) return;
    await prisma.aiWallet.update({
      where: { clinicId },
      data: { stripePaymentMethodId: paymentMethodId },
    });
  } catch {
    // best-effort
  }
}

/** Crea una Checkout Session (hosted, MXN) para una recarga on-session. */
export async function createTopupCheckout(params: {
  clinicId: string;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string }> {
  const stripe = getStripe();
  const amount = Math.floor(params.amountCents);
  const customerId = await ensureClinicStripeCustomer(params.clinicId);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "mxn",
          unit_amount: amount, // ya en centavos MXN (unidad mínima de Stripe)
          product_data: { name: "Recarga de saldo IA — DaleControl" },
        },
        quantity: 1,
      },
    ],
    // Guarda la tarjeta usada para futuras auto-recargas off-session.
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata: { kind: AI_TOPUP_KIND, clinicId: params.clinicId, amountCents: String(amount) },
    },
    metadata: { kind: AI_TOPUP_KIND, clinicId: params.clinicId, amountCents: String(amount) },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });

  if (!session.url) throw new Error("Stripe no devolvió URL de checkout");
  return { url: session.url };
}

/**
 * Cobro automático off-session sobre la tarjeta guardada. Crea un PaymentIntent
 * off_session + confirm; si queda `succeeded`, ACREDITA (idempotente por pi.id).
 * Si requiere acción (3DS/SCA) o la tarjeta falla, devuelve { ok:false } y deja
 * una marca (AiTopup FAILED) para avisar a la clínica — NO acredita.
 *
 * IMPLEMENTA: T3 (rellena el stub de la fundación).
 */
export async function chargeOffSession(
  clinicId: string,
  amountCents: number,
): Promise<RechargeResult> {
  const amount = Math.floor(amountCents);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Monto inválido" };

  const stripe = getStripeSafe();
  if (!stripe) return { ok: false, error: "Stripe no configurado" };

  const wallet = await prisma.aiWallet.findUnique({
    where: { clinicId },
    select: { stripePaymentMethodId: true, status: true },
  });
  if (!wallet?.stripePaymentMethodId) return { ok: false, error: "Sin tarjeta guardada" };
  if (wallet.status !== "ACTIVE") return { ok: false, error: "Monedero pausado" };

  let customerId: string;
  try {
    customerId = await ensureClinicStripeCustomer(clinicId);
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Sin customer de Stripe" };
  }

  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.create(
      {
        amount,
        currency: "mxn",
        customer: customerId,
        payment_method: wallet.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: { kind: AI_TOPUP_KIND, clinicId, amountCents: String(amount), trigger: "auto" },
      },
      // Anti doble cobro (capa Stripe): disparos concurrentes de la misma clínica
      // dentro de una ventana de 5 min colapsan en UN solo PaymentIntent (mismo
      // pi.id), y la acreditación ya es idempotente por pi.id.
      { idempotencyKey: `autorecharge:${clinicId}:${Math.floor(Date.now() / 300000)}` },
    );
  } catch (err: any) {
    const code = err?.code ?? err?.raw?.code;
    // Otro disparo concurrente ya está creando este mismo intent (misma key en
    // vuelo): no es fallo de tarjeta, NO dejar marca FAILED — el otro acredita.
    if (code === "idempotency_key_in_use") {
      return { ok: false, error: "Auto-recarga ya en curso" };
    }
    // Tarjeta rechazada o que requiere autenticación (SCA): no se puede off-session.
    const failedPi: Stripe.PaymentIntent | undefined = err?.raw?.payment_intent ?? err?.payment_intent;
    await recordFailedTopup(clinicId, amount, failedPi?.id ?? null);
    return { ok: false, error: code ?? err?.message ?? "Cobro rechazado" };
  }

  if (pi.status === "succeeded") {
    await creditWalletFromStripe({ clinicId, amountCents: pi.amount_received || amount, paymentIntentId: pi.id });
    return { ok: true };
  }

  // requires_action / requires_payment_method / processing → no acreditar.
  await recordFailedTopup(clinicId, amount, pi.id);
  return { ok: false, error: `requires_action:${pi.status}` };
}

/**
 * Decide si corresponde una auto-recarga y la dispara (vía chargeOffSession).
 * Se invoca tras un cobro o cuando el saldo cae bajo el umbral. Seguro de llamar
 * varias veces: no hace nada si falta config (auto-recarga off, sin tarjeta,
 * monedero pausado o monto 0) ni si hay una recarga Stripe reciente (cooldown
 * de AUTO_RECHARGE_COOLDOWN_MS, anti doble-cobro con disparos concurrentes).
 * chargeOffSession (T3) acredita si el cobro pasa.
 */
export async function triggerAutoRechargeIfNeeded(clinicId: string): Promise<void> {
  try {
    const wallet = await prisma.aiWallet.findUnique({ where: { clinicId } });
    if (!wallet) return;
    if (wallet.status !== "ACTIVE") return;
    if (!wallet.autoRecharge || !wallet.stripePaymentMethodId) return;
    if (wallet.balanceCents >= wallet.autoRechargeThresholdCents) return;

    const amount = wallet.autoRechargeAmountCents > 0 ? wallet.autoRechargeAmountCents : 0;
    if (amount <= 0) return;

    // Cooldown (capa BD): dos mensajes concurrentes del bot disparan esto dos
    // veces; si ya hay una recarga Stripe PENDING/PAID en la ventana, no cobres.
    const recentTopup = await prisma.aiTopup.findFirst({
      where: {
        clinicId,
        method: "STRIPE",
        status: { in: ["PENDING", "PAID"] },
        createdAt: { gte: new Date(Date.now() - AUTO_RECHARGE_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recentTopup) return;

    await chargeOffSession(clinicId, amount);
  } catch {
    // Best-effort: la auto-recarga jamás debe romper el cobro que la disparó.
  }
}
