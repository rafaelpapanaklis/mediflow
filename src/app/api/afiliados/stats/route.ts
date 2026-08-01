import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import {
  type AffiliateStatsResponse,
  type AffiliateRefRow,
  parseStatsRange,
  rangeStartUtc,
  lastNDaysUtc,
  activeClinicWhere,
  payingClinicWhere,
  clinicMonthlyMxn,
  projectFixedMonthlyMxn,
  roundMxn,
} from "@/lib/affiliates/stats";
import {
  getPayoutConfig,
  effectiveAffiliateMode,
  normalizePayoutMode,
  type PayoutMode,
  type ProgramMode,
} from "@/lib/affiliates/payout";

export const dynamic = "force-dynamic";

/**
 * GET /api/afiliados/stats?range=7|30|90
 * Respuesta: AffiliateStatsResponse (ver src/lib/affiliates/stats.ts).
 *
 * Queries agregadas (groupBy / $queryRaw con date_trunc), sin N+1 y
 * PgBouncer-safe (solo tagged templates). affiliateId SIEMPRE de la sesión
 * (getAffiliateContext), jamás del request. 2 batches de Promise.all (5 + 5)
 * más una query suelta de términos congelados (necesita los ids del batch 1).
 * Las queries sobre affiliate_clicks degradan a 0/[]/null si la tabla aún no
 * existe en prod (SQL pendiente); lo mismo el motor de comisiones fijas, que
 * sin su config deja la proyección exactamente como estaba (mrr × %).
 * Privacidad: solo agregados — nunca nombres ni planes por clínica.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAffiliateContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const affiliateId = ctx.affiliateId;
  const range = parseStatsRange(req.nextUrl.searchParams.get("range"));
  const since = rangeStartUtc(range);
  const now = new Date();

  // Batch 1: embudo de clínicas + comisiones + primer click registrado.
  const [signups, active, payingList, commissionGroups, firstClick] = await Promise.all([
    prisma.clinic.count({ where: { affiliateId } }),
    // activeClinicWhere devuelve { OR }: spread para no pisar el OR.
    prisma.clinic.count({ where: { affiliateId, ...activeClinicWhere(now) } }),
    prisma.clinic.findMany({
      where: { affiliateId, ...payingClinicWhere() },
      // `id` solo para cruzar los términos congelados; NUNCA sale en la
      // respuesta (privacidad: el afiliado ve conteos, no clínicas).
      select: { id: true, plan: true, monthlyPrice: true },
    }),
    prisma.affiliateCommission.groupBy({
      by: ["status"],
      where: { affiliateId },
      _sum: { commissionMxn: true },
      _count: { _all: true },
    }),
    prisma.affiliateClick
      .findFirst({
        where: { affiliateId },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      })
      .catch(() => null),
  ]);

  // Batch 2: clicks (total, serie diaria, desglose por ref) + serie de altas
  // + config del motor de comisiones.
  // tsconfig no es strict: anotamos el shape de los $queryRaw a mano.
  const emptySeries: Array<{ d: string; n: bigint }> = [];
  const [clicksTotal, clickRows, signupRows, byRefGroups, payoutCfg] = await Promise.all([
    prisma.affiliateClick.count({ where: { affiliateId } }).catch(() => 0),
    prisma.$queryRaw<Array<{ d: string; n: bigint }>>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS d, count(*)::bigint AS n
      FROM "affiliate_clicks"
      WHERE "affiliateId" = ${affiliateId} AND "createdAt" >= ${since}
      GROUP BY 1
    `.catch(() => emptySeries),
    prisma.$queryRaw<Array<{ d: string; n: bigint }>>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS d, count(*)::bigint AS n
      FROM "clinics"
      WHERE "affiliateId" = ${affiliateId} AND "createdAt" >= ${since}
      GROUP BY 1
    `,
    prisma.affiliateClick
      .groupBy({
        by: ["ref", "campaign"],
        where: { affiliateId, createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { ref: "desc" } },
        take: 20,
      })
      .catch(() => []),
    // null = sql/afiliados-comisiones.sql sin correr → motor inactivo y la
    // proyección se queda EXACTAMENTE en el % de siempre. Nunca lanza.
    getPayoutConfig(),
  ]);

  // Batch 3: términos CONGELADOS de las clínicas que hoy pagan (depende de los
  // ids del batch 1). Solo si el motor está activo: sin config no hay nada que
  // cruzar y nos ahorramos la query.
  const payingIds = payingList.map((c) => c.id);
  const termsRows =
    payoutCfg && payingIds.length
      ? await prisma.affiliateClinicTerms
          .findMany({
            where: { clinicId: { in: payingIds } },
            select: { clinicId: true, payoutMode: true },
          })
          .catch(() => [] as Array<{ clinicId: string; payoutMode: string }>)
      : [];

  // Series zero-filled del rango (bigint de Postgres → Number).
  const clicksByDay = new Map<string, number>();
  for (const r of clickRows) clicksByDay.set(r.d, Number(r.n));
  const signupsByDay = new Map<string, number>();
  for (const r of signupRows) signupsByDay.set(r.d, Number(r.n));
  const series = lastNDaysUtc(range).map((date) => ({
    date,
    clicks: clicksByDay.get(date) ?? 0,
    signups: signupsByDay.get(date) ?? 0,
  }));

  // for-of (no .map) para tolerar la unión de tipos que deja el .catch.
  const byRef: AffiliateRefRow[] = [];
  for (const g of byRefGroups) {
    byRef.push({ ref: g.ref, campaign: g.campaign ?? null, clicks: g._count._all });
  }

  // Comisiones: pending/paid + totales sobre TODOS los estados.
  let pendingMxn = 0;
  let pendingCount = 0;
  let paidMxn = 0;
  let paidCount = 0;
  let totalMxn = 0;
  let totalCount = 0;
  for (const g of commissionGroups) {
    const sum = g._sum.commissionMxn ?? 0;
    totalMxn += sum;
    totalCount += g._count._all;
    if (g.status === "pending") {
      pendingMxn = sum;
      pendingCount = g._count._all;
    } else if (g.status === "paid") {
      paidMxn = sum;
      paidCount = g._count._all;
    }
  }

  const mrrMxn = roundMxn(
    payingList.reduce((acc, c) => acc + clinicMonthlyMxn(c.plan, c.monthlyPrice), 0),
  );
  const commissionPct = ctx.affiliate.commissionPct;

  // Modalidad congelada de cada clínica pagando. Sin términos (clínica anterior
  // al motor) vale la del programa — mismo criterio que /api/admin/affiliates/metrics.
  const modeByClinic = new Map<string, string>();
  for (const t of termsRows) modeByClinic.set(t.clinicId, t.payoutMode);

  const clinicTerms: Array<{ plan: string | null; mode: PayoutMode }> = [];
  let recurringClinics = 0;
  let onetimeClinics = 0;
  if (payoutCfg) {
    for (const c of payingList) {
      const raw = modeByClinic.get(c.id);
      const mode = raw === undefined ? payoutCfg.defaultPayoutMode : normalizePayoutMode(raw);
      clinicTerms.push({ plan: c.plan, mode });
      if (mode === "onetime") onetimeClinics += 1;
      else recurringClinics += 1;
    }
  }

  // Proyección: con el motor en "fixed" es la SUMA de los montos fijos de las
  // clínicas recurrentes; en cualquier otro caso (incluido el motor inactivo)
  // se conserva la fórmula histórica mrr × % — cero regresión sin el SQL.
  const programMode: ProgramMode = payoutCfg ? payoutCfg.defaultMode : "pct";
  let projectedMonthlyMxn = roundMxn((mrrMxn * commissionPct) / 100);
  let projectionBasis: ProgramMode = "pct";
  if (payoutCfg && payoutCfg.defaultMode === "fixed") {
    projectedMonthlyMxn = projectFixedMonthlyMxn(clinicTerms, payoutCfg);
    projectionBasis = "fixed";
  }

  const payload: AffiliateStatsResponse = {
    range,
    funnel: { clicks: clicksTotal, signups, active, paying: payingList.length },
    series,
    byRef,
    commissions: {
      pendingMxn: roundMxn(pendingMxn),
      pendingCount,
      paidMxn: roundMxn(paidMxn),
      paidCount,
      totalMxn: roundMxn(totalMxn),
      totalCount,
      mrrMxn,
      projectedMonthlyMxn,
      commissionPct,
      programMode,
      // Modalidad que se le congelará a sus PRÓXIMOS referidos: la suya si el
      // programa deja elegir, si no la del programa.
      payoutMode: effectiveAffiliateMode(ctx.affiliate.payoutMode, payoutCfg),
      projectionBasis,
      recurringClinics,
      onetimeClinics,
    },
    clicksTrackedSince: firstClick ? firstClick.createdAt.toISOString() : null,
  };

  return NextResponse.json(payload);
}
