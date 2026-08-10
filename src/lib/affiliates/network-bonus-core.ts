/**
 * Afiliados — BONOS POR RED: la lógica PURA (client-safe, testeable).
 *
 * QUÉ PREMIA
 * Las clínicas ACTIVAS que trajeron los AFILIADOS QUE ÉL INVITÓ — no las que
 * trajo él mismo: para esas ya existe el "Bono por Clínicas Activas"
 * (./payout-core → MilestonesConfig).
 *
 * EL MODELO DEL SEGUNDO NIVEL (ago 2026 — reemplaza al de "vendedores")
 * Quien entra por el link de invitación de otro afiliado es un afiliado
 * NORMAL: misma comisión por plan, elige su propia modalidad y gana sus
 * propios bonos. Quien invita NO cobra un peso por las clínicas de su
 * invitado; su único premio son estos bonos por red.
 *
 * UN SOLO NIVEL, y no es negociable: si A invita a B y B invita a C, las
 * clínicas de C cuentan para el bono de B y CERO para A. Nunca se acumula
 * hacia arriba. Es lo que mantiene el programa lejos de un esquema piramidal
 * y lo que hace el costo predecible. Aquí se cumple por construcción: el
 * conteo (./network-bonus) mira `Affiliate.invitedByAffiliateId` a UN salto,
 * jamás recorre el árbol.
 *
 * Y se cobra por CLÍNICAS ACTIVAS QUE PAGAN, jamás por personas reclutadas.
 * Esa distinción gobierna también el copy de /afiliados y /terminos-afiliados.
 *
 * QUÉ CUENTA — el MISMO criterio que los bonos propios, importado de
 * ./qualifying-clinic (nunca reescrito): clínica activa con al menos
 * MIN_PAID_INVOICES mensualidades pagadas. Además, aquí:
 *   · el conteo es SIMULTÁNEO (cuántas hay hoy, no cuántas hubo);
 *   · debe SOSTENERSE SUSTAIN_MONTHS meses antes de otorgar;
 *   · cada escalón se otorga UNA vez por afiliado (índice único en el DDL).
 *
 * CÓMO SE COBRA — PAGO ÚNICO, y punto. Al cumplirse la racha el escalón se
 * otorga y su comisión se genera en la MISMA transacción: no hay pantalla de
 * elección, no hay modalidad mensual y no hay estado intermedio en el que un
 * bono ganado se quede esperando un clic. La modalidad mensual existió hasta
 * ago 2026 y se retiró entera (sus columnas quedan en la BD, en 0 y sin uso).
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

// ── Config (las columnas vivas de sql/afiliados-bonos-red.sql) ────────────
//
// El DDL tiene 16 columnas; aquí solo viven las 11 que se usan. Las cinco
// `networkTier<N>MonthlyMxn` quedaron en 0 y SIN USO al retirarse la modalidad
// mensual: no entran al `select` de getNetworkBonusConfig, no viajan a la UI
// del admin y no se escriben nunca. Deuda de limpieza en ORQUESTA.md.

export interface NetworkBonusConfig {
  networkBonusEnabled: boolean;
  networkTier1Clinics: number;
  networkTier1OnceMxn: number;
  networkTier2Clinics: number;
  networkTier2OnceMxn: number;
  networkTier3Clinics: number;
  networkTier3OnceMxn: number;
  networkTier4Clinics: number;
  networkTier4OnceMxn: number;
  networkTier5Clinics: number;
  networkTier5OnceMxn: number;
}

/** Defaults = los mismos DEFAULT del DDL (sql/afiliados-bonos-red.sql). */
export const DEFAULT_NETWORK_BONUS: NetworkBonusConfig = {
  networkBonusEnabled: true,
  networkTier1Clinics: 5,
  networkTier1OnceMxn: 3000,
  networkTier2Clinics: 20,
  networkTier2OnceMxn: 15000,
  networkTier3Clinics: 50,
  networkTier3OnceMxn: 40000,
  networkTier4Clinics: 150,
  networkTier4OnceMxn: 120000,
  networkTier5Clinics: 500,
  networkTier5OnceMxn: 400000,
};

/** Los 5 pares (umbral, pago único) tal como están guardados. */
export const NETWORK_TIER_KEYS: {
  n: number;
  clinics: keyof NetworkBonusConfig;
  once: keyof NetworkBonusConfig;
}[] = [
  { n: 1, clinics: "networkTier1Clinics", once: "networkTier1OnceMxn" },
  { n: 2, clinics: "networkTier2Clinics", once: "networkTier2OnceMxn" },
  { n: 3, clinics: "networkTier3Clinics", once: "networkTier3OnceMxn" },
  { n: 4, clinics: "networkTier4Clinics", once: "networkTier4OnceMxn" },
  { n: 5, clinics: "networkTier5Clinics", once: "networkTier5OnceMxn" },
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
  }
  return out;
}

/** Un escalón ya resuelto: "20 clínicas de red → $15,000 de pago único". */
export interface NetworkBonusTier {
  /** 1..5 — el orden EN LA CONFIG, no en la pantalla. */
  n: number;
  clinics: number;
  onceMxn: number;
}

/**
 * Escalones publicables: se descarta el que tenga el umbral o el monto en 0
 * (así se apaga UN escalón sin apagar los cinco) y se ordenan por umbral
 * ascendente, que es como se leen. El switch `networkBonusEnabled` NO se mira
 * aquí: eso lo decide cada superficie.
 */
export function networkBonusTiers(cfg: NetworkBonusConfig): NetworkBonusTier[] {
  const tiers: NetworkBonusTier[] = [];
  for (const key of NETWORK_TIER_KEYS) {
    const clinics = Math.round(Number(cfg[key.clinics]));
    const onceMxn = Number(cfg[key.once]);
    if (!Number.isFinite(clinics) || clinics <= 0) continue;
    if (!Number.isFinite(onceMxn) || onceMxn <= 0) continue;
    tiers.push({ n: key.n, clinics, onceMxn });
  }
  return tiers.sort((a, b) => a.clinics - b.clinics);
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
 * tracking — en el umbral, contando los SUSTAIN_MONTHS. No paga nada.
 * awarded  — otorgado; su comisión de PAGO ÚNICO ya se generó. Cerrado para
 *            siempre: ni se revoca si su red baja (se ganó con 3 meses
 *            sostenidos) ni vuelve a emitir un segundo peso.
 */
export type NetworkAwardStatus = "tracking" | "awarded";

export const NETWORK_AWARD_STATUS_LABELS: Record<NetworkAwardStatus, string> = {
  tracking: "Sosteniendo el número",
  awarded: "Bono otorgado",
};

/**
 * Normaliza cualquier string a NetworkAwardStatus.
 *
 * Los cuatro estados de la etapa con modalidad mensual (`pending_choice`,
 * `once_paid`, `monthly_active`, `monthly_paused`) se mapean a `awarded`, NO a
 * `tracking`: cualquiera de ellos significa "este escalón ya se otorgó", y
 * degradarlo al estado que cuenta la racha lo volvería a otorgar y a pagar.
 * En la práctica no había ni una fila cuando se retiró la modalidad, pero el
 * sentido del error importa más que la probabilidad. Lo desconocido sí cae a
 * `tracking`, que es el estado que no paga.
 */
export function normalizeAwardStatus(value: unknown): NetworkAwardStatus {
  return value === "awarded" ||
    value === "pending_choice" ||
    value === "once_paid" ||
    value === "monthly_active" ||
    value === "monthly_paused"
    ? "awarded"
    : "tracking";
}

/** Lo mínimo que `decideNetworkSweep` necesita saber de un award guardado. */
export interface AwardSnapshot {
  id: string;
  tier: number;
  status: NetworkAwardStatus;
  clinics: number;
  onceMxn: number;
  qualifiedSince: Date | null;
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
 * Mes de referencia en UTC ("2026-09"). UTC y no hora local para que dos
 * ejecuciones a los lados de la medianoche no caigan en meses distintos.
 * Se sigue usando en los resúmenes del cron y del admin.
 */
export function periodKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  return `${y}-${m < 10 ? "0" : ""}${m}`;
}

/**
 * EL CANDADO. `affiliate_commissions."stripeInvoiceId"` es UNIQUE, así que
 * escribir esta referencia es lo que hace imposible pagar dos veces el mismo
 * escalón — aunque el cron corra dos veces, aunque corran dos instancias a la
 * vez, aunque el award se quede a medio actualizar. No hay ninguna otra
 * defensa que dependa de leer-antes-de-escribir, porque esa carrera se pierde.
 *
 * Un award por (afiliado, escalón) y una comisión por award: una sola vez,
 * para siempre.
 */
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
  | { type: "start-tracking"; tier: number; clinics: number; onceMxn: number }
  /** Sigue en el umbral sin cumplir los 3 meses: montos vivos, misma racha. */
  | { type: "refresh-tracking"; awardId: string; clinics: number; onceMxn: number; qualifiedSince: Date }
  /** Cayó del umbral mientras contaba: el reloj se reinicia desde cero. */
  | { type: "reset-streak"; awardId: string }
  /**
   * 3 meses cumplidos: se otorga, los montos QUEDAN CONGELADOS aquí y la
   * comisión de pago único se genera junto con el cambio de estado.
   */
  | { type: "award"; awardId: string; tier: number; clinics: number; onceMxn: number }
  /** Solo cambió el conteo observado — es lo que explica dónde va su red. */
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
 *  · `awarded` está CERRADO para siempre: jamás una segunda comisión, y
 *    tampoco se revoca si su red baja — ya se ganó con 3 meses sostenidos.
 *  · Un escalón otorgado no bloquea a los siguientes: son acumulables.
 *  · Nadie lejos del umbral genera escrituras cada mes.
 */
export function decideNetworkSweep(input: SweepInput): NetworkSweepAction[] {
  const actions: NetworkSweepAction[] = [];
  const count = Number.isFinite(input.count) ? Math.max(0, Math.floor(input.count)) : 0;
  const now = input.now;

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
          });
        } else {
          actions.push({
            type: "refresh-tracking",
            awardId: award.id,
            clinics: tier.clinics,
            onceMxn: tier.onceMxn,
            qualifiedSince: award.qualifiedSince,
          });
        }
        break;
      }

      case "awarded": {
        if (award.lastCount !== count) actions.push({ type: "touch", awardId: award.id });
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
}

export interface NetworkBonusView {
  /** Clínicas de red que califican hoy. */
  count: number;
  tiers: NetworkTierView[];
  /** El primer escalón que aún no alcanza; null si los alcanzó todos. */
  next: NetworkTierView | null;
  /** Cuántas le faltan para `next` (0 si no hay siguiente). */
  missing: number;
  /** Escalones ya otorgados, con su comisión generada. */
  awarded: NetworkTierView[];
  /** Lo que ya se le generó en bonos por red. */
  awardedMxn: number;
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
    };
  });

  const awarded: NetworkTierView[] = [];
  let awardedMxn = 0;
  for (const v of views) {
    if (!v.award || v.award.status !== "awarded") continue;
    awarded.push(v);
    // El monto CONGELADO del award, no el vigente: es lo que se le pagó.
    awardedMxn += v.award.onceMxn;
  }

  const next = views.find((v) => safeCount < v.clinics) ?? null;

  return {
    count: safeCount,
    tiers: views,
    next,
    missing: next ? Math.max(0, next.clinics - safeCount) : 0,
    awarded,
    awardedMxn: roundMxn(awardedMxn),
  };
}
