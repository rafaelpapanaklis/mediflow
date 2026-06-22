import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminAuthed } from "@/lib/admin-auth";
import { getPricingConfig } from "@/lib/ai-billing/pricing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Tesorería de IA (solo DaleControl). Aquí SÍ se ve USD, costo real y margen.
// Unidades del contrato T1 (no confundir):
//   AiUsageEvent.costUsdMicros  = USD * 1e6   (micro-USD, costo real Anthropic)
//   AiUsageEvent.billedCents    = MXN cents   (cobrado a la clínica, fx + fee incluidos)
//   AnthropicRecharge.amountUsdCents = USD cents (saldo que carga Rafael)
//   AiWallet.balanceCents       = MXN cents

const LOW_BALANCE_CENTS = 5000; // saldo bajo de una clínica: < $50 MXN
const BURN_WINDOW_DAYS = 30; // ventana para la quema diaria promedio (runway)
const MAX_ROWS = 500; // tope defensivo de monederos en la tabla (multi-tenant global)

type FxRow = { fxRate: number; _sum: { costUsdMicros: number | null; billedCents: number | null } };

const sumMicros = (rows: FxRow[]) => rows.reduce((a, r) => a + (r._sum.costUsdMicros ?? 0), 0);
const sumBilled = (rows: FxRow[]) => rows.reduce((a, r) => a + (r._sum.billedCents ?? 0), 0);
// Costo real en MXN EXACTO: cada grupo se convierte a su fxRate histórico
// (el mismo fx con el que se facturó), así el margen no depende del fx de hoy.
const realCostMxn = (rows: FxRow[]) =>
  rows.reduce((a, r) => a + ((r._sum.costUsdMicros ?? 0) / 1_000_000) * r.fxRate, 0);

export async function GET(_req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const burnSince = new Date(now.getTime() - BURN_WINDOW_DAYS * 86_400_000);

    // --- Batch 1: agregados globales (<7 en Promise.all) ---
    const [pricing, rechargeAgg, allTimeByFx, monthByFx, burnAgg] = await Promise.all([
      getPricingConfig(),
      prisma.anthropicRecharge.aggregate({ _sum: { amountUsdCents: true } }),
      prisma.aiUsageEvent.groupBy({ by: ["fxRate"], _sum: { costUsdMicros: true, billedCents: true } }),
      prisma.aiUsageEvent.groupBy({
        by: ["fxRate"],
        where: { createdAt: { gte: monthStart } },
        _sum: { costUsdMicros: true, billedCents: true },
      }),
      prisma.aiUsageEvent.aggregate({ _sum: { costUsdMicros: true }, where: { createdAt: { gte: burnSince } } }),
    ]);

    // --- Batch 2: por-clínica ---
    const [usageByClinic, wallets] = await Promise.all([
      prisma.aiUsageEvent.groupBy({
        by: ["clinicId"],
        _sum: { costUsdMicros: true, billedCents: true },
        _count: true,
      }),
      prisma.aiWallet.findMany({ orderBy: { balanceCents: "asc" }, take: MAX_ROWS }),
    ]);

    // Nombres de clínica (los modelos ai-billing no tienen relación Prisma a Clinic).
    const clinicIds = Array.from(
      new Set([...usageByClinic.map((u) => u.clinicId), ...wallets.map((w) => w.clinicId)]),
    );
    const clinicRows = clinicIds.length
      ? await prisma.clinic.findMany({ where: { id: { in: clinicIds } }, select: { id: true, name: true, slug: true } })
      : [];
    const clinicById = new Map(clinicRows.map((c) => [c.id, c]));

    // ---- Saldo Anthropic (USD) ----
    const rechargedUsd = (rechargeAgg._sum.amountUsdCents ?? 0) / 100;
    const consumedUsd = sumMicros(allTimeByFx) / 1_000_000;
    const balanceUsd = rechargedUsd - consumedUsd;

    // ---- Runway (días) ----
    const burn30dUsd = (burnAgg._sum.costUsdMicros ?? 0) / 1_000_000;
    const avgDailyBurnUsd = burn30dUsd / BURN_WINDOW_DAYS;
    const runwayDays = avgDailyBurnUsd > 0 ? balanceUsd / avgDailyBurnUsd : null;

    // ---- Margen (MXN), exacto con fx histórico ----
    const incomeMxnAll = sumBilled(allTimeByFx) / 100;
    const realCostMxnAll = realCostMxn(allTimeByFx);
    const marginMxnAll = incomeMxnAll - realCostMxnAll;
    const marginPctAll = incomeMxnAll > 0 ? (marginMxnAll / incomeMxnAll) * 100 : null;

    const incomeMxnMonth = sumBilled(monthByFx) / 100;
    const realCostMxnMonth = realCostMxn(monthByFx);
    const marginMxnMonth = incomeMxnMonth - realCostMxnMonth;
    const marginPctMonth = incomeMxnMonth > 0 ? (marginMxnMonth / incomeMxnMonth) * 100 : null;

    // ---- Por-clínica ----
    const totalBilled = sumBilled(allTimeByFx);
    const usageMap = new Map(usageByClinic.map((u) => [u.clinicId, u]));
    const walletMap = new Map(wallets.map((w) => [w.clinicId, w]));

    const clinics = clinicIds
      .map((id) => {
        const u = usageMap.get(id);
        const w = walletMap.get(id);
        const billed = u?._sum.billedCents ?? 0;
        const balanceCents = w?.balanceCents ?? 0;
        return {
          clinicId: id,
          name: clinicById.get(id)?.name ?? "(desconocida)",
          slug: clinicById.get(id)?.slug ?? null,
          balanceCents,
          hasWallet: !!w,
          status: w?.status ?? null,
          autoRecharge: w?.autoRecharge ?? false,
          consumoMxn: billed / 100,
          realCostUsd: (u?._sum.costUsdMicros ?? 0) / 1_000_000,
          eventCount: u?._count ?? 0,
          sharePct: totalBilled > 0 ? (billed / totalBilled) * 100 : 0,
          lowBalance: balanceCents < LOW_BALANCE_CENTS,
        };
      })
      // Saldo más bajo primero (más urgente), luego mayor consumo.
      .sort((a, b) => a.balanceCents - b.balanceCents || b.consumoMxn - a.consumoMxn);

    return NextResponse.json({
      pricing: {
        inputUsdPerMtok: pricing.inputUsdPerMtok,
        outputUsdPerMtok: pricing.outputUsdPerMtok,
        cacheWriteUsdPerMtok: pricing.cacheWriteUsdPerMtok,
        cacheReadUsdPerMtok: pricing.cacheReadUsdPerMtok,
        usdToMxnRate: pricing.usdToMxnRate,
        feePct: pricing.feePct,
      },
      anthropic: {
        rechargedUsd,
        consumedUsd,
        balanceUsd,
        runwayDays,
        avgDailyBurnUsd,
        burnWindowDays: BURN_WINDOW_DAYS,
      },
      margin: {
        allTime: { incomeMxn: incomeMxnAll, realCostMxn: realCostMxnAll, marginMxn: marginMxnAll, marginPct: marginPctAll },
        month: { incomeMxn: incomeMxnMonth, realCostMxn: realCostMxnMonth, marginMxn: marginMxnMonth, marginPct: marginPctMonth },
      },
      totals: {
        clinicCount: clinicIds.length,
        walletCount: wallets.length,
        lowBalanceCount: clinics.filter((c) => c.hasWallet && c.lowBalance).length,
        negativeCount: clinics.filter((c) => c.balanceCents < 0).length,
        pausedCount: clinics.filter((c) => c.status === "PAUSED").length,
        capped: wallets.length >= MAX_ROWS,
      },
      clinics,
      generatedAt: now.toISOString(),
    });
  } catch (err: any) {
    console.error("[admin/ai-billing GET]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Error" }, { status: 500 });
  }
}
