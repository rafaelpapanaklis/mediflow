/**
 * Afiliados — BONOS POR RED: los helpers CON base de datos.
 *
 * La lógica que decide dinero vive en `./network-bonus-core` (pura, testeable
 * sin BD) y este archivo la RE-EXPORTA, así que el server importa todo desde
 * "@/lib/affiliates/network-bonus". Mismo corte que payout-core.ts/payout.ts.
 *
 * RED = los afiliados que ÉL invitó (`Affiliate.invitedByAffiliateId`), a UN
 * salto. Las clínicas de los invitados de sus invitados NO cuentan para él: el
 * programa es de un solo nivel y aquí se cumple por construcción, porque
 * ninguna consulta de este archivo recorre el árbol hacia abajo.
 *
 * DEGRADACIÓN: si sql/afiliados-bonos-red.sql no está aplicado, todo aquí
 * devuelve "apagado" (config null, conteos en 0, cero awards) y nada lanza. Un
 * panel sin el bloque de bonos es preferible a un 500.
 *
 * PRIVACIDAD: de la red del afiliado solo salen CONTEOS. Ni un nombre, ni un
 * plan, ni un correo de las clínicas que trajeron sus invitados — y jamás las
 * comisiones ni los datos de pago de los invitados mismos.
 */
import { prisma } from "@/lib/prisma";
import { activeClinicWhere } from "./stats";
import { paidInvoiceCountByClinic } from "./milestones-progress";
import { MIN_PAID_INVOICES, clinicQualifies } from "./qualifying-clinic";
import {
  DEFAULT_NETWORK_BONUS,
  NETWORK_BONUS_CLINIC_ID,
  NETWORK_BONUS_KIND,
  buildNetworkBonusView,
  commissionRefOnce,
  decideNetworkSweep,
  networkBonusTiers,
  normalizeAwardStatus,
  normalizeNetworkBonus,
  periodKey,
  type AwardSnapshot,
  type NetworkBonusConfig,
  type NetworkBonusTier,
  type NetworkBonusView,
  type NetworkSweepAction,
} from "./network-bonus-core";

export * from "./network-bonus-core";

/**
 * Las columnas VIVAS de los bonos por red, como `select` de Prisma.
 *
 * ⚠️ NO es un capricho: `getPayoutConfig()` lee la fila id=1 con `findUnique`
 * sin `select`, así que Prisma pide TODAS las columnas del modelo. Si estas no
 * existieran en la BD (SQL sin correr), esa lectura fallaría y el MOTOR DE
 * COMISIONES entero caería al modo "% del nivel" — un cambio silencioso de
 * cuánto se le paga a cada afiliado. Por eso payout.ts acota sus SELECT a sus
 * propias columnas y los bonos de red leen aparte, con este `select`: un
 * deploy adelantado al SQL apaga los bonos y no toca nada más.
 *
 * Las cinco `networkTier<N>MonthlyMxn` NO se piden: la modalidad mensual se
 * retiró (ago 2026) y sus columnas quedaron en 0 y sin uso.
 */
const NETWORK_SELECT = {
  networkBonusEnabled: true,
  networkTier1Clinics: true,
  networkTier1OnceMxn: true,
  networkTier2Clinics: true,
  networkTier2OnceMxn: true,
  networkTier3Clinics: true,
  networkTier3OnceMxn: true,
  networkTier4Clinics: true,
  networkTier4OnceMxn: true,
  networkTier5Clinics: true,
  networkTier5OnceMxn: true,
} as const;

/**
 * Config de los bonos por red (fila id=1). null SOLO si las columnas no
 * existen todavía → el caller apaga el bloque. Tabla viva sin fila = defaults.
 */
export async function getNetworkBonusConfig(): Promise<NetworkBonusConfig | null> {
  try {
    const row = await prisma.affiliatePayoutConfig.findUnique({
      where: { id: 1 },
      select: NETWORK_SELECT,
    });
    if (!row) return { ...DEFAULT_NETWORK_BONUS };
    return normalizeNetworkBonus(row);
  } catch {
    return null;
  }
}

/**
 * Escalones vigentes + si el programa está encendido, en una sola lectura.
 * `tiers` vacío = no hay nada que anunciar ni que calcular.
 */
export async function getNetworkBonusTiers(): Promise<{
  cfg: NetworkBonusConfig | null;
  tiers: NetworkBonusTier[];
  enabled: boolean;
}> {
  const cfg = await getNetworkBonusConfig();
  const tiers = cfg ? networkBonusTiers(cfg) : [];
  return { cfg, tiers, enabled: cfg?.networkBonusEnabled === true && tiers.length > 0 };
}

// ── El conteo ─────────────────────────────────────────────────────────────

/** `in` por tandas: evita un IN con decenas de miles de ids. */
const ID_CHUNK = 4000;

export function chunkIds<T>(items: T[], size: number = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Ids de los afiliados que ESTE afiliado invitó. UN salto: no se recorre el
 * árbol, porque las clínicas de los invitados de sus invitados no le cuentan.
 */
export async function getInvitedAffiliateIds(affiliateId: string): Promise<string[]> {
  if (!affiliateId) return [];
  try {
    const rows = await prisma.affiliate.findMany({
      where: { invitedByAffiliateId: affiliateId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  } catch {
    // Columna sin crear (SQL sin correr) → nadie tiene red. Nunca lanza.
    return [];
  }
}

/** Clínicas de esos afiliados, con o sin filtro de actividad. Solo ids. */
async function clinicIdsOfAffiliates(
  affiliateIds: string[],
  now: Date | null,
): Promise<string[]> {
  if (affiliateIds.length === 0) return [];
  const out: string[] = [];
  for (const part of chunkIds(affiliateIds)) {
    const where = now
      ? { AND: [{ affiliateId: { in: part } }, activeClinicWhere(now)] }
      : { affiliateId: { in: part } };
    const rows = await prisma.clinic.findMany({ where, select: { id: true } });
    for (const r of rows) out.push(r.id);
  }
  return out;
}

/**
 * Clínicas de RED que califican HOY para UN afiliado.
 *
 * Red = las que trajeron LOS AFILIADOS QUE ÉL INVITÓ. Las que trajo él mismo
 * NO entran: para esas está el Bono por Clínicas Activas.
 *
 * Se evalúa con `clinicQualifies` — el MISMO predicado de los bonos propios,
 * nunca una segunda definición. Cualquier error degrada a 0: sin bonos, jamás
 * un 500.
 */
export async function getNetworkQualifyingCount(
  affiliateId: string,
  now: Date = new Date(),
): Promise<{ qualifying: number; active: number; attributed: number; invited: number }> {
  const empty = { qualifying: 0, active: 0, attributed: 0, invited: 0 };
  if (!affiliateId) return empty;
  try {
    const invitedIds = await getInvitedAffiliateIds(affiliateId);
    if (invitedIds.length === 0) return empty;

    const allIds = await clinicIdsOfAffiliates(invitedIds, null);
    if (allIds.length === 0) return { ...empty, invited: invitedIds.length };

    const activeIds = await clinicIdsOfAffiliates(invitedIds, now);
    if (activeIds.length === 0) {
      return { ...empty, invited: invitedIds.length, attributed: allIds.length };
    }

    const paidByClinic = await paidInvoiceCountByClinic(activeIds);
    let qualifying = 0;
    for (const id of activeIds) if (clinicQualifies(paidByClinic.get(id))) qualifying += 1;

    return {
      qualifying,
      active: activeIds.length,
      attributed: allIds.length,
      invited: invitedIds.length,
    };
  } catch {
    return empty;
  }
}

/**
 * Lo mismo para TODOS los afiliados de una pasada — lo que necesitan el cron y
 * la alerta anticipada del admin. Agregado, sin N+1: tres queries en total y
 * el cruce en memoria. Un mapa vacío si algo falla.
 *
 * El cruce es de UN salto por construcción: cada clínica se le suma al
 * INVITADOR DIRECTO del afiliado que la trajo, y ahí se detiene. Nada sube al
 * invitador del invitador.
 */
export async function getNetworkQualifyingCounts(
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  try {
    // Todos los afiliados que tienen invitador. `{ not: null }` es la forma
    // correcta de un IS NOT NULL en Prisma (no un NOT sobre un filtro, que sí
    // descartaría los nulls por su cuenta).
    const invited = await prisma.affiliate.findMany({
      where: { invitedByAffiliateId: { not: null } },
      select: { id: true, invitedByAffiliateId: true },
    });
    if (invited.length === 0) return counts;

    const inviterOf = new Map<string, string>();
    for (const a of invited) if (a.invitedByAffiliateId) inviterOf.set(a.id, a.invitedByAffiliateId);

    const invitedIds = Array.from(inviterOf.keys());
    const activeRows: { id: string; affiliateId: string | null }[] = [];
    for (const part of chunkIds(invitedIds)) {
      const rows = await prisma.clinic.findMany({
        where: { AND: [{ affiliateId: { in: part } }, activeClinicWhere(now)] },
        select: { id: true, affiliateId: true },
      });
      for (const r of rows) activeRows.push(r);
    }
    if (activeRows.length === 0) return counts;

    const paidByClinic = await paidInvoiceCountByClinic(activeRows.map((r) => r.id));

    for (const row of activeRows) {
      if (!row.affiliateId) continue;
      const inviterId = inviterOf.get(row.affiliateId);
      if (!inviterId) continue;
      if (!clinicQualifies(paidByClinic.get(row.id))) continue;
      counts.set(inviterId, (counts.get(inviterId) ?? 0) + 1);
    }
  } catch {
    // Columna/tabla ausente o error de BD → nadie califica. Nunca lanza.
  }
  return counts;
}

// ── Los awards ────────────────────────────────────────────────────────────

/** Fila de award reducida a lo que la lógica pura necesita. */
const AWARD_SELECT = {
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
} as const;

export type AwardRow = {
  id: string;
  affiliateId: string;
  tier: number;
  status: string;
  clinics: number;
  onceMxn: number;
  qualifiedSince: Date | null;
  awardedAt: Date | null;
  paidAt: Date | null;
  lastCount: number;
};

function toSnapshot(row: AwardRow): AwardSnapshot {
  return {
    id: row.id,
    tier: row.tier,
    status: normalizeAwardStatus(row.status),
    clinics: Number(row.clinics) || 0,
    onceMxn: Number(row.onceMxn) || 0,
    qualifiedSince: row.qualifiedSince,
    lastCount: Number(row.lastCount) || 0,
  };
}

/** Awards de UN afiliado. Lista vacía si la tabla no existe. */
export async function getAwardsForAffiliate(affiliateId: string): Promise<AwardRow[]> {
  if (!affiliateId) return [];
  try {
    return (await prisma.affiliateNetworkBonusAward.findMany({
      where: { affiliateId },
      select: AWARD_SELECT,
      orderBy: { tier: "asc" },
    })) as AwardRow[];
  } catch {
    return [];
  }
}

export interface NetworkBonusPanel {
  /** false = programa apagado, sin escalones o SQL sin correr → no se pinta. */
  enabled: boolean;
  view: NetworkBonusView;
  /** Cuántos afiliados invitó. */
  invited: number;
  /** Clínicas traídas por sus invitados, activas o no (para explicar). */
  attributed: number;
  /** De esas, cuántas están activas hoy. */
  active: number;
  /** Mensualidades que exige la cláusula (el afiliado ve el mismo número). */
  minPaidInvoices: number;
  /** Filas completas, para pintar fechas y estados. */
  awards: AwardRow[];
}

/**
 * Todo lo que el panel del afiliado necesita, en una llamada.
 * `affiliateId` SIEMPRE de la sesión (getAffiliateContext), jamás del request.
 *
 * NO se cachea: son unas pocas lecturas pequeñas y un número congelado en un
 * progreso personal se siente roto ("ya vendió mi invitado y sigo en 11"). Si
 * algún día pesa, `unstable_cache` con tag por afiliado — el conteo global del
 * admin es el que primero lo pediría, no este.
 */
export async function getNetworkBonusPanel(
  affiliateId: string,
  now: Date = new Date(),
): Promise<NetworkBonusPanel> {
  const { tiers, enabled } = await getNetworkBonusTiers();
  const [counts, awards] = await Promise.all([
    getNetworkQualifyingCount(affiliateId, now),
    getAwardsForAffiliate(affiliateId),
  ]);
  const snapshots = awards.map(toSnapshot);
  return {
    enabled,
    view: buildNetworkBonusView(counts.qualifying, tiers, snapshots, now),
    invited: counts.invited,
    attributed: counts.attributed,
    active: counts.active,
    minPaidInvoices: MIN_PAID_INVOICES,
    awards,
  };
}

// ── El barrido mensual (lo ejecuta el cron) ───────────────────────────────

export interface SweepSummary {
  /** false = programa apagado o SQL sin correr; no se tocó nada. */
  ran: boolean;
  affiliates: number;
  started: number;
  refreshed: number;
  resets: number;
  awarded: number;
  /** Lo que sumaron los bonos otorgados en esta corrida. */
  awardedMxn: number;
  /** Bonos que el candado rechazó por duplicados (debería ser 0). */
  duplicatesBlocked: number;
  errors: number;
  periodKey: string;
  /** Awards recién otorgados: el cron les manda correo. */
  awardedIds: string[];
}

const EMPTY_SUMMARY = (key: string): SweepSummary => ({
  ran: false,
  affiliates: 0,
  started: 0,
  refreshed: 0,
  resets: 0,
  awarded: 0,
  awardedMxn: 0,
  duplicatesBlocked: 0,
  errors: 0,
  periodKey: key,
  awardedIds: [],
});

/**
 * Una pasada completa: recalcula la red de cada afiliado, mueve los awards y
 * genera la comisión de los escalones que se otorgan.
 *
 * IDEMPOTENTE POR CONSTRUCCIÓN. Correrlo dos veces no paga doble y el segundo
 * intento no es "casi inofensivo": cada bono se escribe junto a una comisión
 * cuya referencia `netbonus:<award>:once` choca con el índice único de
 * affiliate_commissions. Como las dos escrituras van en la MISMA $transaction,
 * el choque revierte también el cambio de estado del award. El WHERE con
 * `status: "tracking"` es solo el filtro barato que evita intentarlo.
 *
 * Se procesa afiliado por afiliado (no en paralelo) a propósito: son pocas
 * filas al mes y PgBouncer agradece no abrir seis transacciones a la vez.
 */
export async function runNetworkBonusSweep(now: Date = new Date()): Promise<SweepSummary> {
  const key = periodKey(now);
  const summary = EMPTY_SUMMARY(key);

  const { tiers, enabled } = await getNetworkBonusTiers();
  if (!enabled) return summary;

  let allAwards: AwardRow[] = [];
  try {
    allAwards = (await prisma.affiliateNetworkBonusAward.findMany({
      select: AWARD_SELECT,
    })) as AwardRow[];
  } catch {
    // Tabla sin crear: no hay nada que barrer y no se inventa nada.
    return summary;
  }

  const counts = await getNetworkQualifyingCounts(now);

  // Universo = quien hoy tiene red que califica + quien ya tiene algún award
  // (aunque su red haya caído a 0: hay que refrescarles el conteo observado).
  const awardsByAffiliate = new Map<string, AwardRow[]>();
  for (const a of allAwards) {
    const list = awardsByAffiliate.get(a.affiliateId);
    if (list) list.push(a);
    else awardsByAffiliate.set(a.affiliateId, [a]);
  }
  const affiliateIds: string[] = [];
  counts.forEach((_n, id) => affiliateIds.push(id));
  awardsByAffiliate.forEach((_rows, id) => {
    if (!counts.has(id)) affiliateIds.push(id);
  });

  summary.ran = true;
  summary.affiliates = affiliateIds.length;

  for (const affiliateId of affiliateIds) {
    const count = counts.get(affiliateId) ?? 0;
    const rows = awardsByAffiliate.get(affiliateId) ?? [];
    const actions = decideNetworkSweep({
      count,
      tiers,
      awards: rows.map(toSnapshot),
      now,
    });
    for (const action of actions) {
      try {
        await applySweepAction(affiliateId, action, count, now, summary);
      } catch (err: any) {
        if (err?.code === "P2002") {
          // El candado hizo su trabajo: ese bono ya existía.
          summary.duplicatesBlocked += 1;
        } else {
          summary.errors += 1;
          console.error("[network-bonus] sweep", affiliateId, action.type, err);
        }
      }
    }
  }

  return summary;
}

/** Ejecuta UNA acción del plan. Lanza para que el caller la contabilice. */
async function applySweepAction(
  affiliateId: string,
  action: NetworkSweepAction,
  count: number,
  now: Date,
  summary: SweepSummary,
): Promise<void> {
  switch (action.type) {
    case "start-tracking": {
      await prisma.affiliateNetworkBonusAward.create({
        data: {
          affiliateId,
          tier: action.tier,
          clinics: action.clinics,
          onceMxn: action.onceMxn,
          monthlyMxn: 0,
          status: "tracking",
          qualifiedSince: now,
          lastCount: count,
        },
      });
      summary.started += 1;
      return;
    }

    case "refresh-tracking": {
      await prisma.affiliateNetworkBonusAward.update({
        where: { id: action.awardId },
        data: {
          clinics: action.clinics,
          onceMxn: action.onceMxn,
          qualifiedSince: action.qualifiedSince,
          lastCount: count,
        },
      });
      summary.refreshed += 1;
      return;
    }

    case "reset-streak": {
      await prisma.affiliateNetworkBonusAward.update({
        where: { id: action.awardId },
        data: { qualifiedSince: null, lastCount: count },
      });
      summary.resets += 1;
      return;
    }

    case "award": {
      // Aquí se CONGELAN los montos y se genera el PAGO ÚNICO. Las DOS
      // escrituras en una sola transacción: si la comisión choca con el índice
      // único, el award tampoco avanza y el escalón queda intacto para el mes
      // siguiente. El WHERE repite el estado para que dos corridas simultáneas
      // no otorguen el mismo escalón dos veces.
      const awarded = await prisma.$transaction(async (tx) => {
        const updated = await tx.affiliateNetworkBonusAward.updateMany({
          where: { id: action.awardId, status: "tracking" },
          data: {
            status: "awarded",
            clinics: action.clinics,
            onceMxn: action.onceMxn,
            awardedAt: now,
            paidAt: now,
            lastCount: count,
          },
        });
        if (updated.count === 0) return false;
        await tx.affiliateCommission.create({
          data: {
            affiliateId,
            clinicId: NETWORK_BONUS_CLINIC_ID,
            stripeInvoiceId: commissionRefOnce(action.awardId),
            amountMxn: 0,
            commissionMxn: action.onceMxn,
            kind: NETWORK_BONUS_KIND,
            monthsCovered: 1,
            status: "pending",
          },
        });
        return true;
      });
      if (awarded) {
        summary.awarded += 1;
        summary.awardedMxn += action.onceMxn;
        summary.awardedIds.push(action.awardId);
      }
      return;
    }

    case "touch": {
      await prisma.affiliateNetworkBonusAward.update({
        where: { id: action.awardId },
        data: { lastCount: count },
      });
      return;
    }
  }
}
