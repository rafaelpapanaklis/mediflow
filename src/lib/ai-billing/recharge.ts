import "server-only";
import { prisma } from "@/lib/prisma";
import getStripe, { getStripeSafe } from "@/lib/stripe";
import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
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

/**
 * Tras un cobro automático FALLIDO (tarjeta rechazada, caducada, 3DS exigido)
 * no se vuelve a intentar solo durante esta ventana. Sin ella, cada mensaje del
 * bot y cada corrida del cron volvían a golpear la tarjeta muerta (antes: un
 * intento cada 5 min mientras hubiera tráfico), dejando una fila FAILED por
 * intento. Una recarga PAID posterior (manual o automática) rearma el intento.
 */
export const AUTO_RECHARGE_FAILED_BACKOFF_MS = 24 * 60 * 60 * 1000;

/** metadata.kind que marca un pago de Stripe como recarga / guardado de tarjeta del monedero. */
export const AI_TOPUP_KIND = "ai-topup";
export const AI_SETUP_KIND = "ai-setup";

/** Lo que hace falta para acreditar una recarga que llegó por Checkout Session. */
export interface TopupFromSession {
  clinicId: string;
  amountCents: number;
  paymentIntentId: string;
}

/**
 * Lee de una Checkout Session de recarga (metadata.kind = ai-topup) lo necesario
 * para acreditarla. Devuelve null si no es una recarga, si la clínica falta, si
 * el pago NO está hecho (`payment_status !== "paid"`: en `completed` un pago
 * puede seguir pendiente) o si no trae PaymentIntent.
 *
 * 🔴 El candado de `creditWalletFromStripe` es el id del PaymentIntent. Por eso
 * el ref que sale de aquí es `session.payment_intent` y NUNCA `session.id`: el
 * mismo pago llega por `checkout.session.completed` y por
 * `payment_intent.succeeded`, y con el id de la sesión se abonaría dos veces.
 */
export function topupFromCheckoutSession(
  session: Pick<Stripe.Checkout.Session, "metadata" | "payment_status" | "payment_intent" | "amount_total">,
): TopupFromSession | null {
  if (session.metadata?.kind !== AI_TOPUP_KIND) return null;
  const clinicId = session.metadata?.clinicId;
  if (!clinicId) return null;
  if (session.payment_status !== "paid") return null;
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  if (!paymentIntentId) return null;
  const amountCents = session.amount_total || Number(session.metadata?.amountCents) || 0;
  if (!Number.isFinite(amountCents) || amountCents <= 0) return null;
  return { clinicId, amountCents, paymentIntentId };
}

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
 *
 * `topupId` (opcional): la fila PENDING que reservó `chargeOffSession` antes de
 * cobrar. Viaja en `metadata.topupId` del PaymentIntent, así el camino inline y
 * el webhook transicionan LA MISMA fila a PAID en vez de crear otra.
 */
export async function creditWalletFromStripe(params: {
  clinicId: string;
  amountCents: number;
  paymentIntentId: string;
  topupId?: string | null;
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

    // Transiciona un AiTopup previo (PENDING/FAILED) con este ref —o la reserva
    // de la auto-recarga, que aún no tiene ref— o crea uno PAID.
    const prior =
      (await tx.aiTopup.findFirst({
        where: { gatewayRef: params.paymentIntentId },
        select: { id: true },
      })) ??
      (params.topupId
        ? await tx.aiTopup.findFirst({
            where: { id: params.topupId, clinicId: params.clinicId },
            select: { id: true },
          })
        : null);
    if (prior) {
      await tx.aiTopup.update({
        where: { id: prior.id },
        data: {
          status: "PAID",
          method: "STRIPE",
          amountCents: amount,
          gatewayRef: params.paymentIntentId,
          paidAt: new Date(),
        },
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
 * Con `topupId`, marca FAILED la reserva PENDING de la auto-recarga en vez de
 * crear otra fila (si ya no está PENDING, cae al camino por gatewayRef).
 */
export async function recordFailedTopup(
  clinicId: string,
  amountCents: number,
  gatewayRef: string | null,
  topupId?: string | null,
): Promise<void> {
  try {
    if (topupId) {
      const marked = await prisma.aiTopup.updateMany({
        where: { id: topupId, clinicId, status: "PENDING" },
        data: { status: "FAILED", gatewayRef: gatewayRef ?? undefined },
      });
      if (marked.count > 0) return;
    }
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

/**
 * Guardado de tarjeta cuando la recarga se acredita por la Checkout Session (el
 * objeto de la sesión no trae el PaymentMethod): lee el PaymentIntent y, si
 * guardó tarjeta (setup_future_usage), la deja en el monedero si no tenía.
 * Solo LECTURA en Stripe; best-effort, nunca lanza.
 */
export async function saveCardFromTopupIntent(clinicId: string, paymentIntentId: string): Promise<void> {
  try {
    const stripe = getStripeSafe();
    if (!stripe) return;
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    // Multi-tenant: el PaymentIntent debe ser de esta clínica.
    if (pi.metadata?.clinicId && pi.metadata.clinicId !== clinicId) return;
    if (!pi.setup_future_usage) return;
    const pmId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
    if (pmId) await setWalletCardIfEmpty(clinicId, pmId);
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
 * ¿El último cobro Stripe de la clínica falló hace menos de
 * AUTO_RECHARGE_FAILED_BACKOFF_MS? Lo comparten la reserva de la auto-recarga
 * (para no reintentar) y el cron (para que el aviso a la clínica diga que fue
 * la tarjeta, no solo que el saldo está bajo). Una recarga PAID posterior lo
 * apaga porque ya no es la última.
 */
export async function lastAutoRechargeFailedRecently(
  db: Prisma.TransactionClient,
  clinicId: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const latest = await db.aiTopup.findFirst({
    where: { clinicId, method: "STRIPE" },
    orderBy: { createdAt: "desc" },
    select: { status: true, createdAt: true },
  });
  return (
    latest?.status === "FAILED" && latest.createdAt.getTime() >= nowMs - AUTO_RECHARGE_FAILED_BACKOFF_MS
  );
}

/**
 * RESERVA una auto-recarga: en una transacción con el monedero bloqueado
 * (FOR UPDATE, el mismo candado que la acreditación) comprueba el cooldown y el
 * backoff y, si procede, deja una fila AiTopup PENDING. Es lo que impide el
 * doble cobro: dos disparos concurrentes (dos mensajes del bot, o el bot y el
 * cron) se serializan aquí, y el segundo ve la reserva del primero. Antes el
 * cooldown solo veía filas PAID —que se escriben DESPUÉS de que Stripe
 * responde— y la llave de idempotencia iba por ventanas de 5 min: dos disparos
 * a caballo entre dos ventanas cobraban dos veces.
 */
async function claimAutoRecharge(
  clinicId: string,
  amountCents: number,
): Promise<{ topupId: string | null; reason?: "cooldown" | "backoff" }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM ai_wallets WHERE "clinicId" = ${clinicId} FOR UPDATE`;
    const nowMs = Date.now();

    const recent = await tx.aiTopup.findFirst({
      where: {
        clinicId,
        method: "STRIPE",
        status: { in: ["PENDING", "PAID"] },
        createdAt: { gte: new Date(nowMs - AUTO_RECHARGE_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recent) return { topupId: null, reason: "cooldown" };

    if (await lastAutoRechargeFailedRecently(tx, clinicId, nowMs)) {
      return { topupId: null, reason: "backoff" };
    }

    const claim = await tx.aiTopup.create({
      data: { clinicId, amountCents, method: "STRIPE", status: "PENDING" },
      select: { id: true },
    });
    return { topupId: claim.id };
  });
}

/**
 * Cobro automático off-session sobre la tarjeta guardada. Reserva una fila
 * AiTopup PENDING (ver claimAutoRecharge), crea un PaymentIntent off_session +
 * confirm con esa reserva como llave de idempotencia y en `metadata.topupId`;
 * si queda `succeeded`, ACREDITA (idempotente por pi.id, transicionando la
 * reserva a PAID). Si la tarjeta falla o el banco exige autenticación (3DS/SCA:
 * con off_session Stripe lanza `authentication_required`), la reserva pasa a
 * FAILED con el id del PaymentIntent fallido —NO se acredita— y durante
 * AUTO_RECHARGE_FAILED_BACKOFF_MS no se vuelve a intentar. El aviso a la
 * clínica lo manda el cron de ai-wallet leyendo esa marca.
 *
 * Un error que NO es de cobro (Stripe caído, timeout) deja la reserva PENDING:
 * no sabemos si el PaymentIntent llegó a crearse. Si llegó y se cobró, el
 * webhook payment_intent.succeeded trae `metadata.topupId` y acredita sobre
 * la misma reserva; y el SDK ya reintenta la red con la misma llave.
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

  const claim = await claimAutoRecharge(clinicId, amount);
  if (!claim.topupId) {
    return {
      ok: false,
      error:
        claim.reason === "backoff"
          ? "Último cobro automático fallido: no se reintenta hasta pasadas 24 h"
          : "Auto-recarga ya en curso o reciente",
    };
  }
  const topupId = claim.topupId;

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
        metadata: { kind: AI_TOPUP_KIND, clinicId, amountCents: String(amount), trigger: "auto", topupId },
      },
      // Una llave por reserva: la reserva ya es única por clínica dentro del
      // cooldown, y el SDK reutiliza la misma llave en sus reintentos de red.
      { idempotencyKey: `autorecharge:${topupId}` },
    );
  } catch (err: any) {
    const code: string | undefined = err?.code ?? err?.raw?.code;
    // La misma llave sigue en vuelo (reintento del SDK pisándose): la reserva
    // se queda PENDING y el webhook resolverá.
    if (code === "idempotency_key_in_use") {
      return { ok: false, error: "Auto-recarga ya en curso" };
    }
    // Fallo de COBRO (tarjeta rechazada/caducada, 3DS exigido, PaymentMethod
    // borrado): marca FAILED y arranca el backoff. Un error sin código de
    // Stripe (red, timeout) NO es un fallo de tarjeta: se deja PENDING.
    const isChargeFailure = Boolean(code) || err?.type === "StripeCardError";
    if (!isChargeFailure) {
      return { ok: false, error: err?.message ?? "Stripe no respondió" };
    }
    const failedPi: Stripe.PaymentIntent | undefined = err?.raw?.payment_intent ?? err?.payment_intent;
    await recordFailedTopup(clinicId, amount, failedPi?.id ?? null, topupId);
    return { ok: false, error: code ?? err?.message ?? "Cobro rechazado" };
  }

  if (pi.status === "succeeded") {
    await creditWalletFromStripe({
      clinicId,
      amountCents: pi.amount_received || amount,
      paymentIntentId: pi.id,
      topupId,
    });
    return { ok: true };
  }

  // requires_action / requires_payment_method / processing → no acreditar.
  await recordFailedTopup(clinicId, amount, pi.id, topupId);
  return { ok: false, error: `requires_action:${pi.status}` };
}

/**
 * Decide si corresponde una auto-recarga y la dispara (vía chargeOffSession).
 * Se invoca tras un cobro o cuando el saldo cae bajo el umbral. Seguro de llamar
 * varias veces: no hace nada si falta config (auto-recarga off, sin tarjeta,
 * monedero pausado o monto 0). El anti doble-cobro (cooldown) y el backoff tras
 * un fallo viven en la reserva de chargeOffSession, bajo el candado del
 * monedero: aquí solo se filtra lo barato.
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

    await chargeOffSession(clinicId, amount);
  } catch {
    // Best-effort: la auto-recarga jamás debe romper el cobro que la disparó.
  }
}
