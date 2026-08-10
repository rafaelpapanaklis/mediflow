/**
 * Afiliados — BONOS POR RED: la lógica PURA (client-safe, testeable).
 *
 * QUÉ PREMIA
 * Las clínicas ACTIVAS que trajeron los VENDEDORES del afiliado — no las que
 * trajo él mismo: para esas ya existe el "Bono por Clínicas Activas"
 * (./payout-core → MilestonesConfig). Aquí el afiliado cobra por el resultado
 * de su equipo, y "resultado" significa clínicas que PAGAN un producto, jamás
 * personas reclutadas. Esa distinción es la que separa un programa de ventas
 * de un esquema piramidal y por eso también gobierna el copy.
 *
 * QUÉ CUENTA — el MISMO criterio que los bonos propios, importado de
 * ./qualifying-clinic (nunca reescrito): clínica activa con al menos
 * MIN_PAID_INVOICES mensualidades pagadas. Además, aquí:
 *   · el conteo es SIMULTÁNEO (cuántas hay hoy, no cuántas hubo);
 *   · debe SOSTENERSE SUSTAIN_MONTHS meses antes de otorgar;
 *   · cada escalón se otorga UNA vez por afiliado (índice único en el DDL).
 *
 * LAS DOS FORMAS DE COBRO
 * Al otorgarse, el award nace en `pending_choice` con los dos montos
 * CONGELADOS y NO paga nada hasta que el afiliado elija:
 *   · "once"    → una sola comisión y el escalón queda cerrado.
 *   · "monthly" → una comisión al mes MIENTRAS sostenga el número.
 * La elección es definitiva por escalón; los escalones son acumulables y cada
 * uno se elige por separado.
 *
 * POR QUÉ ESTE ARCHIVO NO TOCA PRISMA
 * Todo lo que decide dinero vive aquí como funciones puras —sobre todo
 * `decideNetworkSweep`, el cerebro del cron— para poder martillearlo con
 * `npm run test:bonos-red` sin una base de datos. Los helpers con BD viven en
 * ./network-bonus. Mismo corte que payout-core.ts / payout.ts.
 */
import { MIN_PAID_INVOICES } from "./qualifying-clinic";
// El redondeo a centavos NO se reescribe aquí: es el mismo de todo el módulo de
// afiliados. Dos funciones de redondear dinero es la forma más tonta de que una
// pantalla diga $1,875.00 y otra $1,874.99 sobre el mismo award.
import { roundMxn } from "./payout-core";

export { MIN_PAID_INVOICES, roundMxn };

/**
 * Meses SEGUIDOS que el conteo debe sostenerse antes de otorgar un escalón.
 * Es la misma cláusula publicada para los bonos propios ("El conteo debe
 * sostenerse 3 meses seguidos"), por eso el número vive exportado: el copy de
 * /terminos-afiliados y del panel lo lee de aquí en vez de teclear un "3".
 */
export const SUSTAIN_MONTHS = 3;

/** Cuántos escalones tiene el programa. Fijo: son 5 columnas en el DDL. */
export const NETWORK_TIER_COUNT = 5;

// ── Config (las 16 columnas de sql/afiliados-bonos-red.sql) ───────────────

export interface NetworkBonusConfig {
  networkBonusEnabled: boolean;
  networkTier1Clinics: number;
  networkTier1OnceMxn: number;
  networkTier1MonthlyMxn: number;
  networkTier2Clinics: number;
  networkTier2OnceMxn: number;
  networkTier2MonthlyMxn: number;
  networkTier3Clinics: number;
  networkTier3OnceMxn: number;
  networkTier3MonthlyMxn: number;
  networkTier4Clinics: number;
  networkTier4OnceMxn: number;
  networkTier4MonthlyMxn: number;
  networkTier5Clinics: number;
  networkTier5OnceMxn: number;
  networkTier5MonthlyMxn: number;
}

/** Defaults = los mismos DEFAULT del DDL (sql/afiliados-bonos-red.sql). */
export const DEFAULT_NETWORK_BONUS: NetworkBonusConfig = {
  networkBonusEnabled: true,
  networkTier1Clinics: 5,
  networkTier1OnceMxn: 3000,
  networkTier1MonthlyMxn: 375,
  networkTier2Clinics: 20,
  networkTier2OnceMxn: 15000,
  networkTier2MonthlyMxn: 1875,
  networkTier3Clinics: 50,
  networkTier3OnceMxn: 40000,
  networkTier3MonthlyMxn: 5000,
  networkTier4Clinics: 150,
  networkTier4OnceMxn: 120000,
  networkTier4MonthlyMxn: 15000,
  networkTier5Clinics: 500,
  networkTier5OnceMxn: 400000,
  networkTier5MonthlyMxn: 50000,
};

/** Las 5 ternas (umbral, único, mensual) tal como están guardadas. */
export const NETWORK_TIER_KEYS: {
  n: number;
  clinics: keyof NetworkBonusConfig;
  once: keyof NetworkBonusConfig;
  monthly: keyof NetworkBonusConfig;
}[] = [
  { n: 1, clinics: "networkTier1Clinics", once: "networkTier1OnceMxn", monthly: "networkTier1MonthlyMxn" },
  { n: 2, clinics: "networkTier2Clinics", once: "networkTier2OnceMxn", monthly: "networkTier2MonthlyMxn" },
  { n: 3, clinics: "networkTier3Clinics", once: "networkTier3OnceMxn", monthly: "networkTier3MonthlyMxn" },
  { n: 4, clinics: "networkTier4Clinics", once: "networkTier4OnceMxn", monthly: "networkTier4MonthlyMxn" },
  { n: 5, clinics: "networkTier5Clinics", once: "networkTier5OnceMxn", monthly: "networkTier5MonthlyMxn" },
];

/**
 * Normaliza cualquier fila/objeto al shape NetworkBonusConfig. Un campo
 * ausente o no finito cae a su default: nunca lanza y nunca inventa un número
 * que no esté en el DDL.
 */
export function normalizeNetworkBonus(
  row: Partial<NetworkBonusConfig> | null | undefined,
): NetworkBonusConfig {
  const r = row ?? {};
  const num = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const out: NetworkBonusConfig = {
    ...DEFAULT_NETWORK_BONUS,
    networkBonusEnabled: r.networkBonusEnabled !== false,
  };
  for (const key of NETWORK_TIER_KEYS) {
    out[key.clinics] = Math.round(num(r[key.clinics], DEFAULT_NETWORK_BONUS[key.clinics] as number)) as never;
    out[key.once] = num(r[key.once], DEFAULT_NETWORK_BONUS[key.once] as number) as never;
    out[key.monthly] = num(r[key.monthly], DEFAULT_NETWORK_BONUS[key.monthly] as number) as never;
  }
  return out;
}

/** Un escalón ya resuelto: "20 clínicas de red → $15,000 o $1,875 al mes". */
export interface NetworkBonusTier {
  /** 1..5 — el orden EN LA CONFIG, no en la pantalla. */
  n: number;
  clinics: number;
  onceMxn: number;
  monthlyMxn: number;
}

/**
 * Escalones publicables: se descarta el que tenga umbral en 0 o los DOS montos
 * en 0 (así se apaga UN escalón sin apagar los cinco) y se ordenan por umbral
 * ascendente, que es como se leen. El switch `networkBonusEnabled` NO se mira
 * aquí: eso lo decide cada superficie.
 *
 * Un escalón con un solo monto en 0 SÍ sale: significa que esa modalidad no se
 * ofrece, y la UI lo trata como "solo pago único" / "solo mensual".
 */
export function networkBonusTiers(cfg: NetworkBonusConfig): NetworkBonusTier[] {
  const tiers: NetworkBonusTier[] = [];
  for (const key of NETWORK_TIER_KEYS) {
    const clinics = Math.round(Number(cfg[key.clinics]));
    const onceMxn = Number(cfg[key.once]);
    const monthlyMxn = Number(cfg[key.monthly]);
    if (!Number.isFinite(clinics) || clinics <= 0) continue;
    const once = Number.isFinite(onceMxn) && onceMxn > 0 ? onceMxn : 0;
    const monthly = Number.isFinite(monthlyMxn) && monthlyMxn > 0 ? monthlyMxn : 0;
    if (once <= 0 && monthly <= 0) continue;
    tiers.push({ n: key.n, clinics, onceMxn: once, monthlyMxn: monthly });
  }
  return tiers.sort((a, b) => a.clinics - b.clinics);
}

// ── La comparación honesta entre las dos formas de cobro ──────────────────

export interface ChoiceComparison {
  /** Meses en los que el mensual IGUALA al pago único. null si no aplica. */
  monthsToMatch: number | null;
  /** Primer mes en el que el mensual SUPERA al pago único. null si no aplica. */
  monthsToBeat: number | null;
  /** Lo que suma el mensual en un año (12 × monthlyMxn). */
  monthlyYearlyMxn: number;
  /** ¿Están las dos opciones realmente disponibles? */
  bothAvailable: boolean;
}

/**
 * Cuánto tarda el mensual en alcanzar al pago único. Es LA cifra que decide la
 * elección y por eso se calcula, jamás se teclea: con los montos por defecto
 * (mensual = único / 8) da 8 meses para igualar y 9 para superar.
 *
 * Con cualquiera de los dos montos en 0 no hay comparación posible (solo se
 * ofrece una modalidad) y devuelve nulls.
 */
export function compareChoices(onceMxn: number, monthlyMxn: number): ChoiceComparison {
  const once = Number.isFinite(onceMxn) && onceMxn > 0 ? onceMxn : 0;
  const monthly = Number.isFinite(monthlyMxn) && monthlyMxn > 0 ? monthlyMxn : 0;
  const bothAvailable = once > 0 && monthly > 0;
  return {
    monthsToMatch: bothAvailable ? Math.ceil(once / monthly) : null,
    // "Superar" es estricto: si el mensual iguala exacto en el mes 8, lo supera
    // en el 9. Con un cociente no entero (7.3) iguala y supera en el mismo mes.
    monthsToBeat: bothAvailable
      ? Number.isInteger(once / monthly)
        ? once / monthly + 1
        : Math.ceil(once / monthly)
      : null,
    monthlyYearlyMxn: roundMxn(monthly * 12),
    bothAvailable,
  };
}

/**
 * "Va cerca": a partir de qué fracción del umbral un afiliado entra en la
 * ALERTA ANTICIPADA del admin (/api/admin/affiliates/network-bonus).
 *
 * NO es una regla del programa —nadie cobra ni deja de cobrar por este número—
 * es el corte con el que Rafael ve venir una salida grande. Vive aquí, junto a
 * la matemática del bono, porque la bandeja y cualquier futura alerta por
 * correo tienen que usar el mismo corte: dos avisos con umbrales distintos
 * sobre el mismo afiliado se leen como un error del sistema.
 */
export const NEAR_RATIO = 0.8;

// ── El award y su ciclo de vida ───────────────────────────────────────────

/**
 * tracking       — en el umbral, contando los SUSTAIN_MONTHS. No paga nada.
 * pending_choice — otorgado; espera la elección. NO PAGA NADA todavía.
 * once_paid      — eligió pago único; la comisión ya se generó. Cerrado.
 * monthly_active — eligió mensual; el cron genera una comisión al mes.
 * monthly_paused — eligió mensual y su red cayó del umbral. Se reactiva solo.
 */
export type NetworkAwardStatus =
  | "tracking"
  | "pending_choice"
  | "once_paid"
  | "monthly_active"
  | "monthly_paused";

export type NetworkBonusChoice = "once" | "monthly";

export const NETWORK_AWARD_STATUS_LABELS: Record<NetworkAwardStatus, string> = {
  tracking: "Sosteniendo el número",
  pending_choice: "Te falta elegir",
  once_paid: "Pago único entregado",
  monthly_active: "Mensual activo",
  monthly_paused: "Mensual en pausa",
};

export const NETWORK_CHOICE_LABELS: Record<NetworkBonusChoice, string> = {
  once: "Un solo pago",
  monthly: "Mensual",
};

/** Normaliza cualquier string a NetworkAwardStatus (desconocido → tracking). */
export function normalizeAwardStatus(value: unknown): NetworkAwardStatus {
  return value === "pending_choice" ||
    value === "once_paid" ||
    value === "monthly_active" ||
    value === "monthly_paused"
    ? value
    : "tracking";
}

/** Normaliza la elección. Cualquier cosa que no sea "monthly" es "once"… */
export function normalizeChoice(value: unknown): NetworkBonusChoice | null {
  return value === "once" || value === "monthly" ? value : null;
}

/** Lo mínimo que `decideNetworkSweep` necesita saber de un award guardado. */
export interface AwardSnapshot {
  id: string;
  tier: number;
  status: NetworkAwardStatus;
  clinics: number;
  onceMxn: number;
  monthlyMxn: number;
  qualifiedSince: Date | null;
  lastMonthlyKey: string | null;
  lastCount: number;
}

// ── El candado de idempotencia ────────────────────────────────────────────

/** `kind` con el que los bonos entran a affiliate_commissions. */
export const NETWORK_BONUS_KIND = "network_bonus";

/**
 * `clinicId` de la comisión de un bono. Un bono NO nace de una clínica
 * concreta, pero la columna es NOT NULL: se guarda vacío y cada superficie que
 * pinta el nombre de la clínica ramifica por `kind`.
 */
export const NETWORK_BONUS_CLINIC_ID = "";

/**
 * Mes de referencia en UTC ("2026-09"). El cron corre el día 1, así que el mes
 * del reloj y el mes que se paga son el mismo. UTC y no hora local para que
 * dos ejecuciones a los lados de la medianoche no caigan en meses distintos.
 */
export function periodKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  return `${y}-${m < 10 ? "0" : ""}${m}`;
}

/**
 * EL CANDADO. `affiliate_commissions."stripeInvoiceId"` es UNIQUE, así que
 * escribir la referencia del bono es lo que hace imposible pagar dos veces el
 * mismo mes — aunque el cron corra dos veces, aunque corran dos instancias a
 * la vez, aunque el award se quede a medio actualizar. No hay ninguna otra
 * defensa que dependa de leer-antes-de-escribir, porque esa carrera se pierde.
 */
export function commissionRefMonthly(awardId: string, key: string): string {
  return `netbonus:${awardId}:${key}`;
}

/** Misma idea para el pago único: una sola comisión por award, para siempre. */
export function commissionRefOnce(awardId: string): string {
  return `netbonus:${awardId}:once`;
}

// ── El reloj de los meses sostenidos ──────────────────────────────────────

/**
 * Meses de CALENDARIO completos entre dos fechas (UTC). Un mes se cuenta solo
 * cuando se cumple el mismo día del mes: del 15 de enero al 14 de febrero van
 * 0 meses, al 15 van 1.
 *
 * Redondea SIEMPRE hacia abajo, y en el caso raro de un `qualifiedSince` en
 * día 29-31 puede tardar un día más de la cuenta en meses cortos. Es el
 * sentido correcto del error: retrasar un bono se corrige solo al mes
 * siguiente; adelantarlo es dinero que ya salió. Con el cron mensual (día 1)
 * el caso ni se presenta.
 */
export function monthsElapsed(from: Date | null | undefined, to: Date): number {
  if (!(from instanceof Date) || !(to instanceof Date)) return 0;
  const a = from.getTime();
  const b = to.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** ¿La racha ya cumplió los SUSTAIN_MONTHS? */
export function isSustained(qualifiedSince: Date | null | undefined, now: Date): boolean {
  return monthsElapsed(qualifiedSince, now) >= SUSTAIN_MONTHS;
}

/** Meses que le faltan a una racha para otorgar (0 = ya está). */
export function monthsLeftToAward(qualifiedSince: Date | null | undefined, now: Date): number {
  return Math.max(0, SUSTAIN_MONTHS - monthsElapsed(qualifiedSince, now));
}

// ── El cerebro del cron ───────────────────────────────────────────────────

export type NetworkSweepAction =
  /** Alcanzó el umbral por primera vez: nace la fila y arranca el reloj. */
  | { type: "start-tracking"; tier: number; clinics: number; onceMxn: number; monthlyMxn: number }
  /** Sigue en el umbral sin cumplir los 3 meses: montos vivos, misma racha. */
  | { type: "refresh-tracking"; awardId: string; clinics: number; onceMxn: number; monthlyMxn: number; qualifiedSince: Date }
  /** Cayó del umbral mientras contaba: el reloj se reinicia desde cero. */
  | { type: "reset-streak"; awardId: string }
  /** 3 meses cumplidos: se otorga y los montos QUEDAN CONGELADOS aquí. */
  | { type: "award"; awardId: string; tier: number; clinics: number; onceMxn: number; monthlyMxn: number }
  /** Mensualidad del mes `periodKey`. La referencia es el candado. */
  | { type: "pay-monthly"; awardId: string; tier: number; periodKey: string; monthlyMxn: number }
  /** Su red cayó del umbral: deja de cobrar (no lo pierde). */
  | { type: "pause"; awardId: string; tier: number }
  /** Volvió al umbral: cobra otra vez. */
  | { type: "resume"; awardId: string; tier: number }
  /** Solo cambió el conteo observado — es lo que explica una pausa. */
  | { type: "touch"; awardId: string };

export interface SweepInput {
  /** Clínicas de RED que califican HOY (el número recién calculado). */
  count: number;
  /** Escalones vigentes (networkBonusTiers de la config). */
  tiers: NetworkBonusTier[];
  /** Los awards que ese afiliado ya tiene, en cualquier estado. */
  awards: AwardSnapshot[];
  now: Date;
}

/**
 * Decide TODO lo que hay que hacerle a los awards de UN afiliado en una
 * corrida. Pura a propósito: es donde un bug cuesta dinero real, así que se
 * prueba sin BD y el aplicador de ./network-bonus solo ejecuta.
 *
 * Reglas que aquí se hacen explícitas:
 *  · `pending_choice` NO se toca: mientras no elija, no se paga nada. Tampoco
 *    se revoca si su red baja — ya se ganó con 3 meses sostenidos.
 *  · `once_paid` está cerrado para siempre: jamás una segunda comisión.
 *  · El mensual paga UNA vez por `periodKey`; si `lastMonthlyKey` ya es el mes
 *    en curso no se emite nada (y si aun así se emitiera, el índice único de
 *    la comisión lo rechazaría).
 *  · Pausa y reactivación son simétricas y no cuestan un nuevo periodo de
 *    3 meses: el trato es "mientras sostengas".
 */
export function decideNetworkSweep(input: SweepInput): NetworkSweepAction[] {
  const actions: NetworkSweepAction[] = [];
  const count = Number.isFinite(input.count) ? Math.max(0, Math.floor(input.count)) : 0;
  const now = input.now;
  const key = periodKey(now);

  const byTier = new Map<number, AwardSnapshot>();
  for (const a of input.awards) byTier.set(a.tier, a);

  for (const tier of input.tiers) {
    const reached = count >= tier.clinics;
    const award = byTier.get(tier.n);

    if (!award) {
      if (reached) {
        actions.push({
          type: "start-tracking",
          tier: tier.n,
          clinics: tier.clinics,
          onceMxn: tier.onceMxn,
          monthlyMxn: tier.monthlyMxn,
        });
      }
      continue;
    }

    switch (award.status) {
      case "tracking": {
        if (!reached) {
          // Solo se escribe si había algo que reiniciar: un afiliado lejos del
          // umbral no debe generar un UPDATE cada mes.
          if (award.qualifiedSince !== null) actions.push({ type: "reset-streak", awardId: award.id });
          else if (award.lastCount !== count) actions.push({ type: "touch", awardId: award.id });
          break;
        }
        if (award.qualifiedSince === null) {
          // Vuelve al umbral tras haberlo perdido: el reloj arranca de nuevo.
          actions.push({
            type: "refresh-tracking",
            awardId: award.id,
            clinics: tier.clinics,
            onceMxn: tier.onceMxn,
            monthlyMxn: tier.monthlyMxn,
            qualifiedSince: now,
          });
          break;
        }
        if (isSustained(award.qualifiedSince, now)) {
          // AQUÍ se congelan los montos: los vigentes en el instante de
          // otorgar. Editar la config después ya no los mueve.
          actions.push({
            type: "award",
            awardId: award.id,
            tier: tier.n,
            clinics: tier.clinics,
            onceMxn: tier.onceMxn,
            monthlyMxn: tier.monthlyMxn,
          });
        } else {
          actions.push({
            type: "refresh-tracking",
            awardId: award.id,
            clinics: tier.clinics,
            onceMxn: tier.onceMxn,
            monthlyMxn: tier.monthlyMxn,
            qualifiedSince: award.qualifiedSince,
          });
        }
        break;
      }

      case "pending_choice":
      case "once_paid": {
        if (award.lastCount !== count) actions.push({ type: "touch", awardId: award.id });
        break;
      }

      case "monthly_active": {
        if (!reached) {
          actions.push({ type: "pause", awardId: award.id, tier: tier.n });
          break;
        }
        if (award.lastMonthlyKey !== key && award.monthlyMxn > 0) {
          actions.push({
            type: "pay-monthly",
            awardId: award.id,
            tier: tier.n,
            periodKey: key,
            monthlyMxn: award.monthlyMxn,
          });
        } else if (award.lastCount !== count) {
          actions.push({ type: "touch", awardId: award.id });
        }
        break;
      }

      case "monthly_paused": {
        if (!reached) {
          if (award.lastCount !== count) actions.push({ type: "touch", awardId: award.id });
          break;
        }
        actions.push({ type: "resume", awardId: award.id, tier: tier.n });
        if (award.lastMonthlyKey !== key && award.monthlyMxn > 0) {
          actions.push({
            type: "pay-monthly",
            awardId: award.id,
            tier: tier.n,
            periodKey: key,
            monthlyMxn: award.monthlyMxn,
          });
        }
        break;
      }
    }
  }

  return actions;
}

// ── Proyección para el panel ──────────────────────────────────────────────

export interface NetworkTierView extends NetworkBonusTier {
  /** El award guardado de este escalón, si existe. */
  award: AwardSnapshot | null;
  /** ¿El conteo de HOY llega al umbral? (independiente del award). */
  reachedNow: boolean;
  /** Meses que le faltan a la racha; null si no hay racha en curso. */
  monthsLeft: number | null;
  /** Meses de racha ya cumplidos; null si no hay racha en curso. */
  monthsSustained: number | null;
  comparison: ChoiceComparison;
}

export interface NetworkBonusView {
  /** Clínicas de red que califican hoy. */
  count: number;
  tiers: NetworkTierView[];
  /** El primer escalón que aún no alcanza; null si los alcanzó todos. */
  next: NetworkTierView | null;
  /** Cuántas le faltan para `next` (0 si no hay siguiente). */
  missing: number;
  /** Awards esperando elección: es lo más importante del panel. */
  pending: NetworkTierView[];
  /** Ya elegidos (once_paid / monthly_active / monthly_paused). */
  chosen: NetworkTierView[];
  /** Lo que hoy le suman los mensuales activos, al mes. */
  monthlyActiveMxn: number;
  /** Lo que ya se le generó en pagos únicos. */
  oncePaidMxn: number;
}

/**
 * Arma lo que el panel pinta, sin BD y sin decidir nada: cruza el conteo vivo
 * con los awards guardados. Deliberadamente NO "adelanta" estados — si el cron
 * todavía no ha visto al afiliado en el umbral, la vista lo dice en vez de
 * fingir una racha que nadie registró.
 */
export function buildNetworkBonusView(
  count: number,
  tiers: NetworkBonusTier[],
  awards: AwardSnapshot[],
  now: Date,
): NetworkBonusView {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const byTier = new Map<number, AwardSnapshot>();
  for (const a of awards) byTier.set(a.tier, a);

  const views: NetworkTierView[] = tiers.map((t) => {
    const award = byTier.get(t.n) ?? null;
    const streak = award && award.status === "tracking" ? award.qualifiedSince : null;
    return {
      ...t,
      award,
      reachedNow: safeCount >= t.clinics,
      monthsLeft: streak ? monthsLeftToAward(streak, now) : null,
      monthsSustained: streak ? monthsElapsed(streak, now) : null,
      // La comparación de un award ya otorgado usa SUS montos congelados, no
      // los vigentes: es lo que se le prometió.
      comparison: award && award.status !== "tracking"
        ? compareChoices(award.onceMxn, award.monthlyMxn)
        : compareChoices(t.onceMxn, t.monthlyMxn),
    };
  });

  const pending: NetworkTierView[] = [];
  const chosen: NetworkTierView[] = [];
  let monthlyActiveMxn = 0;
  let oncePaidMxn = 0;
  for (const v of views) {
    if (!v.award) continue;
    if (v.award.status === "pending_choice") pending.push(v);
    else if (v.award.status !== "tracking") {
      chosen.push(v);
      if (v.award.status === "monthly_active") monthlyActiveMxn += v.award.monthlyMxn;
      if (v.award.status === "once_paid") oncePaidMxn += v.award.onceMxn;
    }
  }

  const next = views.find((v) => safeCount < v.clinics) ?? null;

  return {
    count: safeCount,
    tiers: views,
    next,
    missing: next ? Math.max(0, next.clinics - safeCount) : 0,
    pending,
    chosen,
    monthlyActiveMxn: roundMxn(monthlyActiveMxn),
    oncePaidMxn: roundMxn(oncePaidMxn),
  };
}
