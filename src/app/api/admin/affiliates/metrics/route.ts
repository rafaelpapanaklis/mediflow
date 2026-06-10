import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  type AffiliateFunnel,
  activeClinicWhere,
  payingClinicWhere,
  clinicMonthlyMxn,
  roundMxn,
} from "@/lib/affiliates/stats";

export const dynamic = "force-dynamic";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

export interface AdminAffiliateTopRow {
  affiliateId: string;
  name: string;
  slug: string;
  status: string;
  clicks: number;
  signups: number;
  paying: number;
  /** pagando/clicks*100, null si clicks = 0. */
  convPct: number | null;
  pendingMxn: number;
  paidMxn: number;
}

export interface AdminAffiliateInactiveRow {
  affiliateId: string;
  name: string;
  slug: string;
  email: string;
  lastClickAt: string | null;
}

export interface AdminAffiliateMetricsResponse {
  program: {
    affiliatesTotal: number;
    affiliatesApproved: number;
    affiliatesPending: number;
    clicks30d: number;
    funnel: AffiliateFunnel; // global (todos los afiliados)
    commissionsPendingMxn: number;
    commissionsPaidMxn: number;
    /** Revenue facturado traído por afiliados (suma de amountMxn). */
    revenueBroughtMxn: number;
    /** MRR actual de clínicas referidas pagando. */
    mrrReferredMxn: number;
  };
  top: AdminAffiliateTopRow[]; // top 10 por clínicas pagando, luego conversión
  inactive: AdminAffiliateInactiveRow[]; // APPROVED sin clicks en 30 días
}

/**
 * GET /api/admin/affiliates/metrics — métricas del programa de afiliados.
 *
 * Todo con queries agregadas (groupBy por affiliateId) + merge en código.
 * Las queries sobre affiliate_clicks degradan a 0/vacío si la tabla aún no
 * existe (el DDL vive en sql/afiliados-stats.sql, sin relación Prisma).
 * Privacidad: aquí solo afiliados agregados; jamás se listan clínicas
 * individuales.
 */
export async function GET() {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * 86400000);

    // ── Batch 1: afiliados, clínicas referidas y comisiones ──────────────
    const [statusGroups, affiliateList, signupGroups, payingClinics, activeReferred, commissionGroups] =
      await Promise.all([
        prisma.affiliate.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.affiliate.findMany({
          select: { id: true, name: true, slug: true, email: true, status: true },
        }),
        // Registros (signups) por afiliado.
        prisma.clinic.groupBy({
          by: ["affiliateId"],
          where: { affiliateId: { not: null } },
          _count: { _all: true },
        }),
        // Clínicas referidas pagando hoy (base de paying por afiliado + MRR).
        prisma.clinic.findMany({
          where: { affiliateId: { not: null }, ...payingClinicWhere() },
          select: { affiliateId: true, plan: true, monthlyPrice: true },
        }),
        // activeClinicWhere() devuelve { OR: [...] }: va dentro de AND para
        // no pisar el filtro de affiliateId al combinarlos.
        prisma.clinic.count({
          where: { AND: [{ affiliateId: { not: null } }, activeClinicWhere(now)] },
        }),
        prisma.affiliateCommission.groupBy({
          by: ["affiliateId", "status"],
          _sum: { commissionMxn: true, amountMxn: true },
        }),
      ]);

    // ── Batch 2: clicks (tabla nueva — degradar si aún no existe) ────────
    const [clicksAllTime, clicks30d, clickGroups, lastClickRows] = await Promise.all([
      prisma.affiliateClick.count().catch(() => 0),
      prisma.affiliateClick.count({ where: { createdAt: { gte: since30 } } }).catch(() => 0),
      prisma.affiliateClick
        .groupBy({ by: ["affiliateId"], _count: { _all: true } })
        .catch(() => [] as Array<{ affiliateId: string; _count: { _all: number } }>),
      // Último click por afiliado (una sola pasada, sin N+1).
      prisma.$queryRaw<Array<{ id: string; last: Date }>>`
        SELECT "affiliateId" AS id, max("createdAt") AS last
        FROM "affiliate_clicks"
        GROUP BY 1
      `.catch(() => [] as Array<{ id: string; last: Date }>),
    ]);

    // ── Merge en código ──────────────────────────────────────────────────
    const clicksByAff = new Map<string, number>();
    for (const g of clickGroups) clicksByAff.set(g.affiliateId, Number(g._count._all));

    const lastClickByAff = new Map<string, Date>();
    for (const r of lastClickRows) {
      const d = r.last instanceof Date ? r.last : new Date(String(r.last));
      if (!isNaN(d.getTime())) lastClickByAff.set(String(r.id), d);
    }

    const signupsByAff = new Map<string, number>();
    let signupsTotal = 0;
    for (const g of signupGroups) {
      const n = Number(g._count._all); // bigint-safe
      signupsTotal += n;
      if (g.affiliateId) signupsByAff.set(g.affiliateId, n);
    }

    const payingByAff = new Map<string, number>();
    let mrrReferredMxn = 0;
    for (const c of payingClinics) {
      mrrReferredMxn += clinicMonthlyMxn(c.plan, c.monthlyPrice);
      if (c.affiliateId) payingByAff.set(c.affiliateId, (payingByAff.get(c.affiliateId) ?? 0) + 1);
    }

    const pendingByAff = new Map<string, number>();
    const paidByAff = new Map<string, number>();
    let commissionsPendingMxn = 0;
    let commissionsPaidMxn = 0;
    let revenueBroughtMxn = 0;
    for (const g of commissionGroups) {
      const commission = g._sum.commissionMxn ?? 0;
      revenueBroughtMxn += g._sum.amountMxn ?? 0; // todos los estados
      if (g.status === "pending") {
        commissionsPendingMxn += commission;
        pendingByAff.set(g.affiliateId, (pendingByAff.get(g.affiliateId) ?? 0) + commission);
      } else if (g.status === "paid") {
        commissionsPaidMxn += commission;
        paidByAff.set(g.affiliateId, (paidByAff.get(g.affiliateId) ?? 0) + commission);
      }
    }

    const countByStatus = (s: string) =>
      Number(statusGroups.find((g) => g.status === s)?._count._all ?? 0);

    const funnel: AffiliateFunnel = {
      clicks: Number(clicksAllTime),
      signups: signupsTotal,
      active: Number(activeReferred),
      paying: payingClinics.length,
    };

    // Top 10: clínicas pagando desc → conversión desc (null al final).
    const top: AdminAffiliateTopRow[] = affiliateList
      .map((a) => {
        const clicks = clicksByAff.get(a.id) ?? 0;
        const paying = payingByAff.get(a.id) ?? 0;
        return {
          affiliateId: a.id,
          name: a.name,
          slug: a.slug,
          status: a.status,
          clicks,
          signups: signupsByAff.get(a.id) ?? 0,
          paying,
          convPct: clicks > 0 ? roundMxn((paying / clicks) * 100) : null,
          pendingMxn: roundMxn(pendingByAff.get(a.id) ?? 0),
          paidMxn: roundMxn(paidByAff.get(a.id) ?? 0),
        };
      })
      .sort((a, b) => {
        if (b.paying !== a.paying) return b.paying - a.paying;
        if (a.convPct === null && b.convPct === null) return 0;
        if (a.convPct === null) return 1;
        if (b.convPct === null) return -1;
        return b.convPct - a.convPct;
      })
      .slice(0, 10);

    // Inactivos: APPROVED sin clicks en 30 días. Nunca (null) primero,
    // luego último click más viejo primero (ISO compara cronológico).
    const inactive: AdminAffiliateInactiveRow[] = affiliateList
      .filter((a) => a.status === "APPROVED")
      .map((a) => {
        const last = lastClickByAff.get(a.id) ?? null;
        return {
          affiliateId: a.id,
          name: a.name,
          slug: a.slug,
          email: a.email,
          lastClickAt: last ? last.toISOString() : null,
        };
      })
      .filter((r) => r.lastClickAt === null || r.lastClickAt < since30.toISOString())
      .sort((a, b) => {
        if (a.lastClickAt === b.lastClickAt) return 0;
        if (a.lastClickAt === null) return -1;
        if (b.lastClickAt === null) return 1;
        return a.lastClickAt < b.lastClickAt ? -1 : 1;
      });

    const body: AdminAffiliateMetricsResponse = {
      program: {
        affiliatesTotal: affiliateList.length,
        affiliatesApproved: countByStatus("APPROVED"),
        affiliatesPending: countByStatus("PENDING"),
        clicks30d: Number(clicks30d),
        funnel,
        commissionsPendingMxn: roundMxn(commissionsPendingMxn),
        commissionsPaidMxn: roundMxn(commissionsPaidMxn),
        revenueBroughtMxn: roundMxn(revenueBroughtMxn),
        mrrReferredMxn: roundMxn(mrrReferredMxn),
      },
      top,
      inactive,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[admin/affiliates/metrics]", err);
    return NextResponse.json({ error: "No se pudieron calcular las métricas" }, { status: 500 });
  }
}
