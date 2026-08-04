/**
 * Afiliados — OFERTA PÚBLICA: los números que ve un afiliado ANTES de
 * registrarse, resueltos en vivo.
 *
 * Misma regla que los precios de los planes, aplicada a las comisiones: aquí
 * no se escribe ni un monto a mano. Los precios salen de plan_configs
 * (`getResolvedPlans`) y los montos —las seis comisiones y los tres bonos por
 * hitos— de affiliate_payout_config (`getPayoutSettings`, una sola lectura),
 * así que si el admin cambia $90 a $100 la página pública lo refleja sin deploy.
 *
 * DEGRADACIÓN: `getPayoutSettings()` devuelve null cuando sql/afiliados-comisiones.sql
 * no está aplicado → se usan los DEFAULT del motor (los mismos que declara el
 * SQL). `getResolvedPlans()` ya trae su propio fallback de precios. Nada aquí
 * lanza: en el peor caso la página muestra los defaults en vez de romperse.
 *
 * Este módulo toca Prisma (vía payout/plans) → SOLO server. La calculadora es
 * un client component y recibe estos números como props; importa la matemática
 * de `payout-core`, jamás de aquí.
 */
import type { ResolvedPlan } from "@/lib/plan-shared";
import { getResolvedPlans } from "@/lib/plans";
import { getPayoutSettings } from "./payout";
import {
  DEFAULT_MILESTONES,
  DEFAULT_PAYOUT_CONFIG,
  fixedAmountFor,
  milestonesTotalMxn,
  milestoneTiers,
  paybackMonths,
  PLAN_KEYS,
  type MilestonesConfig,
  type MilestoneTier,
  type PayoutConfig,
  type PlanKey,
} from "./payout-core";

export interface PublicOfferPlan {
  key: PlanKey;
  /** Nombre comercial del plan tal como lo define plan_configs. */
  label: string;
  /** Precio mensual real del plan (MXN). */
  priceMxn: number;
  /** Comisión fija mensual, mientras la clínica siga pagando. */
  recurringMxn: number;
  /** Comisión de un solo pago por esa clínica. */
  oneTimeMxn: number;
  /**
   * A cuántos meses del fijo recurrente equivale el pago único
   * ("$650 = 7.2 meses de $90"). null si alguno de los dos está apagado.
   */
  oneTimeAsMonths: number | null;
}

/**
 * Bonos por hitos, listos para publicar. `enabled` es el switch del admin: en
 * false NINGUNA superficie pública menciona la promoción (Rafael la apaga sin
 * deploy). `tiers` viene ordenado por umbral y sin escalones apagados.
 *
 * OJO: esto es una PROMESA COMERCIAL, no un cálculo del sistema. Nada cuenta
 * clínicas ni paga estos bonos todavía; el seguimiento es manual.
 */
export interface PublicOfferMilestones {
  enabled: boolean;
  tiers: MilestoneTier[];
  /** Suma de los tres (son acumulables): el "$112,500 en total" de la página. */
  totalMxn: number;
}

export interface PublicOffer {
  cfg: PayoutConfig;
  milestones: PublicOfferMilestones;
  plans: PublicOfferPlan[];
  /** El mayor de los fijos recurrentes — el número grande del hero. */
  topRecurringMxn: number;
  /** El mayor de los pagos únicos. */
  topOneTimeMxn: number;
  /** Precios por plan para el simulador (client-safe, ya serializados). */
  pricesMxn: Record<PlanKey, number>;
  /**
   * Cobro de la clínica en el que arranca la comisión recurrente. 2 = el
   * primer mes (promocional) no comisiona. Se publica tal cual: un afiliado
   * que se entera después se siente engañado.
   */
  startAtInvoiceNo: number;
}

/** Etiqueta de respaldo si plan_configs no devolviera el plan. */
const FALLBACK_LABELS: Record<PlanKey, string> = {
  BASIC: "Básico",
  PRO: "Profesional",
  CLINIC: "Clínica",
};

/**
 * Oferta vigente del programa. Nunca lanza: cualquier fallo de BD cae a los
 * defaults del motor y a los precios de respaldo de plan-shared.
 */
export async function getPublicOffer(): Promise<PublicOffer> {
  const [settings, resolvedPlans] = await Promise.all([
    getPayoutSettings().catch(() => ({ cfg: null, milestones: null })),
    getResolvedPlans().catch((): ResolvedPlan[] => []),
  ]);

  const cfg: PayoutConfig = settings.cfg ?? { ...DEFAULT_PAYOUT_CONFIG };
  const milestonesCfg: MilestonesConfig = settings.milestones ?? { ...DEFAULT_MILESTONES };
  const tiers = milestoneTiers(milestonesCfg);
  const milestones: PublicOfferMilestones = {
    // Sin un solo escalón utilizable no hay nada que anunciar, dé lo que dé el
    // switch: así el bloque no sale vacío si alguien pone los tres montos en 0.
    enabled: milestonesCfg.milestonesEnabled && tiers.length > 0,
    tiers,
    totalMxn: milestonesTotalMxn(tiers),
  };

  // Map explícitamente tipado: `new Map(arr.map(p => [k, p]))` infiere el
  // literal como array y no como tupla, y el Map cae a <unknown, unknown>.
  const byId = new Map<string, ResolvedPlan>();
  for (const p of resolvedPlans) byId.set(p.id, p);

  const plans: PublicOfferPlan[] = PLAN_KEYS.map((key) => {
    const resolved = byId.get(key);
    const priceMxn = Number(resolved?.priceMxnMonthly ?? resolved?.priceMxn);
    const recurringMxn = fixedAmountFor(key, "recurring", cfg);
    const oneTimeMxn = fixedAmountFor(key, "onetime", cfg);
    return {
      key,
      label: resolved?.label || FALLBACK_LABELS[key],
      priceMxn: Number.isFinite(priceMxn) && priceMxn > 0 ? priceMxn : 0,
      recurringMxn,
      oneTimeMxn,
      // `paybackMonths` es genérico ("cuántas veces cabe el divisor"): aquí el
      // divisor es el fijo mensual, no el precio del plan.
      oneTimeAsMonths: recurringMxn > 0 ? paybackMonths(oneTimeMxn, recurringMxn) : null,
    };
  });

  const pricesMxn = {} as Record<PlanKey, number>;
  for (const p of plans) pricesMxn[p.key] = p.priceMxn;

  const startAtRaw = Number(cfg.startAtInvoiceNo);

  return {
    cfg,
    milestones,
    plans,
    topRecurringMxn: Math.max(0, ...plans.map((p) => p.recurringMxn)),
    topOneTimeMxn: Math.max(0, ...plans.map((p) => p.oneTimeMxn)),
    pricesMxn,
    startAtInvoiceNo: Number.isFinite(startAtRaw)
      ? startAtRaw
      : DEFAULT_PAYOUT_CONFIG.startAtInvoiceNo,
  };
}

/** Formato de moneda compartido por las superficies públicas del programa. */
export function fmtMxn(n: number): string {
  const value = Number.isFinite(n) ? n : 0;
  return "$" + Math.round(value).toLocaleString("es-MX");
}
