import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { getOrCreateWallet } from "@/lib/ai-billing/wallet";
import { filtroRecargas, filtroSpeiEnRevision, juntarRecargas } from "./recargas";

export const dynamic = "force-dynamic";

/**
 * Monedero de IA (vista de la clínica). Devuelve saldo, config de auto-recarga,
 * los últimos consumos (`usage`) y las últimas recargas (`recargas`: solo el
 * dinero que ENTRA, ver ./recargas.ts). La clínica SOLO ve MXN (centavos):
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

    const [usageEvents, asientos, speiEnRevision] = await Promise.all([
      // SOLO consumo que salió del monedero (billedCents > 0). Desde que la IA
      // clínica también registra AiUsageEvent — con billedCents 0, porque el
      // plan la incluye — un findMany sin filtro llenaría este historial de
      // renglones de $0.00 que la clínica nunca pagó y empujaría fuera de los
      // 20 los consumos reales del bot.
      prisma.aiUsageEvent.findMany({
        where: { clinicId: ctx.clinicId, billedCents: { gt: 0 } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      // SOLO recargas (TOPUP, REFUND, ADJUSTMENT > 0). Los CHARGE ya se ven en
      // «Consumo de IA»; listarlos aquí también repetía el gasto y, con 20
      // renglones, veinte respuestas del bot escondían la única recarga.
      prisma.aiWalletTransaction.findMany({
        where: filtroRecargas(ctx.clinicId),
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      // SPEI con comprobante subido y todavía sin confirmar: la clínica ya
      // transfirió y quiere ver que lo sabemos.
      prisma.aiTopup.findMany({
        where: filtroSpeiEnRevision(ctx.clinicId),
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, amountCents: true, createdAt: true },
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
      recargas: juntarRecargas(asientos, speiEnRevision).map((r) => ({
        id: r.id,
        tipo: r.tipo,
        via: r.via,
        amountCents: r.amountCents,
        balanceAfterCents: r.balanceAfterCents,
        note: r.note,
        createdAt: r.createdAt,
        enRevision: r.enRevision,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Error al cargar el saldo" }, { status: 500 });
  }
}
