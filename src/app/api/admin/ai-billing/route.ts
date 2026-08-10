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
//   AnthropicRecharge.amountUsdCents = USD cents (USD que carga Rafael)
//   AiWallet.balanceCents       = MXN cents
//
// DOS BLOQUES QUE NO SE MEZCLAN (billedCents es el separador):
//   · PREPAGO   (billedCents > 0) — bot de WhatsApp. Tiene ingreso ⇒ tiene margen.
//   · ABSORBIDO (billedCents = 0) — IA clínica incluida en el plan. Cuesta pero
//     NO factura aquí: su ingreso es la mensualidad de la clínica, que vive en
//     otra tabla. Meterlo en el margen lo pintaría negativo y mentiroso.
// El cheque a Anthropic (consumo, runway, costo total) SÍ suma los dos.

const LOW_BALANCE_CENTS = 5000; // saldo bajo de una clínica: < $50 MXN
const BURN_WINDOW_DAYS = 30; // ventana para la quema diaria promedio (runway)
const MAX_ROWS = 500; // tope defensivo de filas en la tabla (multi-tenant global)

type FxRow = { fxRate: number; _sum: { costUsdMicros: number | null; billedCents: number | null } };

const sumMicros = (rows: FxRow[]) => rows.reduce((a, r) => a + (r._sum.costUsdMicros ?? 0), 0);
const sumBilled = (rows: FxRow[]) => rows.reduce((a, r) => a + (r._sum.billedCents ?? 0), 0);
// Costo real en MXN EXACTO: cada grupo se convierte a su fxRate histórico
// (el mismo fx con el que se facturó), así el margen no depende del fx de hoy.
const realCostMxn = (rows: FxRow[]) =>
  rows.reduce((a, r) => a + ((r._sum.costUsdMicros ?? 0) / 1_000_000) * r.fxRate, 0);

// Filtros del separador. `lte: 0` y no `equals: 0` por defensa: un evento
// absorbido siempre se escribe con 0, pero así ningún valor raro se pierde
// entre los dos bloques (juntos cubren TODOS los eventos, sin solaparse).
const PREPAID_WHERE = { billedCents: { gt: 0 } };
const ABSORBED_WHERE = { billedCents: { lte: 0 } };

export async function GET(_req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const burnSince = new Date(now.getTime() - BURN_WINDOW_DAYS * 86_400_000);

    // --- Batch 1: agregados globales, ya partidos en prepago / absorbido ---
    const [pricing, rechargeAgg, prepaidAllByFx, absorbedAllByFx, prepaidMonthByFx, absorbedMonthByFx] =
      await Promise.all([
        getPricingConfig(),
        prisma.anthropicRecharge.aggregate({ _sum: { amountUsdCents: true } }),
        prisma.aiUsageEvent.groupBy({
          by: ["fxRate"],
          where: PREPAID_WHERE,
          _sum: { costUsdMicros: true, billedCents: true },
        }),
        prisma.aiUsageEvent.groupBy({
          by: ["fxRate"],
          where: ABSORBED_WHERE,
          _sum: { costUsdMicros: true, billedCents: true },
        }),
        prisma.aiUsageEvent.groupBy({
          by: ["fxRate"],
          where: { ...PREPAID_WHERE, createdAt: { gte: monthStart } },
          _sum: { costUsdMicros: true, billedCents: true },
        }),
        prisma.aiUsageEvent.groupBy({
          by: ["fxRate"],
          where: { ...ABSORBED_WHERE, createdAt: { gte: monthStart } },
          _sum: { costUsdMicros: true, billedCents: true },
        }),
      ]);

    // --- Batch 2: por-clínica + quema (la quema suma los DOS bloques: es
    // dinero que sale a Anthropic venga de donde venga) ---
    const [burnAgg, prepaidByClinic, absorbedByClinic, wallets] = await Promise.all([
      prisma.aiUsageEvent.aggregate({ _sum: { costUsdMicros: true }, where: { createdAt: { gte: burnSince } } }),
      prisma.aiUsageEvent.groupBy({
        by: ["clinicId"],
        where: PREPAID_WHERE,
        _sum: { costUsdMicros: true, billedCents: true },
        _count: true,
      }),
      prisma.aiUsageEvent.groupBy({
        by: ["clinicId"],
        where: ABSORBED_WHERE,
        _sum: { costUsdMicros: true, billedCents: true },
        _count: true,
      }),
      prisma.aiWallet.findMany({ orderBy: { balanceCents: "asc" }, take: MAX_ROWS }),
    ]);

    // ---- Saldo Anthropic (USD): TODO el consumo, prepago + absorbido ----
    const rechargedUsd = (rechargeAgg._sum.amountUsdCents ?? 0) / 100;
    const prepaidCostUsdAll = sumMicros(prepaidAllByFx) / 1_000_000;
    const absorbedCostUsdAll = sumMicros(absorbedAllByFx) / 1_000_000;
    const consumedUsd = prepaidCostUsdAll + absorbedCostUsdAll;
    const balanceUsd = rechargedUsd - consumedUsd;

    // ---- Runway (días) ----
    const burn30dUsd = (burnAgg._sum.costUsdMicros ?? 0) / 1_000_000;
    const avgDailyBurnUsd = burn30dUsd / BURN_WINDOW_DAYS;
    const runwayDays = avgDailyBurnUsd > 0 ? balanceUsd / avgDailyBurnUsd : null;

    // ---- Margen (MXN), exacto con fx histórico. SOLO PREPAGO ----
    const incomeMxnAll = sumBilled(prepaidAllByFx) / 100;
    const prepaidCostMxnAll = realCostMxn(prepaidAllByFx);
    const marginMxnAll = incomeMxnAll - prepaidCostMxnAll;
    const marginPctAll = incomeMxnAll > 0 ? (marginMxnAll / incomeMxnAll) * 100 : null;

    const incomeMxnMonth = sumBilled(prepaidMonthByFx) / 100;
    const prepaidCostMxnMonth = realCostMxn(prepaidMonthByFx);
    const marginMxnMonth = incomeMxnMonth - prepaidCostMxnMonth;
    const marginPctMonth = incomeMxnMonth > 0 ? (marginMxnMonth / incomeMxnMonth) * 100 : null;

    // ---- Absorbido (incluido en los planes): cuesta, no factura ----
    const absorbedCostUsdMonth = sumMicros(absorbedMonthByFx) / 1_000_000;
    const absorbedCostMxnMonth = realCostMxn(absorbedMonthByFx);
    const absorbedCostMxnAll = realCostMxn(absorbedAllByFx);
    const prepaidCostUsdMonth = sumMicros(prepaidMonthByFx) / 1_000_000;

    // ---- Por-clínica ----
    const prepaidMap = new Map(prepaidByClinic.map((u) => [u.clinicId, u]));
    const absorbedMap = new Map(absorbedByClinic.map((u) => [u.clinicId, u]));
    const walletMap = new Map(wallets.map((w) => [w.clinicId, w]));
    const allIds = Array.from(
      new Set([
        ...prepaidByClinic.map((u) => u.clinicId),
        ...absorbedByClinic.map((u) => u.clinicId),
        ...wallets.map((w) => w.clinicId),
      ]),
    );

    // Participación sobre el COSTO total (el cheque a Anthropic): con clínicas
    // que solo tienen consumo absorbido, repartir sobre lo facturado les daría
    // 0.0% a todas y la columna no diría nada.
    const totalCostMicros = sumMicros(prepaidAllByFx) + sumMicros(absorbedAllByFx);

    const rows = allIds
      .map((id) => {
        const p = prepaidMap.get(id);
        const ab = absorbedMap.get(id);
        const w = walletMap.get(id);
        const prepaidMicros = p?._sum.costUsdMicros ?? 0;
        const absorbedMicros = ab?._sum.costUsdMicros ?? 0;
        const prepaidEvents = p?._count ?? 0;
        const absorbedEvents = ab?._count ?? 0;
        const billed = p?._sum.billedCents ?? 0;
        return {
          clinicId: id,
          name: "",
          slug: null as string | null,
          // null (no 0) cuando no hay monedero: $0.00 se lee como deuda.
          balanceCents: w ? w.balanceCents : null,
          hasWallet: !!w,
          status: w?.status ?? null,
          autoRecharge: w?.autoRecharge ?? false,
          consumoMxn: billed / 100,
          prepaidCostUsd: prepaidMicros / 1_000_000,
          absorbedCostUsd: absorbedMicros / 1_000_000,
          realCostUsd: (prepaidMicros + absorbedMicros) / 1_000_000,
          eventCount: prepaidEvents + absorbedEvents,
          prepaidEventCount: prepaidEvents,
          absorbedEventCount: absorbedEvents,
          usageKind:
            prepaidEvents > 0 && absorbedEvents > 0
              ? "mixed"
              : prepaidEvents > 0
                ? "prepaid"
                : absorbedEvents > 0
                  ? "included"
                  : "none",
          costSharePct:
            totalCostMicros > 0 ? ((prepaidMicros + absorbedMicros) / totalCostMicros) * 100 : 0,
          // Solo tiene sentido con monedero; sin él no hay saldo que se agote.
          lowBalance: !!w && w.balanceCents < LOW_BALANCE_CENTS,
        };
      })
      // Primero los monederos (ahí está el dinero que se puede agotar): saldo
      // más bajo primero, luego mayor consumo. Después las clínicas sin
      // monedero, por costo absorbido descendente.
      .sort((a, b) => {
        if (a.hasWallet !== b.hasWallet) return a.hasWallet ? -1 : 1;
        if (a.hasWallet) {
          return (a.balanceCents ?? 0) - (b.balanceCents ?? 0) || b.consumoMxn - a.consumoMxn;
        }
        return b.realCostUsd - a.realCostUsd;
      });

    // Recorta ANTES de pedir nombres: el IN de clinic.findMany crecía con cada
    // clínica que hubiera tocado la IA alguna vez.
    const capped = rows.length > MAX_ROWS || wallets.length >= MAX_ROWS;
    const clinics = rows.slice(0, MAX_ROWS);

    // Nombres (los modelos ai-billing no tienen relación Prisma a Clinic).
    const clinicRows = clinics.length
      ? await prisma.clinic.findMany({
          where: { id: { in: clinics.map((c) => c.clinicId) } },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const clinicById = new Map(clinicRows.map((c) => [c.id, c]));
    for (let i = 0; i < clinics.length; i++) {
      const found = clinicById.get(clinics[i].clinicId);
      clinics[i].name = found?.name ?? "(desconocida)";
      clinics[i].slug = found?.slug ?? null;
    }

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
      // OJO: solo prepago. El consumo incluido en los planes NO entra aquí.
      margin: {
        allTime: {
          incomeMxn: incomeMxnAll,
          realCostMxn: prepaidCostMxnAll,
          marginMxn: marginMxnAll,
          marginPct: marginPctAll,
        },
        month: {
          incomeMxn: incomeMxnMonth,
          realCostMxn: prepaidCostMxnMonth,
          marginMxn: marginMxnMonth,
          marginPct: marginPctMonth,
        },
      },
      // Costo que DaleControl absorbe: la clínica no paga extra, sale de su
      // mensualidad. Sin ingreso asociado ⇒ jamás entra en el margen.
      absorbed: {
        allTime: { costUsd: absorbedCostUsdAll, costMxn: absorbedCostMxnAll },
        month: {
          costUsd: absorbedCostUsdMonth,
          costMxn: absorbedCostMxnMonth,
          clinicCount: absorbedByClinic.length,
          eventCount: absorbedByClinic.reduce((a, r) => a + (r._count ?? 0), 0),
        },
      },
      // El cheque real a Anthropic: prepago + absorbido.
      cost: {
        month: {
          prepaidUsd: prepaidCostUsdMonth,
          absorbedUsd: absorbedCostUsdMonth,
          totalUsd: prepaidCostUsdMonth + absorbedCostUsdMonth,
          prepaidMxn: prepaidCostMxnMonth,
          absorbedMxn: absorbedCostMxnMonth,
          totalMxn: prepaidCostMxnMonth + absorbedCostMxnMonth,
        },
        allTime: {
          prepaidUsd: prepaidCostUsdAll,
          absorbedUsd: absorbedCostUsdAll,
          totalUsd: consumedUsd,
          prepaidMxn: prepaidCostMxnAll,
          absorbedMxn: absorbedCostMxnAll,
          totalMxn: prepaidCostMxnAll + absorbedCostMxnAll,
        },
      },
      totals: {
        clinicCount: allIds.length,
        walletCount: wallets.length,
        includedClinicCount: absorbedByClinic.length,
        lowBalanceCount: clinics.filter((c) => c.hasWallet && c.lowBalance).length,
        negativeCount: clinics.filter((c) => c.hasWallet && (c.balanceCents ?? 0) < 0).length,
        pausedCount: clinics.filter((c) => c.status === "PAUSED").length,
        shownCount: clinics.length,
        capped,
      },
      clinics,
      generatedAt: now.toISOString(),
    });
  } catch (err: any) {
    console.error("[admin/ai-billing GET]", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Error" }, { status: 500 });
  }
}
