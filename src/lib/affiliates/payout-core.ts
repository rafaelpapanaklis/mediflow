/**
 * Afiliados — MOTOR DE COMISIONES: matemática PURA (client-safe).
 *
 * Aquí vive TODA la decisión de "cuánto se le paga al afiliado por esta
 * factura" sin una sola línea de Prisma, para poder testearla con
 * `npm run test:afiliados` y reusarla en el simulador del admin (client
 * component). Los helpers que sí tocan BD viven en `./payout.ts` (server),
 * que re-exporta todo esto — mismo corte que plan-shared.ts / plans.ts.
 *
 * MODELO DE NEGOCIO
 *  - El programa puede pagar por MONTO FIJO por plan ("fixed", default) o por
 *    % del nivel bronce/plata/oro ("pct", el comportamiento histórico).
 *  - Cada afiliado elige MODALIDAD: "recurring" (fijo mensual mientras la
 *    clínica pague) u "onetime" (un solo pago por clínica). La modalidad se
 *    CONGELA por clínica al alta (AffiliateClinicTerms) — cambiarla solo
 *    afecta a clínicas futuras.
 *  - Los MONTOS no se congelan: se lee el valor vigente de la config al
 *    generarse cada comisión (mismo criterio que el % del nivel).
 *  - El primer cobro MENSUAL no paga (es el mes promocional de $19/$29/$39):
 *    la comisión arranca en `startAtInvoiceNo` (default 2). Una factura que
 *    cubre 2 o más meses (la ANUAL) no lleva promoción — se cobró el precio
 *    completo del año — así que comisiona desde la primera.
 *  - El pago único se entrega en `oneTimeAtInvoiceNo` (default 2) O DESPUÉS,
 *    y de inmediato si la factura es multi-mes. Lo que impide el doble pago es
 *    `oneTimePaidAt` + el candado atómico `claimOneTimePayout`, nunca el
 *    número de cobro.
 */

/** Modalidad de pago de un afiliado por una clínica. */
export type PayoutMode = "recurring" | "onetime";

/** Modo del programa completo. "fixed" = montos por plan; "pct" = niveles. */
export type ProgramMode = "fixed" | "pct";

/** Cómo se calculó una comisión ya generada (AffiliateCommission.kind). */
export type CommissionKind = "pct" | "recurring" | "onetime";

/** Planes con monto configurable (espejo del enum Plan de Prisma). */
export type PlanKey = "BASIC" | "PRO" | "CLINIC";

export const PLAN_KEYS: PlanKey[] = ["BASIC", "PRO", "CLINIC"];

/** Espejo de AffiliatePayoutConfig (fila única id=1), sin id ni updatedAt. */
export interface PayoutConfig {
  defaultMode: ProgramMode;
  defaultPayoutMode: PayoutMode;
  allowAffiliateChoice: boolean;
  recurringBasicMxn: number;
  recurringProMxn: number;
  recurringClinicMxn: number;
  oneTimeBasicMxn: number;
  oneTimeProMxn: number;
  oneTimeClinicMxn: number;
  startAtInvoiceNo: number;
  oneTimeAtInvoiceNo: number;
}

/**
 * Defaults del motor = los mismos que los DEFAULT de la tabla en
 * sql/afiliados-comisiones.sql. Se usan cuando la tabla existe pero la fila
 * id=1 aún no (nunca para "inventar" precios de plan: los precios de los
 * planes SIEMPRE salen de plan_configs / plan-shared).
 */
export const DEFAULT_PAYOUT_CONFIG: PayoutConfig = {
  defaultMode: "fixed",
  defaultPayoutMode: "recurring",
  allowAffiliateChoice: true,
  recurringBasicMxn: 40,
  recurringProMxn: 90,
  recurringClinicMxn: 250,
  oneTimeBasicMxn: 350,
  oneTimeProMxn: 650,
  oneTimeClinicMxn: 1400,
  startAtInvoiceNo: 2,
  oneTimeAtInvoiceNo: 2,
};

// ── Bonos por hitos ───────────────────────────────────────────────────────
// Viven en la MISMA fila que el esquema de pago (affiliate_payout_config) pero
// FUERA de `PayoutConfig` a propósito: `resolveCommission` no los toca y el
// motor de comisiones no sabe que existen. Hoy los hitos SÓLO se anuncian y se
// configuran — no hay contador, ni aviso, ni registro de bonos pagados: el
// seguimiento es manual. Mezclarlos con la config del motor invitaría a creer
// que algo los calcula.

/** Espejo plano de las 7 columnas de sql/afiliados-hitos.sql. */
export interface MilestonesConfig {
  milestonesEnabled: boolean;
  milestone1Clinics: number;
  milestone1Mxn: number;
  milestone2Clinics: number;
  milestone2Mxn: number;
  milestone3Clinics: number;
  milestone3Mxn: number;
}

/** Defaults = los mismos DEFAULT del DDL (sql/afiliados-hitos.sql). */
export const DEFAULT_MILESTONES: MilestonesConfig = {
  milestonesEnabled: true,
  milestone1Clinics: 5,
  milestone1Mxn: 2500,
  milestone2Clinics: 25,
  milestone2Mxn: 10000,
  milestone3Clinics: 50,
  milestone3Mxn: 100000,
};

/** Un escalón ya resuelto: "5 clínicas activas → $2,500 de bono". */
export interface MilestoneTier {
  /** 1 | 2 | 3 — el orden EN LA CONFIG, no en la pantalla. */
  n: number;
  clinics: number;
  mxn: number;
}

/** Las 3 parejas (umbral, monto) tal como están guardadas, sin filtrar. */
const MILESTONE_KEYS: { n: number; clinics: keyof MilestonesConfig; mxn: keyof MilestonesConfig }[] = [
  { n: 1, clinics: "milestone1Clinics", mxn: "milestone1Mxn" },
  { n: 2, clinics: "milestone2Clinics", mxn: "milestone2Mxn" },
  { n: 3, clinics: "milestone3Clinics", mxn: "milestone3Mxn" },
];

/**
 * Normaliza cualquier fila/objeto al shape MilestonesConfig. Un campo ausente o
 * no finito cae a su default (mismo criterio que el resto del módulo: nunca
 * lanza, nunca inventa un número que no esté en el DDL).
 */
export function normalizeMilestones(row: Partial<MilestonesConfig> | null | undefined): MilestonesConfig {
  const r = row ?? {};
  const num = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    milestonesEnabled: r.milestonesEnabled !== false,
    milestone1Clinics: Math.round(num(r.milestone1Clinics, DEFAULT_MILESTONES.milestone1Clinics)),
    milestone1Mxn: num(r.milestone1Mxn, DEFAULT_MILESTONES.milestone1Mxn),
    milestone2Clinics: Math.round(num(r.milestone2Clinics, DEFAULT_MILESTONES.milestone2Clinics)),
    milestone2Mxn: num(r.milestone2Mxn, DEFAULT_MILESTONES.milestone2Mxn),
    milestone3Clinics: Math.round(num(r.milestone3Clinics, DEFAULT_MILESTONES.milestone3Clinics)),
    milestone3Mxn: num(r.milestone3Mxn, DEFAULT_MILESTONES.milestone3Mxn),
  };
}

/**
 * Escalones publicables: se descarta el que tenga umbral o monto en 0 (así se
 * apaga UN hito sin apagar los tres) y se ordenan por umbral ascendente, que es
 * como se leen en la página. El switch `milestonesEnabled` NO se mira aquí: eso
 * lo decide cada superficie.
 */
export function milestoneTiers(cfg: MilestonesConfig): MilestoneTier[] {
  const tiers: MilestoneTier[] = [];
  for (const key of MILESTONE_KEYS) {
    const clinics = Math.round(Number(cfg[key.clinics]));
    const mxn = Number(cfg[key.mxn]);
    if (!Number.isFinite(clinics) || clinics <= 0) continue;
    if (!Number.isFinite(mxn) || mxn <= 0) continue;
    tiers.push({ n: key.n, clinics, mxn });
  }
  return tiers.sort((a, b) => a.clinics - b.clinics);
}

/**
 * Suma de todos los bonos: los hitos son ACUMULABLES, así que quien llega al
 * último habrá cobrado los tres. Es la cifra que la landing promete y por eso
 * se calcula, jamás se teclea.
 */
export function milestonesTotalMxn(tiers: MilestoneTier[]): number {
  let total = 0;
  for (const t of tiers) total += t.mxn;
  return roundMxn(total);
}

export const PAYOUT_MODE_LABELS: Record<PayoutMode, string> = {
  recurring: "Fijo recurrente",
  onetime: "Pago único",
};

export const COMMISSION_KIND_LABELS: Record<CommissionKind, string> = {
  pct: "% del nivel",
  recurring: "Fijo recurrente",
  onetime: "Pago único",
};

/** Redondeo a centavos. Defensivo ante no-finitos (→ 0). */
export function roundMxn(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Normaliza cualquier string a PayoutMode (desconocido → "recurring"). */
export function normalizePayoutMode(value: unknown): PayoutMode {
  return value === "onetime" ? "onetime" : "recurring";
}

/** Normaliza cualquier string a ProgramMode (desconocido → "fixed"). */
export function normalizeProgramMode(value: unknown): ProgramMode {
  return value === "pct" ? "pct" : "fixed";
}

/** Normaliza el plan de la clínica a PlanKey (desconocido → "PRO"). */
export function normalizePlanKey(value: unknown): PlanKey {
  return value === "BASIC" || value === "CLINIC" ? value : "PRO";
}

/** Etiqueta de kind tolerante a valores viejos/desconocidos de la BD. */
export function commissionKindLabel(kind: string | null | undefined): string {
  const k = kind === "recurring" || kind === "onetime" ? kind : "pct";
  return COMMISSION_KIND_LABELS[k];
}

/** Días promedio de un mes (365.25 / 12). Un mes "de calendario" real. */
const AVG_MONTH_DAYS = 30.44;
const AVG_MONTH_MS = AVG_MONTH_DAYS * 86_400_000;

/**
 * Meses que cubre una factura: round((end − start) / 30.44 días), clamp
 * [1, 12]. Un plan mensual da 1; el anual (12 meses de golpe) da 12. Fechas
 * inválidas o invertidas → 1 (nunca 0: toda factura pagada cubre al menos un
 * mes de servicio).
 */
export function monthsCovered(periodStart: Date, periodEnd: Date): number {
  const start = periodStart instanceof Date ? periodStart.getTime() : NaN;
  const end = periodEnd instanceof Date ? periodEnd.getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
  const months = Math.round((end - start) / AVG_MONTH_MS);
  if (!Number.isFinite(months)) return 1;
  return Math.min(12, Math.max(1, months));
}

/**
 * Monto fijo configurado para un plan y una modalidad. SIEMPRE sale de la
 * config (editable en /admin) — jamás se escribe un monto a mano aquí.
 */
export function fixedAmountFor(plan: PlanKey, mode: PayoutMode, cfg: PayoutConfig): number {
  const value =
    mode === "onetime"
      ? plan === "BASIC"
        ? cfg.oneTimeBasicMxn
        : plan === "CLINIC"
          ? cfg.oneTimeClinicMxn
          : cfg.oneTimeProMxn
      : plan === "BASIC"
        ? cfg.recurringBasicMxn
        : plan === "CLINIC"
          ? cfg.recurringClinicMxn
          : cfg.recurringProMxn;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export interface ResolveCommissionInput {
  /** Plan VIGENTE de la clínica en esta factura (si subió de plan, el nuevo). */
  plan: PlanKey;
  /** Monto pagado en MXN (base del modo "pct" y auditoría de los fijos). */
  amountMxn: number;
  /** Número de cobro de la clínica; 1 = primer cobro (el promocional). */
  invoiceNo: number;
  /** Meses cubiertos por esta factura (ver monthsCovered). */
  months: number;
  /** Modalidad CONGELADA de la clínica. */
  mode: PayoutMode;
  /** ¿El pago único de esta clínica ya se entregó? */
  oneTimeAlreadyPaid: boolean;
  cfg: PayoutConfig;
  /** % del nivel VIGENTE del afiliado (solo se usa en modo "pct"). */
  levelPct: number;
  /** Modo del programa (cfg.defaultMode ya normalizado por el caller). */
  programMode: ProgramMode;
  /**
   * ¿Es una factura de PRORRATEO (cambio de plan a mitad de ciclo)?
   * En Stripe, `billing_reason === "subscription_update"`. Opcional: sin este
   * dato se asume que no lo es (comportamiento de un cobro normal).
   */
  isProration?: boolean;
}

export interface ResolvedCommission {
  kind: CommissionKind;
  totalMxn: number;
  months: number;
}

/**
 * Decide la comisión de UNA factura. `null` = NO se genera comisión.
 *
 * Orden de las reglas (importa):
 *  1. Cobro anterior a `startAtInvoiceNo` Y factura de un solo mes → null (ese
 *     primer mes es el promocional). Una factura multi-mes sí comisiona.
 *  2. programMode "pct" → % del nivel sobre lo pagado (comportamiento
 *     histórico, intacto: incluso un total de 0 devuelve fila, como antes).
 *  3. "recurring" → fijo del plan × meses cubiertos.
 *  4. "onetime"  → el fijo, UNA sola vez, desde `oneTimeAtInvoiceNo` en
 *     adelante (o ya mismo si la factura cubre 2+ meses).
 *
 * Un monto fijo de 0 (el admin apagó ese plan) devuelve null: no tiene
 * sentido escribir comisiones de $0.
 */
export function resolveCommission(input: ResolveCommissionInput): ResolvedCommission | null {
  const cfg = input.cfg;
  const months = Number.isFinite(input.months) ? Math.min(12, Math.max(1, Math.round(input.months))) : 1;

  const invoiceNo = Number(input.invoiceNo);
  if (!Number.isFinite(invoiceNo)) return null;

  // Un arranque corrupto (columna nula / valor no finito) NO puede degradar a
  // "paga desde el primer cobro": eso comisionaría el mes promocional, justo lo
  // que esta función existe para evitar. El respaldo es el default del programa.
  const startAt = Number.isFinite(cfg.startAtInvoiceNo)
    ? cfg.startAtInvoiceNo
    : DEFAULT_PAYOUT_CONFIG.startAtInvoiceNo;
  // …pero el arranque SOLO tiene sentido en facturas de UN mes. Una factura
  // multi-mes (la ANUAL: 12 meses de golpe) cobró el precio completo, sin
  // promoción, así que la razón de ser de `startAtInvoiceNo` no aplica y
  // comisiona aunque sea la #1. Sin esta excepción el afiliado que vende anual
  // no cobra nada hasta la factura #2… doce meses después.
  // Verificado: una mensualidad normal jamás da 2 — el ciclo más largo son 31
  // días y 31 / 30.44 = 1.018 → round 1 (hay tests de 30, 31 y 28 días).
  if (invoiceNo < startAt && months < 2) return null;

  // Modo histórico: % del nivel sobre el monto pagado. Se conserva tal cual
  // para que un deploy sin la tabla nueva no cambie ni un centavo.
  if (input.programMode === "pct") {
    return { kind: "pct", totalMxn: roundMxn(input.amountMxn * (input.levelPct / 100)), months };
  }

  // ── De aquí en adelante, modo "fixed" (montos por plan) ──────────────
  // Una factura de PRORRATEO cubre los días sueltos de un periodo que YA se
  // comisionó (el cobro del ciclo). Con montos fijos pagaría un mes entero
  // extra por un cargo de unos días, así que no genera comisión: el siguiente
  // cobro del ciclo ya paga el fijo del plan NUEVO. En modo "pct" no cambia
  // nada (se paga el % de lo cobrado, como siempre).
  if (input.isProration) return null;

  if (input.mode === "onetime") {
    if (input.oneTimeAlreadyPaid) return null;
    // Mismo respaldo que el arranque: con la columna corrupta se usa el default
    // del programa, nunca un NaN (que con la comparación `<` dejaría pasar
    // cualquier cobro).
    const oneTimeAt = Number.isFinite(cfg.oneTimeAtInvoiceNo)
      ? cfg.oneTimeAtInvoiceNo
      : DEFAULT_PAYOUT_CONFIG.oneTimeAtInvoiceNo;
    // "En su cobro o después", NO una igualdad exacta: si la clínica no pasa
    // justo por ese cobro (términos congelados tarde, un ciclo saltado), el
    // pago único quedaba en $0 para siempre. Esto no lo ADELANTA — en el caso
    // normal se sigue pagando en el #2 — solo evita perderlo. Contra el doble
    // pago están `oneTimeAlreadyPaid` y el candado atómico de la $transaction.
    // Excepción multi-mes: la factura anual ya cobró el año completo, así que
    // el pago único se entrega ahí mismo sin esperar al cobro de disparo.
    if (invoiceNo < oneTimeAt && months < 2) return null;
    const fixed = fixedAmountFor(input.plan, "onetime", cfg);
    if (fixed <= 0) return null;
    return { kind: "onetime", totalMxn: roundMxn(fixed), months: 1 };
  }

  const fixed = fixedAmountFor(input.plan, "recurring", cfg);
  if (fixed <= 0) return null;
  return { kind: "recurring", totalMxn: roundMxn(fixed * months), months };
}

// ── Equivalencias y simulador (admin) ────────────────────────────────────
// Todo recibe los PRECIOS como parámetro: salen de plan_configs vía
// getResolvedPlans()/plan-shared. Ni un precio escrito a mano en este archivo.

/**
 * Qué % del precio del plan representa un monto fijo ("$90 = 13.06% de $689").
 * null si el precio no es utilizable (0 o no finito).
 */
export function equivalentPct(amountMxn: number, planPriceMxn: number): number | null {
  if (!Number.isFinite(amountMxn) || !Number.isFinite(planPriceMxn) || planPriceMxn <= 0) return null;
  return Math.round((amountMxn / planPriceMxn) * 1000) / 10; // 1 decimal
}

/**
 * Meses de suscripción que cuesta un pago único ("$650 = 0.9 meses de $689").
 * null si el precio no es utilizable.
 */
export function paybackMonths(oneTimeMxn: number, planPriceMxn: number): number | null {
  if (!Number.isFinite(oneTimeMxn) || !Number.isFinite(planPriceMxn) || planPriceMxn <= 0) return null;
  return Math.round((oneTimeMxn / planPriceMxn) * 10) / 10; // 1 decimal
}

export interface SimulationModeResult {
  /** Costo de comisiones (mensual en recurrente; total una vez en único). */
  costMxn: number;
  /** % que ese costo representa del ingreso del mismo horizonte. */
  effectivePct: number | null;
  /** Meses de ingreso que tarda en recuperarse (solo tiene sentido en único). */
  paybackMonths: number | null;
}

export interface SimulationResult {
  clinics: number;
  /** Ingreso mensual de esas clínicas (precios reales de plan_configs). */
  revenueMonthlyMxn: number;
  /** Ingreso del primer año (12 × mensual) — horizonte del pago único. */
  revenueYearlyMxn: number;
  recurring: SimulationModeResult;
  onetime: SimulationModeResult;
}

/**
 * Simulador del esquema: "con X básicos, Y profesionales y Z clínicas, ¿cuánto
 * pago y qué % del ingreso me cuesta?". `pricesMxn` viene de plan_configs.
 *  - recurrente: costo POR MES vs ingreso POR MES.
 *  - único: costo TOTAL (una vez) vs ingreso del PRIMER AÑO, más en cuántos
 *    meses de ingreso se recupera.
 */
export function simulateProgram(
  counts: Record<PlanKey, number>,
  pricesMxn: Record<PlanKey, number>,
  cfg: PayoutConfig,
): SimulationResult {
  let clinics = 0;
  let revenueMonthlyMxn = 0;
  let recurringCost = 0;
  let oneTimeCost = 0;

  for (const plan of PLAN_KEYS) {
    const raw = Number(counts[plan]);
    const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    if (n === 0) continue;
    const price = Number(pricesMxn[plan]);
    clinics += n;
    revenueMonthlyMxn += n * (Number.isFinite(price) && price > 0 ? price : 0);
    recurringCost += n * fixedAmountFor(plan, "recurring", cfg);
    oneTimeCost += n * fixedAmountFor(plan, "onetime", cfg);
  }

  const revenueYearlyMxn = roundMxn(revenueMonthlyMxn * 12);
  return {
    clinics,
    revenueMonthlyMxn: roundMxn(revenueMonthlyMxn),
    revenueYearlyMxn,
    recurring: {
      costMxn: roundMxn(recurringCost),
      effectivePct: equivalentPct(recurringCost, revenueMonthlyMxn),
      paybackMonths: null, // el recurrente no se "recupera": es un costo continuo
    },
    onetime: {
      costMxn: roundMxn(oneTimeCost),
      effectivePct: equivalentPct(oneTimeCost, revenueYearlyMxn),
      paybackMonths: paybackMonths(oneTimeCost, revenueMonthlyMxn),
    },
  };
}
