import "server-only";
import { prisma } from "@/lib/prisma";
import type { AiWallet } from "@prisma/client";
import { computeCostUsdMicros, getPricingConfig, usdMicrosToBilledCents } from "./pricing";
import { triggerAutoRechargeIfNeeded } from "./recharge";
import { GRACE_OVERDRAFT_CENTS, type ChargeUsageInput, type ChargeUsageResult } from "./types";

/**
 * Monedero de IA por clínica: alta perezosa, control de gasto y cobro ATÓMICO
 * del consumo del bot. Multi-tenant: SIEMPRE por clinicId. Dinero en centavos
 * MXN (Int). billedCents ya incluye fx + fee (la clínica nunca ve USD ni %).
 */

/** Devuelve el monedero de la clínica; lo crea (saldo 0) si no existe. */
export async function getOrCreateWallet(clinicId: string): Promise<AiWallet> {
  return prisma.aiWallet.upsert({
    where: { clinicId },
    create: { clinicId },
    update: {},
  });
}

/**
 * ¿La clínica puede gastar IA ahora? true si hay saldo (>0). Si está en 0 o
 * negativo PERO tiene auto-recarga + tarjeta, se permite un sobregiro de gracia
 * (hasta -GRACE_OVERDRAFT_CENTS) y se dispara la recarga. Si no, false (el motor
 * del bot cae a handoff; la FAQ por reglas sigue siendo gratis).
 */
export async function canSpend(clinicId: string): Promise<boolean> {
  const wallet = await getOrCreateWallet(clinicId);
  if (wallet.status !== "ACTIVE") return false;
  if (wallet.balanceCents > 0) return true;

  const canOverdraw =
    wallet.autoRecharge &&
    !!wallet.stripePaymentMethodId &&
    wallet.balanceCents > -GRACE_OVERDRAFT_CENTS;
  if (canOverdraw) {
    // Marca para recargar (best-effort; en la fundación es no-op por el stub).
    void triggerAutoRechargeIfNeeded(clinicId);
    return true;
  }
  return false;
}

/**
 * Cobra una llamada facturable: calcula costo (USD) → centavos MXN (fee oculto)
 * y, en UNA transacción, descuenta el saldo (decremento ATÓMICO, sin carrera de
 * sobregiro) y registra AiUsageEvent + AiWalletTransaction(CHARGE). Tras cobrar,
 * dispara la auto-recarga si el saldo quedó bajo el umbral. NO llamar con tokens
 * en 0 ni con llamadas mock/error (de eso se encarga meter.ts). Devuelve null si
 * no había nada que cobrar.
 */
export async function chargeUsage(input: ChargeUsageInput): Promise<ChargeUsageResult | null> {
  const inputTokens = Math.max(0, Math.floor(input.inputTokens || 0));
  const outputTokens = Math.max(0, Math.floor(input.outputTokens || 0));
  const cacheTokens = Math.max(0, Math.floor(input.cacheTokens || 0));
  if (inputTokens === 0 && outputTokens === 0 && cacheTokens === 0) return null;

  const cfg = await getPricingConfig();
  const costUsdMicros = computeCostUsdMicros(input.model, inputTokens, outputTokens, cacheTokens, cfg);
  const billedCents = usdMicrosToBilledCents(costUsdMicros, cfg);

  // Asegura el monedero ANTES de la TX (el update atómico exige que exista).
  await getOrCreateWallet(input.clinicId);

  const result = await prisma.$transaction(async (tx) => {
    // Decremento atómico: lee-y-escribe en una sola operación, así el
    // balanceAfter es consistente aunque haya cobros concurrentes.
    const updated = await tx.aiWallet.update({
      where: { clinicId: input.clinicId },
      data: { balanceCents: { decrement: billedCents } },
    });

    const event = await tx.aiUsageEvent.create({
      data: {
        clinicId: input.clinicId,
        feature: input.feature,
        model: input.model,
        inputTokens,
        outputTokens,
        cacheTokens,
        costUsdMicros,
        fxRate: cfg.usdToMxnRate,
        feePct: cfg.feePct,
        billedCents,
        threadId: input.threadId ?? null,
      },
    });

    await tx.aiWalletTransaction.create({
      data: {
        clinicId: input.clinicId,
        type: "CHARGE",
        amountCents: -billedCents,
        balanceAfterCents: updated.balanceCents,
        source: "USAGE",
        reference: event.id,
      },
    });

    return {
      billedCents,
      balanceAfterCents: updated.balanceCents,
      eventId: event.id,
      autoRecharge: updated.autoRecharge,
      thresholdCents: updated.autoRechargeThresholdCents,
    };
  });

  // Auto-recarga si quedó bajo el umbral (best-effort, fuera de la TX).
  if (result.autoRecharge && result.balanceAfterCents < result.thresholdCents) {
    void triggerAutoRechargeIfNeeded(input.clinicId);
  }

  return {
    billedCents: result.billedCents,
    balanceAfterCents: result.balanceAfterCents,
    eventId: result.eventId,
  };
}
