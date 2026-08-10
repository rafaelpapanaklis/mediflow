import { isAdminAuthed } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  type AffiliateFunnel,
  activeClinicWhere,
  payingClinicWhere,
  clinicMonthlyMxn,
  roundMxn,
} from "@/lib/affiliates/stats";
import {
  getPayoutSettings,
  fixedAmountFor,
  milestoneTiers,
  normalizePlanKey,
  normalizePayoutMode,
} from "@/lib/affiliates/payout";
import {
  MIN_PAID_INVOICES,
  clinicQualifies,
  paidInvoiceCountByClinic,
} from "@/lib/affiliates/milestones-progress";
// El `kind` con el que los BONOS POR RED entran a affiliate_commissions. Se
// importa en vez de teclear "network_bonus": la cadena la define el módulo que
// las escribe, y una copia desincronizada aquí solo se notaría como una cifra
// mal repartida meses después.
import { NETWORK_BONUS_KIND } from "@/lib/affiliates/network-bonus";

export const dynamic = "force-dynamic";

/**
 * "Va cerca": a partir de qué fracción del umbral un afiliado entra en la
 * alerta anticipada. NO es una regla del programa (los umbrales y los montos
 * salen todos de la config) — es solo el corte visual para ver venir una salida
 * grande con meses de anticipación.
 */
const NEAR_RATIO = 0.8;


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

export interface AdminAffiliatePayoutMetrics {
  /** false = tabla del motor inexistente (todo lo demás va en 0/null). */
  enabled: boolean;
  mode: "fixed" | "pct";
  /** COSTO MENSUAL COMPROMETIDO: suma del fijo recurrente de TODAS las clínicas activas referidas cuya modalidad congelada es "recurring". */
  committedMonthlyMxn: number;
  /** committedMonthlyMxn / mrrReferredMxn × 100; null si el MRR es 0. */
  committedPctOfMrr: number | null;
  /** Desglose por modalidad congelada (solo clínicas referidas PAGANDO). */
  recurringClinics: number;
  onetimeClinics: number;
  /** Clínicas cuyo pago único ya se entregó (oneTimePaidAt != null). */
  onetimePaidClinics: number;
  /**
   * Comisiones ya generadas por tipo (histórico, todos los estados).
   * `networkBonus` es su propio cubo: los bonos por red NO son comisiones del
   * motor (no nacen de una factura) y si cayeran en `pct` inflarían justo la
   * cifra con la que se decide si el % del nivel sale caro.
   */
  byKindMxn: { pct: number; recurring: number; onetime: number; networkBonus: number };
}

/** Un escalón del Bono por Clínicas Activas, con cuántos afiliados lo alcanzan HOY. */
export interface AdminAffiliateMilestoneTier {
  /** 1 | 2 | 3 — el orden EN LA CONFIG. */
  n: number;
  /** Umbral de clínicas que califican (de la config, jamás escrito a mano). */
  clinics: number;
  /** Bono de ese escalón, pago único (de la config). */
  mxn: number;
  /** Afiliados que hoy llegan al umbral. */
  affiliates: number;
  /** Afiliados que aún no llegan pero van por ≥ NEAR_RATIO del umbral: la alerta anticipada. */
  approaching: number;
  /** affiliates × mxn — lo que costaría si todos cruzaran hoy. */
  committedMxn: number;
}

export interface AdminAffiliateMilestoneMetrics {
  /** false = bono apagado, sin escalones o SQL sin aplicar → el bloque no se pinta. */
  enabled: boolean;
  /** Mensualidades pagadas que exige la cláusula (mismo número que ve el afiliado). */
  minPaidInvoices: number;
  tiers: AdminAffiliateMilestoneTier[];
  /** Suma de los committedMxn de todos los escalones ya alcanzados. */
  committedMxn: number;
  /** Afiliados con al menos 1 clínica que califica. */
  affiliatesWithQualifying: number;
  /** El mayor conteo que califica entre todos los afiliados (quién va adelante). */
  topQualifying: number;
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
  /** Motor de comisiones fijas (enabled=false si el SQL aún no se corrió). */
  payout: AdminAffiliatePayoutMetrics;
  /** Bono por Clínicas Activas: cuántos afiliados van por cada hito (enabled=false si está apagado). */
  milestones: AdminAffiliateMilestoneMetrics;
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
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * 86400000);

    // ── Batch 1: afiliados, clínicas referidas y comisiones ──────────────
    const [statusGroups, affiliateList, signupGroups, payingClinics, activeReferredClinics, commissionGroups] =
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
        // `id` se selecciona para cruzar con los términos congelados del motor.
        prisma.clinic.findMany({
          where: { affiliateId: { not: null }, ...payingClinicWhere() },
          select: { id: true, affiliateId: true, plan: true, monthlyPrice: true },
        }),
        // activeClinicWhere() devuelve { OR: [...] }: va dentro de AND para
        // no pisar el filtro de affiliateId al combinarlos.
        // Se traen las FILAS (no un count) porque el bono por clínicas activas
        // necesita cruzarlas con sus cobros pagados; el funnel usa .length.
        prisma.clinic.findMany({
          where: { AND: [{ affiliateId: { not: null } }, activeClinicWhere(now)] },
          select: { id: true, affiliateId: true },
        }),
        prisma.affiliateCommission.groupBy({
          by: ["affiliateId", "status"],
          _sum: { commissionMxn: true, amountMxn: true },
        }),
      ]);

    // ── Batch 2: clicks + config del motor (tablas nuevas — degradan) ────
    const [clicksAllTime, clicks30d, clickGroups, lastClickRows, payoutSettings] = await Promise.all([
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
      // Config del motor + bonos por hitos en UNA lectura de la fila id=1
      // (misma query que getPayoutConfig, sin SELECT extra). cfg = null si
      // sql/afiliados-comisiones.sql no se corrió → el bloque `payout` sale
      // apagado; milestones = null apaga el bloque de hitos. Nunca lanza.
      getPayoutSettings(),
    ]);

    const payoutCfg = payoutSettings.cfg;
    const milestonesCfg = payoutSettings.milestones;

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
      active: activeReferredClinics.length,
      paying: payingClinics.length,
    };

    // ── Batch 3: motor de comisiones fijas ───────────────────────────────
    // Todo el bloque es OPCIONAL: si la config no existe (SQL sin correr) o
    // cualquier query falla, `payout` queda apagado y el resto de las métricas
    // se devuelven igual. Este endpoint nunca debe empezar a dar 500 por esto.
    let payout: AdminAffiliatePayoutMetrics = {
      enabled: false,
      mode: "pct",
      committedMonthlyMxn: 0,
      committedPctOfMrr: null,
      recurringClinics: 0,
      onetimeClinics: 0,
      onetimePaidClinics: 0,
      byKindMxn: { pct: 0, recurring: 0, onetime: 0, networkBonus: 0 },
    };

    if (payoutCfg) {
      try {
        const [termsRows, kindGroups] = await Promise.all([
          // Términos CONGELADOS de las clínicas que hoy pagan. Panel de admin:
          // el `in` directo basta (no hay paginación que valga la pena aquí).
          prisma.affiliateClinicTerms
            .findMany({
              where: { clinicId: { in: payingClinics.map((c) => c.id) } },
              select: { clinicId: true, payoutMode: true, oneTimePaidAt: true },
            })
            .catch(
              () => [] as Array<{ clinicId: string; payoutMode: string; oneTimePaidAt: Date | null }>,
            ),
          // Comisiones ya generadas por tipo (histórico, todos los estados).
          prisma.affiliateCommission
            .groupBy({ by: ["kind"], _sum: { commissionMxn: true } })
            .catch(() => [] as Array<{ kind: string; _sum: { commissionMxn: number | null } }>),
        ]);

        const termsByClinic = new Map<string, { payoutMode: string; oneTimePaidAt: Date | null }>();
        for (const t of termsRows) termsByClinic.set(t.clinicId, t);

        let committedMonthlyMxn = 0;
        let recurringClinics = 0;
        let onetimeClinics = 0;
        let onetimePaidClinics = 0;
        for (const c of payingClinics) {
          const terms = termsByClinic.get(c.id);
          // Sin términos congelados (clínica anterior al motor) → cuenta con la
          // modalidad por defecto del programa.
          const mode = terms ? normalizePayoutMode(terms.payoutMode) : payoutCfg.defaultPayoutMode;
          if (mode === "onetime") {
            onetimeClinics += 1;
            if (terms?.oneTimePaidAt) onetimePaidClinics += 1;
          } else {
            recurringClinics += 1;
            committedMonthlyMxn += fixedAmountFor(normalizePlanKey(c.plan), "recurring", payoutCfg);
          }
        }

        let kindPct = 0;
        let kindRecurring = 0;
        let kindOnetime = 0;
        let kindNetworkBonus = 0;
        for (const g of kindGroups) {
          const sum = g._sum.commissionMxn ?? 0;
          if (g.kind === "recurring") kindRecurring += sum;
          else if (g.kind === "onetime") kindOnetime += sum;
          // Los BONOS POR RED entran a affiliate_commissions para cobrarse por
          // el mismo flujo, pero no los calculó el motor: sin esta rama caerían
          // en el `else` y se sumarían al cubo del "% del nivel", que es
          // exactamente la cifra que se mira para decidir si ese % sale caro.
          else if (g.kind === NETWORK_BONUS_KIND) kindNetworkBonus += sum;
          else kindPct += sum; // "pct" y cualquier valor viejo/desconocido
        }

        payout = {
          enabled: true,
          mode: payoutCfg.defaultMode,
          committedMonthlyMxn: roundMxn(committedMonthlyMxn),
          committedPctOfMrr:
            mrrReferredMxn > 0 ? roundMxn((committedMonthlyMxn / mrrReferredMxn) * 100) : null,
          recurringClinics,
          onetimeClinics,
          onetimePaidClinics,
          byKindMxn: {
            pct: roundMxn(kindPct),
            recurring: roundMxn(kindRecurring),
            onetime: roundMxn(kindOnetime),
            networkBonus: roundMxn(kindNetworkBonus),
          },
        };
      } catch (err) {
        // El bloque queda apagado (todo en 0/null); el resto de las métricas
        // sigue siendo válido y el endpoint responde 200.
        console.error("[admin/affiliates/metrics] payout", err);
      }
    }

    // ── Batch 4: Bono por Clínicas Activas ───────────────────────────────
    // Cuántos afiliados alcanzan HOY cada escalón, con el MISMO criterio que ve
    // el afiliado en su panel: clínicas ACTIVAS con al menos MIN_PAID_INVOICES
    // cobros pagados. Contar aquí "activas" a secas daría un número distinto al
    // suyo y ninguno de los dos sería creíble.
    //
    // Agregación GLOBAL, sin N+1 (nada de llamar a getMilestoneProgress por
    // afiliado): las clínicas activas referidas ya vienen del batch 1, se pide
    // UNA groupBy de cobros pagados y el cruce se hace en memoria.
    let milestones: AdminAffiliateMilestoneMetrics = {
      enabled: false,
      minPaidInvoices: MIN_PAID_INVOICES,
      tiers: [],
      committedMxn: 0,
      affiliatesWithQualifying: 0,
      topQualifying: 0,
    };

    const tierList = milestonesCfg ? milestoneTiers(milestonesCfg) : [];
    if (milestonesCfg?.milestonesEnabled === true && tierList.length > 0) {
      try {
        const paidByClinic = await paidInvoiceCountByClinic(
          activeReferredClinics.map((c) => c.id),
        );

        // Clínicas que califican, contadas por afiliado.
        const qualifyingByAff = new Map<string, number>();
        for (const c of activeReferredClinics) {
          if (!c.affiliateId) continue;
          if (!clinicQualifies(paidByClinic.get(c.id))) continue;
          qualifyingByAff.set(c.affiliateId, (qualifyingByAff.get(c.affiliateId) ?? 0) + 1);
        }

        // Map.forEach y no spread del iterador: el target de TS del repo no
        // permite [...map.values()].
        const counts: number[] = [];
        let topQualifying = 0;
        qualifyingByAff.forEach((n) => {
          counts.push(n);
          if (n > topQualifying) topQualifying = n;
        });

        let committedMxn = 0;
        const tiers: AdminAffiliateMilestoneTier[] = tierList.map((t) => {
          // Umbral de "va cerca": nunca el propio umbral (si no, un afiliado
          // que ya lo alcanzó contaría dos veces).
          const nearAt = Math.ceil(t.clinics * NEAR_RATIO);
          let reached = 0;
          let approaching = 0;
          for (const n of counts) {
            if (n >= t.clinics) reached += 1;
            else if (n >= nearAt) approaching += 1;
          }
          const tierCommitted = roundMxn(reached * t.mxn);
          committedMxn += tierCommitted;
          return {
            n: t.n,
            clinics: t.clinics,
            mxn: t.mxn,
            affiliates: reached,
            approaching,
            committedMxn: tierCommitted,
          };
        });

        milestones = {
          enabled: true,
          minPaidInvoices: MIN_PAID_INVOICES,
          tiers,
          committedMxn: roundMxn(committedMxn),
          affiliatesWithQualifying: counts.length,
          topQualifying,
        };
      } catch (err) {
        // Mismo criterio que `payout`: el bloque se apaga y el endpoint sigue
        // respondiendo 200 con el resto de las métricas.
        console.error("[admin/affiliates/metrics] milestones", err);
      }
    }

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
      payout,
      milestones,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[admin/affiliates/metrics]", err);
    return NextResponse.json({ error: "No se pudieron calcular las métricas" }, { status: 500 });
  }
}
