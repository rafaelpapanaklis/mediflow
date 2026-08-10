import { isAdminAuthed } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roundMxn } from "@/lib/affiliates/stats";
import { MIN_PAID_INVOICES } from "@/lib/affiliates/qualifying-clinic";
import {
  NEAR_RATIO,
  NETWORK_BONUS_KIND,
  SUSTAIN_MONTHS,
  getNetworkBonusTiers,
  getNetworkQualifyingCounts,
  monthsElapsed,
  normalizeAwardStatus,
  type NetworkAwardStatus,
} from "@/lib/affiliates/network-bonus";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/affiliates/network-bonus — LA BANDEJA DE BONOS POR RED.
 *
 * Responde tres cosas distintas y en este orden de importancia:
 *
 *  1. LA ALERTA ANTICIPADA (`tiers[].approaching`). Cuántos afiliados van por
 *     encima del NEAR_RATIO de cada umbral sin haberlo alcanzado. Es el punto
 *     del programa: un afiliado acercándose al escalón mayor son cientos de
 *     miles de pesos que conviene ver venir con meses de antelación, no el día
 *     que el cron los otorga. Por eso el conteo de red se recalcula EN VIVO
 *     aquí (no se lee `lastCount`, que es la foto del último corte mensual).
 *  2. QUIÉN ESTÁ EN QUÉ (`awards`). Quién alcanzó qué escalón, qué eligió, qué
 *     sigue esperando su decisión y qué se pausó. Un `pending_choice` viejo es
 *     dinero que el afiliado todavía no cobra porque no ha entrado a elegir.
 *  3. QUÉ HAY COMPROMETIDO (`summary`). Lo que ya se prometió en mensuales
 *     activos y lo que ya se generó en comisiones.
 *
 * SOLO LECTURA, a propósito. Otorgar, pagar, pausar y reactivar los decide el
 * cron mensual (/api/cron/affiliate-network-bonus) sobre la lógica pura de
 * `decideNetworkSweep`, y ELEGIR es del afiliado. Un botón aquí sería una
 * segunda forma de mover dinero, con sus propias carreras y sin el candado de
 * idempotencia del barrido.
 *
 * DEGRADACIÓN: sin sql/afiliados-bonos-red.sql aplicado devuelve
 * `tableExists: false` con todo en cero y 200 — el bloque del admin se explica
 * solo en vez de romper la pantalla entera.
 */

/** Un escalón visto desde arriba: quién llega, quién se acerca y qué costaría. */
export interface AdminNetworkTierStat {
  n: number;
  clinics: number;
  onceMxn: number;
  monthlyMxn: number;
  /** Afiliados cuya red llega HOY al umbral (conteo en vivo, no el del corte). */
  reached: number;
  /** Los que van por encima del NEAR_RATIO sin alcanzarlo: LA alerta. */
  approaching: number;
  /** Awards ya otorgados de este escalón (elegidos o esperando elección). */
  awarded: number;
  /** Awards contando sus meses sostenidos (todavía no otorgan nada). */
  tracking: number;
  /** Si TODOS los que hoy lo alcanzan acabaran cobrándolo en pago único. */
  exposureOnceMxn: number;
  /** Lo mismo en modalidad mensual: costo recurrente, no una sola salida. */
  exposureMonthlyMxn: number;
}

/** Un award con su afiliado y su conteo de red vivo. */
export interface AdminNetworkAwardRow {
  id: string;
  affiliateId: string;
  affiliateName: string;
  affiliateSlug: string;
  tier: number;
  clinics: number;
  onceMxn: number;
  monthlyMxn: number;
  status: string;
  choice: string | null;
  awardedAt: string | null;
  chosenAt: string | null;
  paidAt: string | null;
  lastMonthlyAt: string | null;
  lastMonthlyKey: string | null;
  monthlyPaidCount: number;
  pausedAt: string | null;
  /** Conteo de red AHORA: contra `clinics` explica una pausa de un vistazo. */
  currentCount: number;
  /** Meses de racha cumplidos; solo en `tracking`. */
  monthsSustained: number | null;
}

export interface AdminNetworkBonusSummary {
  pendingChoice: number;
  monthlyActive: number;
  /** Lo que se paga CADA MES mientras esas redes sostengan su número. */
  monthlyCommittedMxn: number;
  monthlyPaused: number;
  oncePaid: number;
  oncePaidMxn: number;
  tracking: number;
  /** Comisiones `network_bonus` ya generadas y todavía sin liquidar. */
  commissionsPendingMxn: number;
  commissionsPaidMxn: number;
}

export interface AdminNetworkBonusResponse {
  /** false = programa apagado o sin escalones utilizables. */
  enabled: boolean;
  /** false = falta correr sql/afiliados-bonos-red.sql. */
  tableExists: boolean;
  /** Qué tan cerca cuenta como "va cerca" (0.8 = 80% del umbral). */
  nearRatio: number;
  sustainMonths: number;
  minPaidInvoices: number;
  tiers: AdminNetworkTierStat[];
  awards: AdminNetworkAwardRow[];
  summary: AdminNetworkBonusSummary;
}

/**
 * Orden de la bandeja: primero lo ACCIONABLE. Un bono esperando elección es
 * dinero parado, y uno pausado es una promesa que el afiliado ve rota — los dos
 * tienen que salir antes que los que ya están cerrados.
 */
const STATUS_ORDER: Record<NetworkAwardStatus, number> = {
  pending_choice: 0,
  monthly_paused: 1,
  monthly_active: 2,
  tracking: 3,
  once_paid: 4,
};

const EMPTY_SUMMARY: AdminNetworkBonusSummary = {
  pendingChoice: 0,
  monthlyActive: 0,
  monthlyCommittedMxn: 0,
  monthlyPaused: 0,
  oncePaid: 0,
  oncePaidMxn: 0,
  tracking: 0,
  commissionsPendingMxn: 0,
  commissionsPaidMxn: 0,
};

const iso = (d: Date | null | undefined): string | null =>
  d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : null;

export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const { tiers, enabled } = await getNetworkBonusTiers();

  // Los awards son lo único que puede faltar por SQL sin correr: la config vive
  // en columnas de una tabla que ya existía. Se lee aparte para poder decir
  // `tableExists: false` sin apagar también los escalones (que sí se pueden
  // configurar y anunciar antes de que exista una sola fila).
  let awardRows: {
    id: string;
    affiliateId: string;
    tier: number;
    clinics: number;
    onceMxn: number;
    monthlyMxn: number;
    status: string;
    choice: string | null;
    awardedAt: Date | null;
    chosenAt: Date | null;
    paidAt: Date | null;
    lastMonthlyAt: Date | null;
    lastMonthlyKey: string | null;
    monthlyPaidCount: number;
    pausedAt: Date | null;
    qualifiedSince: Date | null;
  }[] = [];
  let tableExists = true;
  try {
    awardRows = await prisma.affiliateNetworkBonusAward.findMany({
      select: {
        id: true,
        affiliateId: true,
        tier: true,
        clinics: true,
        onceMxn: true,
        monthlyMxn: true,
        status: true,
        choice: true,
        awardedAt: true,
        chosenAt: true,
        paidAt: true,
        lastMonthlyAt: true,
        lastMonthlyKey: true,
        monthlyPaidCount: true,
        pausedAt: true,
        qualifiedSince: true,
      },
      orderBy: { tier: "desc" },
    });
  } catch {
    tableExists = false;
  }

  if (!tableExists) {
    const body: AdminNetworkBonusResponse = {
      enabled,
      tableExists: false,
      nearRatio: NEAR_RATIO,
      sustainMonths: SUSTAIN_MONTHS,
      minPaidInvoices: MIN_PAID_INVOICES,
      tiers: [],
      awards: [],
      summary: { ...EMPTY_SUMMARY },
    };
    return NextResponse.json(body);
  }

  // Conteo VIVO de la red de cada afiliado (una pasada agregada, sin N+1). Es
  // lo que hace posible la alerta anticipada: `lastCount` solo diría dónde
  // estaba cada quien el día 1 del mes.
  const counts = await getNetworkQualifyingCounts(now);

  // Nombres para la bandeja. Solo de los afiliados que tienen algún award: el
  // resto no sale en la tabla y no hay por qué traerlos.
  const affiliateIds: string[] = [];
  for (const a of awardRows) if (affiliateIds.indexOf(a.affiliateId) === -1) affiliateIds.push(a.affiliateId);
  const affiliates = affiliateIds.length
    ? await prisma.affiliate
        .findMany({ where: { id: { in: affiliateIds } }, select: { id: true, name: true, slug: true } })
        .catch(() => [] as { id: string; name: string; slug: string }[])
    : [];
  const byId = new Map<string, { name: string; slug: string }>();
  for (const a of affiliates) byId.set(a.id, { name: a.name, slug: a.slug });

  // ── Los escalones, con la alerta anticipada ────────────────────────────
  // `reached` y `approaching` se cuentan sobre TODOS los afiliados con red que
  // califica hoy, tengan award o no: justo el que todavía no tiene ninguno es
  // el que hay que ver venir.
  const liveCounts: number[] = [];
  counts.forEach((n) => liveCounts.push(n));

  const awardedByTier = new Map<number, number>();
  const trackingByTier = new Map<number, number>();
  for (const row of awardRows) {
    const status = normalizeAwardStatus(row.status);
    const map = status === "tracking" ? trackingByTier : awardedByTier;
    map.set(row.tier, (map.get(row.tier) ?? 0) + 1);
  }

  const tierStats: AdminNetworkTierStat[] = tiers.map((t) => {
    // El piso de "va cerca" se redondea hacia arriba: con umbral 5 y ratio 0.8
    // son 4 clínicas, no 4.0000001 que ningún entero cumple.
    const nearFloor = Math.ceil(t.clinics * NEAR_RATIO);
    let reached = 0;
    let approaching = 0;
    for (const n of liveCounts) {
      if (n >= t.clinics) reached += 1;
      else if (n >= nearFloor && n > 0) approaching += 1;
    }
    return {
      n: t.n,
      clinics: t.clinics,
      onceMxn: t.onceMxn,
      monthlyMxn: t.monthlyMxn,
      reached,
      approaching,
      awarded: awardedByTier.get(t.n) ?? 0,
      tracking: trackingByTier.get(t.n) ?? 0,
      exposureOnceMxn: roundMxn(reached * t.onceMxn),
      exposureMonthlyMxn: roundMxn(reached * t.monthlyMxn),
    };
  });

  // ── La bandeja ────────────────────────────────────────────────────────
  const awards: AdminNetworkAwardRow[] = awardRows.map((row) => {
    const status = normalizeAwardStatus(row.status);
    const who = byId.get(row.affiliateId);
    return {
      id: row.id,
      affiliateId: row.affiliateId,
      // Un afiliado borrado deja su award huérfano (la FK es ON DELETE CASCADE,
      // así que no debería pasar): el guion evita una fila sin nombre.
      affiliateName: who?.name ?? "—",
      affiliateSlug: who?.slug ?? "",
      tier: row.tier,
      clinics: Number(row.clinics) || 0,
      onceMxn: Number(row.onceMxn) || 0,
      monthlyMxn: Number(row.monthlyMxn) || 0,
      status,
      choice: row.choice,
      awardedAt: iso(row.awardedAt),
      chosenAt: iso(row.chosenAt),
      paidAt: iso(row.paidAt),
      lastMonthlyAt: iso(row.lastMonthlyAt),
      lastMonthlyKey: row.lastMonthlyKey,
      monthlyPaidCount: Number(row.monthlyPaidCount) || 0,
      pausedAt: iso(row.pausedAt),
      currentCount: counts.get(row.affiliateId) ?? 0,
      monthsSustained: status === "tracking" ? monthsElapsed(row.qualifiedSince, now) : null,
    };
  });

  awards.sort((a, b) => {
    const byStatus =
      (STATUS_ORDER[normalizeAwardStatus(a.status)] ?? 9) -
      (STATUS_ORDER[normalizeAwardStatus(b.status)] ?? 9);
    if (byStatus !== 0) return byStatus;
    // Dentro del mismo estado, el escalón MÁS CARO primero: es el que más
    // urge revisar.
    if (b.tier !== a.tier) return b.tier - a.tier;
    return a.affiliateName.localeCompare(b.affiliateName, "es");
  });

  // ── El resumen ────────────────────────────────────────────────────────
  const summary: AdminNetworkBonusSummary = { ...EMPTY_SUMMARY };
  for (const a of awards) {
    switch (normalizeAwardStatus(a.status)) {
      case "pending_choice":
        summary.pendingChoice += 1;
        break;
      case "monthly_active":
        summary.monthlyActive += 1;
        summary.monthlyCommittedMxn += a.monthlyMxn;
        break;
      case "monthly_paused":
        summary.monthlyPaused += 1;
        break;
      case "once_paid":
        summary.oncePaid += 1;
        summary.oncePaidMxn += a.onceMxn;
        break;
      case "tracking":
        summary.tracking += 1;
        break;
    }
  }
  summary.monthlyCommittedMxn = roundMxn(summary.monthlyCommittedMxn);
  summary.oncePaidMxn = roundMxn(summary.oncePaidMxn);

  // Lo REALMENTE generado en comisiones de bono: cuadra la bandeja contra el
  // dinero que ya entró al flujo de pago. Si esto y `oncePaidMxn` se separaran,
  // habría un award marcado como pagado sin su comisión (o al revés).
  try {
    const groups = await prisma.affiliateCommission.groupBy({
      by: ["status"],
      where: { kind: NETWORK_BONUS_KIND },
      _sum: { commissionMxn: true },
    });
    for (const g of groups) {
      const sum = roundMxn(g._sum.commissionMxn ?? 0);
      if (g.status === "paid") summary.commissionsPaidMxn += sum;
      else summary.commissionsPendingMxn += sum;
    }
  } catch {
    // Sin la tabla de comisiones no hay nada que cuadrar; el resto ya está.
  }

  const body: AdminNetworkBonusResponse = {
    enabled,
    tableExists: true,
    nearRatio: NEAR_RATIO,
    sustainMonths: SUSTAIN_MONTHS,
    minPaidInvoices: MIN_PAID_INVOICES,
    tiers: tierStats,
    awards,
    summary,
  };
  return NextResponse.json(body);
}
