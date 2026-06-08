import "server-only";
import { prisma } from "@/lib/prisma";
import type { RechargeResult } from "./types";

/**
 * Recargas del monedero de IA. En la FUNDACIÓN (T1) el cobro real es un STUB:
 * T3 implementa Stripe off-session aquí. T4/T5 añaden MercadoPago/SPEI por sus
 * propios flujos (no off-session).
 *
 * No importa wallet.ts (evita ciclo): lee el monedero vía prisma directamente.
 */

/**
 * STUB de cobro automático off-session (tarjeta guardada). Lo rellena T3 con
 * Stripe: crear un PaymentIntent off_session=true sobre `stripePaymentMethodId`,
 * y si queda `succeeded`, acreditar el monedero (AiWalletTransaction TOPUP +
 * balance += amountCents) y registrar AiTopup(status=PAID, method=STRIPE).
 *
 * IMPLEMENTA: T3.
 */
export async function chargeOffSession(
  clinicId: string,
  amountCents: number,
): Promise<RechargeResult> {
  return { ok: false, error: "IMPLEMENTA: T3" };
}

/**
 * Decide si corresponde una auto-recarga y la dispara (vía chargeOffSession).
 * Se invoca tras un cobro o cuando el saldo cae bajo el umbral. Seguro de
 * llamar varias veces: no hace nada si falta config (auto-recarga off, sin
 * tarjeta, monedero pausado o monto 0). En la fundación NUNCA acredita (el stub
 * devuelve ok:false); solo deja el gancho listo para T3.
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
    // T3: si chargeOffSession.ok ⇒ acreditar saldo + crear AiTopup. Aquí es no-op.
  } catch {
    // Best-effort: la auto-recarga jamás debe romper el cobro que la disparó.
  }
}
