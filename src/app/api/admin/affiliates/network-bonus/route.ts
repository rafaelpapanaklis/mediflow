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
  normalizeAwardStatus,
  type AwardRow,
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
 *  2. QUIÉN ESTÁ EN QUÉ (`awards`). Quién está sosteniendo su número y a quién
 *     ya se le otorgó el escalón, con el monto que quedó CONGELADO al otorgarlo
 *     y el conteo con el que se cerró el último corte.
 *  3. QUÉ SALIÓ (`summary`). Lo otorgado en pago único frente a las comisiones
 *     `network_bonus` realmente generadas, liquidadas o no.
 *
 * DOS ESTADOS Y NADA MÁS: `tracking` (contando los meses, no paga nada) y
 * `awarded` (otorgado, su pago único ya se generó y está cerrado para siempre).
 * La modalidad mensual y su pantalla de elección se retiraron en ago 2026: aquí
 * ya no hay `choice`, ni mensualidades, ni un bono ganado esperando un clic.
 *
 * SOLO LECTURA, a propósito. Otorgar y pagar lo decide el cron mensual
 * (/api/cron/affiliate-network-bonus) sobre la lógica pura de
 * `decideNetworkSweep`. Un botón aquí sería una segunda forma de mover dinero,
 * con sus propias carreras y sin el candado de idempotencia del barrido.
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
  /** Afiliados cuya red llega HOY al umbral (conteo en vivo, no el del corte). */
  reached: number;
  /** Los que van por encima del NEAR_RATIO sin alcanzarlo: LA alerta. */
  approaching: number;
  /** Awards ya otorgados de este escalón (su pago único ya se generó). */
  awarded: number;
  /** Awards contando sus meses sostenidos (todavía no otorgan nada). */
  tracking: number;
  /** Si TODOS los que hoy lo alcanzan acabaran otorgándose: una sola salida. */
  exposureOnceMxn: number;
}

/** Un award con su afiliado. Espejo de AwardRow + el nombre para pintarlo. */
export interface AdminNetworkAwardRow {
  id: string;
  affiliateId: string;
  affiliateName: string;
  tier: number;
  status: NetworkAwardStatus;
  /** Umbral del escalón; en `awarded` es el que quedó congelado. */
  clinics: number;
  /** Pago único; en `awarded` es el monto congelado, no el vigente. */
  onceMxn: number;
  /** Arranque de la racha viva. null en `tracking` = cayó del umbral. */
  qualifiedSince: string | null;
  awardedAt: string | null;
  paidAt: string | null;
  /** Conteo de red del ÚLTIMO corte del cron (la foto, no el vivo). */
  lastCount: number;
}

export interface AdminNetworkBonusSummary {
  /** Escalones otorgados (su comisión de pago único ya nació). */
  awarded: number;
  /** Suma de esos pagos únicos con el monto CONGELADO de cada award. */
  awardedOnceMxn: number;
  /** Escalones contando su racha: todavía no pagan nada. */
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
 * Orden de la bandeja: primero lo que TODAVÍA PUEDE MOVERSE. Una racha en curso
 * es dinero que está por salir y que aún depende de que su red aguante; un
 * escalón otorgado está cerrado para siempre y no hay nada que vigilar en él.
 */
const STATUS_ORDER: Record<NetworkAwardStatus, number> = {
  tracking: 0,
  awarded: 1,
};

const EMPTY_SUMMARY: AdminNetworkBonusSummary = {
  awarded: 0,
  awardedOnceMxn: 0,
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
  // El shape es `AwardRow` (@/lib/affiliates/network-bonus): mismas columnas
  // vivas que lee el cron, para que la bandeja no invente una segunda idea de
  // qué es un award.
  let awardRows: AwardRow[] = [];
  let tableExists = true;
  try {
    awardRows = (await prisma.affiliateNetworkBonusAward.findMany({
      select: {
        id: true,
        affiliateId: true,
        tier: true,
        status: true,
        clinics: true,
        onceMxn: true,
        qualifiedSince: true,
        awardedAt: true,
        paidAt: true,
        lastCount: true,
      },
      orderBy: { tier: "desc" },
    })) as AwardRow[];
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
        .findMany({ where: { id: { in: affiliateIds } }, select: { id: true, name: true } })
        .catch(() => [] as { id: string; name: string }[])
    : [];
  const nameById = new Map<string, string>();
  for (const a of affiliates) nameById.set(a.id, a.name);

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
      reached,
      approaching,
      awarded: awardedByTier.get(t.n) ?? 0,
      tracking: trackingByTier.get(t.n) ?? 0,
      exposureOnceMxn: roundMxn(reached * t.onceMxn),
    };
  });

  // ── La bandeja ────────────────────────────────────────────────────────
  const awards: AdminNetworkAwardRow[] = awardRows.map((row) => ({
    id: row.id,
    affiliateId: row.affiliateId,
    // Un afiliado borrado deja su award huérfano (la FK es ON DELETE CASCADE,
    // así que no debería pasar): el guion evita una fila sin nombre.
    affiliateName: nameById.get(row.affiliateId) ?? "—",
    tier: row.tier,
    // Los estados de la etapa con modalidad mensual se normalizan a `awarded`:
    // cualquiera de ellos significa "ya se otorgó".
    status: normalizeAwardStatus(row.status),
    clinics: Number(row.clinics) || 0,
    onceMxn: Number(row.onceMxn) || 0,
    qualifiedSince: iso(row.qualifiedSince),
    awardedAt: iso(row.awardedAt),
    paidAt: iso(row.paidAt),
    lastCount: Number(row.lastCount) || 0,
  }));

  awards.sort((a, b) => {
    const byStatus = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    // Dentro del mismo estado, el escalón MÁS CARO primero: es el que más
    // urge revisar.
    if (b.tier !== a.tier) return b.tier - a.tier;
    return a.affiliateName.localeCompare(b.affiliateName, "es");
  });

  // ── El resumen ────────────────────────────────────────────────────────
  const summary: AdminNetworkBonusSummary = { ...EMPTY_SUMMARY };
  for (const a of awards) {
    if (a.status === "awarded") {
      summary.awarded += 1;
      summary.awardedOnceMxn += a.onceMxn;
    } else {
      summary.tracking += 1;
    }
  }
  summary.awardedOnceMxn = roundMxn(summary.awardedOnceMxn);

  // Lo REALMENTE generado en comisiones de bono: cuadra la bandeja contra el
  // dinero que ya entró al flujo de pago. `awardedOnceMxn` y la suma de las
  // comisiones tienen que ir a la par: si se separan, hay un award otorgado sin
  // su comisión (o una comisión sin su award).
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
