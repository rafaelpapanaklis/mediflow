/**
 * Afiliados — BONOS POR RED: los helpers CON base de datos.
 *
 * La lógica que decide dinero vive en `./network-bonus-core` (pura, testeable
 * sin BD) y este archivo la RE-EXPORTA, así que el server importa todo desde
 * "@/lib/affiliates/network-bonus". Mismo corte que payout-core.ts/payout.ts.
 *
 * DEGRADACIÓN: si sql/afiliados-bonos-red.sql no está aplicado, todo aquí
 * devuelve "apagado" (config null, conteos en 0, cero awards) y nada lanza. Un
 * panel sin el bloque de bonos es preferible a un 500.
 *
 * PRIVACIDAD: de la red del afiliado solo salen CONTEOS. Ni un nombre, ni un
 * plan, ni un correo de las clínicas que trajeron sus vendedores.
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
  commissionRefMonthly,
  commissionRefOnce,
  decideNetworkSweep,
  networkBonusTiers,
  normalizeAwardStatus,
  normalizeNetworkBonus,
  periodKey,
  type AwardSnapshot,
  type NetworkBonusChoice,
  type NetworkBonusConfig,
  type NetworkBonusTier,
  type NetworkBonusView,
  type NetworkSweepAction,
} from "./network-bonus-core";

export * from "./network-bonus-core";

/**
 * Las 16 columnas de los bonos por red, como `select` de Prisma.
 *
 * ⚠️ NO es un capricho: `getPayoutConfig()` lee la fila id=1 con `findUnique`
 * sin `select`, así que Prisma pide TODAS las columnas del modelo. Si estas 16
 * no existieran en la BD (SQL sin correr), esa lectura fallaría y el MOTOR DE
 * COMISIONES entero caería al modo "% del nivel" — un cambio silencioso de
 * cuánto se le paga a cada afiliado. Por eso payout.ts acota sus SELECT a sus
 * propias columnas y los bonos de red leen aparte, con este `select`: un
 * deploy adelantado al SQL apaga los bonos y no toca nada más.
 */
const NETWORK_SELECT = {
  networkBonusEnabled: true,
  networkTier1Clinics: true,
  networkTier1OnceMxn: true,
  networkTier1MonthlyMxn: true,
  networkTier2Clinics: true,
  networkTier2OnceMxn: true,
  networkTier2MonthlyMxn: true,
  networkTier3Clinics: true,
  networkTier3OnceMxn: true,
  networkTier3MonthlyMxn: true,
  networkTier4Clinics: true,
  networkTier4OnceMxn: true,
  networkTier4MonthlyMxn: true,
  networkTier5Clinics: true,
  networkTier5OnceMxn: true,
  networkTier5MonthlyMxn: true,
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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Clínicas de esa lista que están ACTIVAS hoy. Devuelve solo ids (privacidad:
 * de la red del afiliado no sale nada más que el conteo).
 */
async function activeIdsAmong(clinicIds: string[], now: Date): Promise<string[]> {
  if (clinicIds.length === 0) return [];
  const out: string[] = [];
  for (const part of chunk(clinicIds, ID_CHUNK)) {
    const rows = await prisma.clinic.findMany({
      where: { AND: [{ id: { in: part } }, activeClinicWhere(now)] },
      select: { id: true },
    });
    for (const r of rows) out.push(r.id);
  }
  return out;
}

/**
 * Clínicas de RED que califican HOY para UN afiliado.
 *
 * Red = las que trajeron SUS VENDEDORES (AffiliateSellerAttribution, cuyo
 * `affiliateId` es el padre). Las que trajo él mismo NO entran: para esas está
 * el Bono por Clínicas Activas.
 *
 * Tres queries fijas, sin importar cuántos vendedores tenga:
 *  1. las clínicas atribuidas a sus vendedores (solo ids),
 *  2. cuáles de esas siguen activas,
 *  3. los cobros pagados de esas, agregados por clínica.
 *
 * Se evalúa con `clinicQualifies` — el MISMO predicado de los bonos propios,
 * nunca una segunda definición. Cualquier error degrada a 0: sin bonos, jamás
 * un 500.
 */
export async function getNetworkQualifyingCount(
  affiliateId: string,
  now: Date = new Date(),
): Promise<{ qualifying: number; active: number; attributed: number }> {
  const empty = { qualifying: 0, active: 0, attributed: 0 };
  if (!affiliateId) return empty;
  try {
    const attrs = await prisma.affiliateSellerAttribution.findMany({
      where: { affiliateId },
      select: { clinicId: true },
    });
    if (attrs.length === 0) return empty;

    const ids = attrs.map((a) => a.clinicId);
    const activeIds = await activeIdsAmong(ids, now);
    if (activeIds.length === 0) return { ...empty, attributed: ids.length };

    const paidByClinic = await paidInvoiceCountByClinic(activeIds);
    let qualifying = 0;
    for (const id of activeIds) if (clinicQualifies(paidByClinic.get(id))) qualifying += 1;

    return { qualifying, active: activeIds.length, attributed: ids.length };
  } catch {
    return empty;
  }
}

/**
 * Lo mismo para TODOS los afiliados de una pasada — lo que necesitan el cron y
 * la alerta anticipada del admin. Agregado, sin N+1: tres queries en total y
 * el cruce en memoria. Un mapa vacío si algo falla.
 */
export async function getNetworkQualifyingCounts(
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  try {
    const attrs = await prisma.affiliateSellerAttribution.findMany({
      select: { clinicId: true, affiliateId: true },
    });
    if (attrs.length === 0) return counts;

    const activeIds = await activeIdsAmong(attrs.map((a) => a.clinicId), now);
    if (activeIds.length === 0) return counts;

    const activeSet = new Set(activeIds);
    const paidByClinic = await paidInvoiceCountByClinic(activeIds);

    for (const a of attrs) {
      if (!a.affiliateId) continue;
      if (!activeSet.has(a.clinicId)) continue;
      if (!clinicQualifies(paidByClinic.get(a.clinicId))) continue;
      counts.set(a.affiliateId, (counts.get(a.affiliateId) ?? 0) + 1);
    }
  } catch {
    // Tabla ausente o error de BD → nadie califica. Nunca lanza.
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
  monthlyMxn: true,
  qualifiedSince: true,
  awardedAt: true,
  chosenAt: true,
  choice: true,
  paidAt: true,
  lastMonthlyAt: true,
  lastMonthlyKey: true,
  monthlyPaidCount: true,
  pausedAt: true,
  lastCount: true,
} as const;

type AwardRow = {
  id: string;
  affiliateId: string;
  tier: number;
  status: string;
  clinics: number;
  onceMxn: number;
  monthlyMxn: number;
  qualifiedSince: Date | null;
  awardedAt: Date | null;
  chosenAt: Date | null;
  choice: string | null;
  paidAt: Date | null;
  lastMonthlyAt: Date | null;
  lastMonthlyKey: string | null;
  monthlyPaidCount: number;
  pausedAt: Date | null;
  lastCount: number;
};

function toSnapshot(row: AwardRow): AwardSnapshot {
  return {
    id: row.id,
    tier: row.tier,
    status: normalizeAwardStatus(row.status),
    clinics: Number(row.clinics) || 0,
    onceMxn: Number(row.onceMxn) || 0,
    monthlyMxn: Number(row.monthlyMxn) || 0,
    qualifiedSince: row.qualifiedSince,
    lastMonthlyKey: row.lastMonthlyKey,
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
  /** Clínicas atribuidas a sus vendedores, activas o no (para explicar). */
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
 * NO se cachea: son cuatro lecturas pequeñas y un número congelado en un
 * progreso personal se siente roto ("ya vendió mi vendedor y sigo en 11"). Si
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
    attributed: counts.attributed,
    active: counts.active,
    minPaidInvoices: MIN_PAID_INVOICES,
    awards,
  };
}

// ── La elección ───────────────────────────────────────────────────────────

export type ChooseResult =
  | { ok: true; status: "once_paid" | "monthly_active"; commissionMxn: number }
  | { ok: false; error: string; code: 400 | 404 | 409 | 503 };

/** El fallo de `chooseNetworkBonus`, ya estrechado. */
export type ChooseFailure = Extract<ChooseResult, { ok: false }>;

/**
 * ¿La elección falló? Guarda de tipo EXPLÍCITA, y no es ceremonia.
 *
 * El tsconfig del repo corre con `strict: false`, y sin `strictNullChecks`
 * TypeScript NO estrecha una unión por un discriminante booleano: dentro de un
 * `if (!result.ok)` el tipo sigue siendo la unión entera y leer `result.error`
 * ni siquiera compila. Un predicado de tipo funciona igual con `strict` en true
 * o en false, así que la unión conserva lo que promete —nunca leer el error de
 * un resultado exitoso, ni el monto de uno fallido— sin quedar colgada de una
 * bandera del compilador que algún día podría moverse.
 */
export function isChooseFailure(result: ChooseResult): result is ChooseFailure {
  return result.ok === false;
}

/**
 * El afiliado elige cómo cobra UN escalón. DEFINITIVA: solo se acepta sobre un
 * award en `pending_choice`, así que un segundo intento choca con el 409.
 *
 * `affiliateId` va en el WHERE, no solo comprobado después: el award de otro
 * afiliado simplemente no existe para esta consulta.
 *
 * Único   → una comisión `netbonus:<id>:once` y el escalón queda cerrado.
 * Mensual → el award pasa a activo y se genera YA la mensualidad del mes en
 *           curso, para que no espere hasta el próximo corte. El cron usará la
 *           MISMA referencia ese mes, así que el índice único la rechaza y no
 *           puede pagarse dos veces.
 */
export async function chooseNetworkBonus(
  affiliateId: string,
  awardId: string,
  choice: NetworkBonusChoice,
  now: Date = new Date(),
): Promise<ChooseResult> {
  if (!affiliateId || !awardId) return { ok: false, error: "Falta el bono", code: 400 };

  let award: AwardRow | null = null;
  try {
    award = (await prisma.affiliateNetworkBonusAward.findFirst({
      where: { id: awardId, affiliateId },
      select: AWARD_SELECT,
    })) as AwardRow | null;
  } catch {
    return { ok: false, error: "Corre sql/afiliados-bonos-red.sql en Supabase", code: 503 };
  }

  if (!award) return { ok: false, error: "Ese bono no existe", code: 404 };
  if (normalizeAwardStatus(award.status) !== "pending_choice") {
    return {
      ok: false,
      error: "Ese bono ya tiene una forma de cobro elegida y no se puede cambiar",
      code: 409,
    };
  }

  const amount = choice === "once" ? Number(award.onceMxn) : Number(award.monthlyMxn);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Esa forma de cobro no está disponible para este bono", code: 400 };
  }

  const key = periodKey(now);
  const reference = choice === "once" ? commissionRefOnce(award.id) : commissionRefMonthly(award.id, key);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.affiliateCommission.create({
        data: {
          affiliateId,
          clinicId: NETWORK_BONUS_CLINIC_ID,
          stripeInvoiceId: reference,
          amountMxn: 0,
          commissionMxn: amount,
          kind: NETWORK_BONUS_KIND,
          monthsCovered: 1,
          status: "pending",
        },
      });
      // El WHERE repite `status` para que dos clics simultáneos no puedan
      // escribir dos elecciones: el segundo actualiza 0 filas y su comisión
      // ya habría chocado con el índice único de todos modos.
      const updated = await tx.affiliateNetworkBonusAward.updateMany({
        where: { id: award!.id, affiliateId, status: "pending_choice" },
        data:
          choice === "once"
            ? { status: "once_paid", choice: "once", chosenAt: now, paidAt: now }
            : {
                status: "monthly_active",
                choice: "monthly",
                chosenAt: now,
                lastMonthlyAt: now,
                lastMonthlyKey: key,
                monthlyPaidCount: { increment: 1 },
              },
      });
      if (updated.count === 0) throw new Error("race");
    });
  } catch (err: any) {
    // P2002 = la comisión ya existía: alguien eligió primero (doble clic o dos
    // pestañas). No es un error del afiliado, pero tampoco se paga dos veces.
    if (err?.code === "P2002" || err?.message === "race") {
      return { ok: false, error: "Ese bono ya tiene una forma de cobro elegida", code: 409 };
    }
    console.error("[network-bonus] choose", err);
    return { ok: false, error: "No se pudo registrar tu elección", code: 503 };
  }

  return {
    ok: true,
    status: choice === "once" ? "once_paid" : "monthly_active",
    commissionMxn: amount,
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
  monthlyPaid: number;
  monthlyPaidMxn: number;
  paused: number;
  resumed: number;
  /** Mensualidades que el candado rechazó por duplicadas (debería ser 0). */
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
  monthlyPaid: 0,
  monthlyPaidMxn: 0,
  paused: 0,
  resumed: 0,
  duplicatesBlocked: 0,
  errors: 0,
  periodKey: key,
  awardedIds: [],
});

/**
 * Una pasada completa: recalcula la red de cada afiliado, mueve los awards y
 * genera las mensualidades del mes.
 *
 * IDEMPOTENTE POR CONSTRUCCIÓN. Correrlo dos veces el mismo mes no paga doble
 * y el segundo intento no es "casi inofensivo": cada mensualidad se escribe
 * junto a una comisión cuya referencia `netbonus:<award>:<YYYY-MM>` choca con
 * el índice único de affiliate_commissions. Como las dos escrituras van en la
 * MISMA $transaction, el choque revierte también la actualización del award.
 * `lastMonthlyKey` es solo el filtro barato que evita intentarlo.
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
  // (aunque su red haya caído a 0: justo esos son los que hay que pausar).
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
          // El candado hizo su trabajo: esa mensualidad ya existía.
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
          monthlyMxn: action.monthlyMxn,
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
          monthlyMxn: action.monthlyMxn,
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
      // Aquí se CONGELAN los montos. El WHERE repite el estado para que dos
      // corridas simultáneas no otorguen el mismo escalón dos veces.
      const updated = await prisma.affiliateNetworkBonusAward.updateMany({
        where: { id: action.awardId, status: "tracking" },
        data: {
          status: "pending_choice",
          clinics: action.clinics,
          onceMxn: action.onceMxn,
          monthlyMxn: action.monthlyMxn,
          awardedAt: now,
          lastCount: count,
        },
      });
      if (updated.count > 0) {
        summary.awarded += 1;
        summary.awardedIds.push(action.awardId);
      }
      return;
    }

    case "pay-monthly": {
      // Las DOS escrituras en una sola transacción: si la comisión choca con
      // el índice único, el award tampoco avanza y el mes queda intacto.
      await prisma.$transaction(async (tx) => {
        await tx.affiliateCommission.create({
          data: {
            affiliateId,
            clinicId: NETWORK_BONUS_CLINIC_ID,
            stripeInvoiceId: commissionRefMonthly(action.awardId, action.periodKey),
            amountMxn: 0,
            commissionMxn: action.monthlyMxn,
            kind: NETWORK_BONUS_KIND,
            monthsCovered: 1,
            status: "pending",
          },
        });
        await tx.affiliateNetworkBonusAward.update({
          where: { id: action.awardId },
          data: {
            lastMonthlyAt: now,
            lastMonthlyKey: action.periodKey,
            monthlyPaidCount: { increment: 1 },
            lastCount: count,
          },
        });
      });
      summary.monthlyPaid += 1;
      summary.monthlyPaidMxn += action.monthlyMxn;
      return;
    }

    case "pause": {
      await prisma.affiliateNetworkBonusAward.updateMany({
        where: { id: action.awardId, status: "monthly_active" },
        data: { status: "monthly_paused", pausedAt: now, lastCount: count },
      });
      summary.paused += 1;
      return;
    }

    case "resume": {
      await prisma.affiliateNetworkBonusAward.updateMany({
        where: { id: action.awardId, status: "monthly_paused" },
        data: { status: "monthly_active", pausedAt: null, lastCount: count },
      });
      summary.resumed += 1;
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
