import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { getOrCreateWallet } from "@/lib/ai-billing/wallet";

export const dynamic = "force-dynamic";

/**
 * Monedero de IA (vista de la clínica). Devuelve saldo, config de auto-recarga
 * y los últimos movimientos/consumos. La clínica SOLO ve MXN (centavos):
 * nunca exponemos costUsdMicros, fxRate ni feePct. clinicId SIEMPRE de la
 * sesión, jamás del body.
 */
export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Asegura que exista el monedero (alta perezosa, saldo 0).
    const wallet = await getOrCreateWallet(ctx.clinicId);

    const [usageEvents, txns] = await Promise.all([
      prisma.aiUsageEvent.findMany({
        where: { clinicId: ctx.clinicId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.aiWalletTransaction.findMany({
        where: { clinicId: ctx.clinicId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    return NextResponse.json({
      balanceCents: wallet.balanceCents,
      status: wallet.status,
      autoRecharge: wallet.autoRecharge,
      autoRechargeThresholdCents: wallet.autoRechargeThresholdCents,
      autoRechargeAmountCents: wallet.autoRechargeAmountCents,
      hasPaymentMethod: !!wallet.stripePaymentMethodId,
      isAdmin: ctx.isAdmin,
      usage: usageEvents.map((e) => ({
        id: e.id,
        feature: e.feature,
        model: e.model,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        billedCents: e.billedCents,
        createdAt: e.createdAt,
      })),
      transactions: txns.map((t) => ({
        id: t.id,
        type: t.type,
        amountCents: t.amountCents,
        balanceAfterCents: t.balanceAfterCents,
        source: t.source,
        note: t.note,
        createdAt: t.createdAt,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Error al cargar el saldo" }, { status: 500 });
  }
}
