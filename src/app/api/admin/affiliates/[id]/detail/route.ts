import { isAdminAuthed } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getResolvedPlans } from "@/lib/plans";
import { getAffiliateLevelInfo, type LevelInfo } from "@/lib/affiliate-levels";
import { getSellerStatsForAffiliate } from "@/lib/affiliates/seller-stats";
import { clinicMonthlyMxn } from "@/lib/affiliates/stats";
import {
  commissionKindLabel,
  effectiveAffiliateMode,
  fixedAmountFor,
  getPayoutConfig,
  isNetworkBonusKind,
  normalizePayoutMode,
  normalizePlanKey,
  roundMxn,
  type PayoutMode,
  type ProgramMode,
} from "@/lib/affiliates/payout";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/affiliates/[id]/detail — TODA la ficha del afiliado en UNA
 * sola llamada (la página /admin/affiliates/[id] la consume desde el cliente).
 *
 * DEGRADACIÓN TOTAL: el subsistema de afiliados se despliega por olas y sus
 * tablas/columnas nuevas (affiliate_payout_config, affiliate_clinic_terms,
 * affiliates.payoutMode, affiliate_commissions.kind/monthsCovered,
 * affiliate_seller_*) pueden no existir todavía en la BD. Cada query que las
 * toca lleva su propio .catch, así que este endpoint NUNCA responde 500 por un
 * SQL sin correr: devuelve el subconjunto que sí se pudo leer.
 *
 * Rendimiento: cero N+1. Los conteos de cobros, los términos congelados y las
 * comisiones acumuladas por clínica salen de groupBy/findMany agregados, y los
 * lotes de Promise.all se mantienen en ≤ 6 promesas por PgBouncer.
 */

// ── Contrato del response (lo importa el client con `import type`) ────────

export interface AdminAffiliateDetailAffiliate {
  id: string;
  name: string;
  slug: string;
  email: string;
  status: string;
  referralCode: string;
  commissionPct: number;
  /** Modalidad para sus PRÓXIMAS clínicas (las ya referidas la tienen congelada). */
  payoutMode: PayoutMode;
  payoutMethod: string | null;
  payoutDetails: string | null;
  createdAt: string;
  approvedAt: string | null;
}

export interface AdminAffiliateDetailProgram {
  /** false = sql/afiliados-comisiones.sql sin correr → motor de montos fijos inactivo. */
  engineEnabled: boolean;
  /** "fixed" = montos fijos por plan; "pct" = % del nivel (comportamiento histórico). */
  mode: ProgramMode;
  /** ¿El afiliado puede cambiar su modalidad desde su propio panel? */
  allowAffiliateChoice: boolean;
  startAtInvoiceNo: number;
  oneTimeAtInvoiceNo: number;
}

export interface AdminAffiliateDetailClinic {
  id: string;
  name: string;
  plan: string;
  /** Etiqueta del plan tal como está en plan_configs (jamás escrita a mano). */
  planLabel: string;
  subscriptionStatus: string | null;
  createdAt: string;
  /** En qué número de cobro va la clínica (facturas de suscripción pagadas). */
  invoiceCount: number;
  /** Modalidad CONGELADA al alta. null = todavía sin congelar. */
  payoutMode: PayoutMode | null;
  /** Fecha en la que ya se entregó el pago único de esta clínica. */
  oneTimePaidAt: string | null;
  /** Comisión acumulada que esta clínica le generó al afiliado. */
  commissionMxn: number;
}

export interface AdminAffiliateDetailCommission {
  id: string;
  clinicId: string;
  clinicName: string;
  stripeInvoiceId: string;
  /** "pct" | "recurring" | "onetime" (usar commissionKindLabel para pintarlo). */
  kind: string;
  monthsCovered: number;
  amountMxn: number;
  commissionMxn: number;
  status: string;
  createdAt: string;
  paidAt: string | null;
}

export interface AdminAffiliateDetailMoney {
  /** Comisión total generada (todos los estados). */
  generatedMxn: number;
  pendingMxn: number;
  paidMxn: number;
  /** Proyección mensual REAL: ver `projectionIsLegacy` para saber de dónde sale. */
  projectedMonthlyMxn: number;
}

export interface AdminAffiliateDetailSeller {
  id: string;
  name: string;
  email: string;
  commissionPct: number;
  isActive: boolean;
  clinics: number;
  pendingMxn: number;
  paidMxn: number;
}

export interface AdminAffiliateDetailResponse {
  affiliate: AdminAffiliateDetailAffiliate;
  level: LevelInfo;
  program: AdminAffiliateDetailProgram;
  clinics: AdminAffiliateDetailClinic[];
  /** Historial completo, más recientes primero (tope 500 filas). */
  commissions: AdminAffiliateDetailCommission[];
  money: AdminAffiliateDetailMoney;
  sellers: AdminAffiliateDetailSeller[];
  /**
   * true = la proyección NO sale de montos fijos sino del modo viejo (MRR
   * referido × % del nivel), porque el motor está inactivo o el programa corre
   * en modo "pct". El front debe decirlo en la nota del KPI.
   */
  projectionIsLegacy: boolean;
  /** false = la columna affiliates.payout_mode aún no existe en la BD. */
  payoutModeAvailable: boolean;
}

// ── Lectura defensiva del afiliado ───────────────────────────────────────

type AffiliateRow = {
  id: string;
  name: string;
  slug: string;
  email: string;
  status: string;
  referralCode: string;
  commissionPct: number;
  payoutMode?: string | null;
  payoutMethod: string | null;
  payoutDetails: string | null;
  createdAt: Date;
  approvedAt: Date | null;
};

const AFFILIATE_BASE_SELECT = {
  id: true,
  name: true,
  slug: true,
  email: true,
  status: true,
  referralCode: true,
  commissionPct: true,
  payoutMethod: true,
  payoutDetails: true,
  createdAt: true,
  approvedAt: true,
} as const;

/**
 * Lee el afiliado. `payoutMode` es una columna nueva: si el SQL no está
 * aplicado, el primer intento lanza (P2022) y reintentamos sin ella en vez de
 * tumbar toda la ficha. `undefined` del primer intento = la query falló (un
 * "no existe" devuelve null, no lanza).
 */
async function loadAffiliate(
  id: string,
): Promise<{ row: AffiliateRow | null; payoutModeAvailable: boolean }> {
  const withMode = await prisma.affiliate
    .findUnique({ where: { id }, select: { ...AFFILIATE_BASE_SELECT, payoutMode: true } })
    .catch(() => undefined);
  if (withMode !== undefined) {
    return { row: (withMode as AffiliateRow) ?? null, payoutModeAvailable: true };
  }

  const base = await prisma.affiliate
    .findUnique({ where: { id }, select: AFFILIATE_BASE_SELECT })
    .catch(() => null);
  return { row: (base as AffiliateRow) ?? null, payoutModeAvailable: false };
}

// ── Lectura defensiva del historial de comisiones ────────────────────────

type CommissionRow = {
  id: string;
  clinicId: string;
  stripeInvoiceId: string;
  amountMxn: number;
  commissionMxn: number;
  status: string;
  createdAt: Date;
  paidAt: Date | null;
  kind?: string | null;
  monthsCovered?: number | null;
};

const COMMISSION_BASE_SELECT = {
  id: true,
  clinicId: true,
  stripeInvoiceId: true,
  amountMxn: true,
  commissionMxn: true,
  status: true,
  createdAt: true,
  paidAt: true,
} as const;

/** Mismo truco que loadAffiliate: `kind`/`monthsCovered` son columnas nuevas. */
async function loadCommissions(affiliateId: string): Promise<CommissionRow[]> {
  const withKind = await prisma.affiliateCommission
    .findMany({
      where: { affiliateId },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { ...COMMISSION_BASE_SELECT, kind: true, monthsCovered: true },
    })
    .catch(() => undefined);
  if (withKind !== undefined) return withKind as CommissionRow[];

  const base = await prisma.affiliateCommission
    .findMany({
      where: { affiliateId },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: COMMISSION_BASE_SELECT,
    })
    .catch(() => [] as CommissionRow[]);
  return base as CommissionRow[];
}

// ── Equipo de vendedores (misma lógica que GET .../[id]/sellers) ──────────

async function loadSellers(affiliateId: string): Promise<AdminAffiliateDetailSeller[]> {
  try {
    const [sellers, stats] = await Promise.all([
      prisma.affiliateSeller.findMany({
        where: { affiliateId },
        orderBy: { createdAt: "asc" },
      }),
      getSellerStatsForAffiliate(affiliateId),
    ]);
    return sellers.map((s) => {
      const st = stats.get(s.id);
      return {
        id: s.id,
        name: s.name,
        email: s.email,
        commissionPct: s.commissionPct,
        isActive: s.isActive,
        clinics: st?.clinics ?? 0,
        pendingMxn: roundMxn(st?.pendingMxn ?? 0),
        paidMxn: roundMxn(st?.paidMxn ?? 0),
      };
    });
  } catch {
    // affiliate_seller_* sin crear → sin equipo (degrada sin romper).
    return [];
  }
}

// ── Handler ──────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const affiliateId = params.id;

  try {
    const { row: affiliate, payoutModeAvailable } = await loadAffiliate(affiliateId);
    if (!affiliate) return NextResponse.json({ error: "Afiliado no encontrado" }, { status: 404 });

    // ── Lote 1: config del motor, precios, clínicas referidas y nivel ────
    const [cfg, plans, clinicRows, level] = await Promise.all([
      getPayoutConfig(), // ya devuelve null si la tabla no existe
      getResolvedPlans().catch(() => []),
      prisma.clinic
        .findMany({
          where: { affiliateId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            plan: true,
            monthlyPrice: true,
            subscriptionStatus: true,
            createdAt: true,
          },
        })
        .catch(
          () =>
            [] as Array<{
              id: string;
              name: string;
              plan: string;
              monthlyPrice: number | null;
              subscriptionStatus: string | null;
              createdAt: Date;
            }>,
        ),
      getAffiliateLevelInfo(affiliateId, affiliate.commissionPct),
    ]);

    const clinicIds = clinicRows.map((c) => c.id);

    // ── Lote 2: agregados por clínica y totales de comisión ──────────────
    const [invoiceGroups, termsRows, commissionByClinic, commissionByStatus] = await Promise.all([
      clinicIds.length
        ? prisma.subscriptionInvoice
            .groupBy({
              by: ["clinicId"],
              where: { clinicId: { in: clinicIds }, status: "paid" },
              _count: { _all: true },
            })
            .catch(() => [] as Array<{ clinicId: string; _count: { _all: number } }>)
        : Promise.resolve([] as Array<{ clinicId: string; _count: { _all: number } }>),
      clinicIds.length
        ? prisma.affiliateClinicTerms
            .findMany({ where: { clinicId: { in: clinicIds } } })
            .catch(
              () =>
                [] as Array<{ clinicId: string; payoutMode: string; oneTimePaidAt: Date | null }>,
            )
        : Promise.resolve(
            [] as Array<{ clinicId: string; payoutMode: string; oneTimePaidAt: Date | null }>,
          ),
      prisma.affiliateCommission
        .groupBy({
          by: ["clinicId"],
          where: { affiliateId },
          _sum: { commissionMxn: true },
        })
        .catch(() => [] as Array<{ clinicId: string; _sum: { commissionMxn: number | null } }>),
      prisma.affiliateCommission
        .groupBy({
          by: ["status"],
          where: { affiliateId },
          _sum: { commissionMxn: true },
        })
        .catch(() => [] as Array<{ status: string; _sum: { commissionMxn: number | null } }>),
    ]);

    // ── Lote 3: historial de comisiones y equipo ─────────────────────────
    const [commissionRows, sellers] = await Promise.all([
      loadCommissions(affiliateId),
      loadSellers(affiliateId),
    ]);

    // ── Merge en código (sin N+1) ────────────────────────────────────────
    const invoiceCountByClinic = new Map<string, number>();
    for (const g of invoiceGroups) invoiceCountByClinic.set(g.clinicId, Number(g._count._all));

    const termsByClinic = new Map<string, { payoutMode: PayoutMode; oneTimePaidAt: Date | null }>();
    for (const t of termsRows) {
      termsByClinic.set(t.clinicId, {
        payoutMode: normalizePayoutMode(t.payoutMode),
        oneTimePaidAt: t.oneTimePaidAt ?? null,
      });
    }

    const commissionSumByClinic = new Map<string, number>();
    for (const g of commissionByClinic) {
      commissionSumByClinic.set(g.clinicId, g._sum.commissionMxn ?? 0);
    }

    const planLabelById = new Map<string, string>();
    for (const p of plans) planLabelById.set(p.id, p.label);

    // Nombres de clínica del historial. AffiliateCommission no tiene relación
    // Prisma a Clinic: los de las clínicas referidas ya los tenemos y los que
    // falten (clínica reasignada de afiliado) salen en UNA sola query.
    const clinicNameById = new Map<string, string>();
    for (const c of clinicRows) clinicNameById.set(c.id, c.name);
    const missingNameIds = Array.from(
      new Set(commissionRows.map((c) => c.clinicId).filter((id) => !clinicNameById.has(id))),
    );
    if (missingNameIds.length) {
      const extra = await prisma.clinic
        .findMany({ where: { id: { in: missingNameIds } }, select: { id: true, name: true } })
        .catch(() => [] as Array<{ id: string; name: string }>);
      for (const c of extra) clinicNameById.set(c.id, c.name);
    }

    // ── Dinero ───────────────────────────────────────────────────────────
    let generatedMxn = 0;
    let pendingMxn = 0;
    let paidMxn = 0;
    for (const g of commissionByStatus) {
      const sum = g._sum.commissionMxn ?? 0;
      generatedMxn += sum;
      if (g.status === "paid") paidMxn += sum;
      else if (g.status === "pending") pendingMxn += sum;
    }

    // Proyección mensual. Con el motor en modo "fixed" se suma el fijo
    // recurrente SOLO de las clínicas que pagan y cuya modalidad es
    // "recurring": las de pago único no aportan nada recurrente. Una clínica
    // sin términos congelados (referida antes de esta ola) se proyecta con la
    // modalidad que el motor le congelaría hoy — proyectar $0 sería mentir.
    //
    // Si el motor está inactivo (cfg === null) o el programa corre en modo
    // "pct", lo que se paga NO son montos fijos, así que cae a la proyección
    // vieja: MRR referido × % del nivel. Mostrar un fijo ahí sería una cifra
    // que nunca se va a pagar.
    let projectedMonthlyMxn = 0;
    let projectionIsLegacy = false;
    if (cfg && cfg.defaultMode === "fixed") {
      const fallbackMode = effectiveAffiliateMode(affiliate.payoutMode, cfg);
      for (const c of clinicRows) {
        if (c.subscriptionStatus !== "active") continue;
        const mode = termsByClinic.get(c.id)?.payoutMode ?? fallbackMode;
        if (mode !== "recurring") continue;
        projectedMonthlyMxn += fixedAmountFor(normalizePlanKey(c.plan), "recurring", cfg);
      }
    } else {
      projectionIsLegacy = true;
      let mrrMxn = 0;
      for (const c of clinicRows) {
        if (c.subscriptionStatus !== "active") continue;
        mrrMxn += clinicMonthlyMxn(c.plan, c.monthlyPrice);
      }
      projectedMonthlyMxn = mrrMxn * (level.pct / 100);
    }

    // ── Armado del response ──────────────────────────────────────────────
    const clinics: AdminAffiliateDetailClinic[] = clinicRows.map((c) => {
      const terms = termsByClinic.get(c.id) ?? null;
      return {
        id: c.id,
        name: c.name,
        plan: c.plan,
        planLabel: planLabelById.get(c.plan) ?? c.plan,
        subscriptionStatus: c.subscriptionStatus ?? null,
        createdAt: c.createdAt.toISOString(),
        invoiceCount: invoiceCountByClinic.get(c.id) ?? 0,
        payoutMode: terms ? terms.payoutMode : null,
        oneTimePaidAt: terms?.oneTimePaidAt ? terms.oneTimePaidAt.toISOString() : null,
        commissionMxn: roundMxn(commissionSumByClinic.get(c.id) ?? 0),
      };
    });

    const commissions: AdminAffiliateDetailCommission[] = commissionRows.map((c) => ({
      id: c.id,
      clinicId: c.clinicId,
      // Un BONO POR RED no nace de una clínica (su `clinicId` va vacío a
      // propósito): sin este corte la ficha del afiliado mostraría una
      // "Clínica" inexistente en la fila de un bono.
      clinicName: isNetworkBonusKind(c.kind)
        ? commissionKindLabel(c.kind)
        : (clinicNameById.get(c.clinicId) ?? "Clínica"),
      stripeInvoiceId: c.stripeInvoiceId,
      kind: c.kind ?? "pct",
      monthsCovered: c.monthsCovered ?? 1,
      amountMxn: c.amountMxn,
      commissionMxn: c.commissionMxn,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      paidAt: c.paidAt ? c.paidAt.toISOString() : null,
    }));

    const program: AdminAffiliateDetailProgram = cfg
      ? {
          engineEnabled: true,
          mode: cfg.defaultMode,
          allowAffiliateChoice: cfg.allowAffiliateChoice,
          startAtInvoiceNo: cfg.startAtInvoiceNo,
          oneTimeAtInvoiceNo: cfg.oneTimeAtInvoiceNo,
        }
      : {
          // Sin motor el programa sigue pagando el % del nivel desde el primer
          // cobro y el afiliado no tiene ninguna modalidad que elegir.
          engineEnabled: false,
          mode: "pct",
          allowAffiliateChoice: false,
          startAtInvoiceNo: 1,
          oneTimeAtInvoiceNo: 1,
        };

    const body: AdminAffiliateDetailResponse = {
      affiliate: {
        id: affiliate.id,
        name: affiliate.name,
        slug: affiliate.slug,
        email: affiliate.email,
        status: affiliate.status,
        referralCode: affiliate.referralCode,
        commissionPct: affiliate.commissionPct,
        payoutMode: normalizePayoutMode(affiliate.payoutMode),
        payoutMethod: affiliate.payoutMethod ?? null,
        payoutDetails: affiliate.payoutDetails ?? null,
        createdAt: affiliate.createdAt.toISOString(),
        approvedAt: affiliate.approvedAt ? affiliate.approvedAt.toISOString() : null,
      },
      level,
      program,
      clinics,
      commissions,
      money: {
        generatedMxn: roundMxn(generatedMxn),
        pendingMxn: roundMxn(pendingMxn),
        paidMxn: roundMxn(paidMxn),
        projectedMonthlyMxn: roundMxn(projectedMonthlyMxn),
      },
      sellers,
      projectionIsLegacy,
      payoutModeAvailable,
    };

    return NextResponse.json(body);
  } catch (err) {
    // Backstop: cada query ya degrada por su cuenta, así que llegar aquí es un
    // error inesperado (no una tabla ausente).
    console.error("[admin/affiliates/detail]", err);
    return NextResponse.json({ error: "No se pudo cargar la ficha del afiliado" }, { status: 500 });
  }
}
