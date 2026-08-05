/**
 * Afiliados — MOTOR DE COMISIONES: helpers con BD.
 *
 * La matemática pura vive en `./payout-core` (client-safe, testeable) y este
 * archivo la RE-EXPORTA, así que el server importa todo desde
 * "@/lib/affiliates/payout" y el cliente (simulador del admin) importa solo
 * "@/lib/affiliates/payout-core" sin arrastrar Prisma — mismo corte que
 * plan-shared.ts / plans.ts.
 *
 * DEGRADACIÓN (lesson_ortho_schema_drift): si sql/afiliados-comisiones.sql no
 * está aplicado, `getPayoutConfig()` devuelve null y el caller conserva el
 * comportamiento anterior (% del nivel). Nada aquí lanza nunca.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_MILESTONES,
  DEFAULT_PAYOUT_CONFIG,
  normalizeMilestones,
  normalizePayoutMode,
  normalizeProgramMode,
  type MilestonesConfig,
  type PayoutConfig,
  type PayoutMode,
} from "./payout-core";

export * from "./payout-core";

/** Normaliza la fila de BD al shape PayoutConfig (sin id/updatedAt). */
export function toPayoutConfig(row: {
  defaultMode: string;
  defaultPayoutMode: string;
  allowAffiliateChoice: boolean;
  recurringBasicMxn: number;
  recurringProMxn: number;
  recurringClinicMxn: number;
  oneTimeBasicMxn: number;
  oneTimeProMxn: number;
  oneTimeClinicMxn: number;
  startAtInvoiceNo: number;
  oneTimeAtInvoiceNo: number;
}): PayoutConfig {
  return {
    defaultMode: normalizeProgramMode(row.defaultMode),
    defaultPayoutMode: normalizePayoutMode(row.defaultPayoutMode),
    allowAffiliateChoice: row.allowAffiliateChoice !== false,
    recurringBasicMxn: row.recurringBasicMxn,
    recurringProMxn: row.recurringProMxn,
    recurringClinicMxn: row.recurringClinicMxn,
    oneTimeBasicMxn: row.oneTimeBasicMxn,
    oneTimeProMxn: row.oneTimeProMxn,
    oneTimeClinicMxn: row.oneTimeClinicMxn,
    startAtInvoiceNo: row.startAtInvoiceNo,
    oneTimeAtInvoiceNo: row.oneTimeAtInvoiceNo,
  };
}

/**
 * Config vigente del motor (fila id=1). Devuelve null SOLO si la tabla no
 * existe todavía (SQL sin correr) → el caller cae al modo % por nivel. Si la
 * tabla existe pero la fila no, devuelve los defaults. Mismo contrato que
 * getProgramConfig() en @/lib/affiliate-levels.
 */
export async function getPayoutConfig(): Promise<PayoutConfig | null> {
  try {
    const row = await prisma.affiliatePayoutConfig.findUnique({ where: { id: 1 } });
    if (!row) return { ...DEFAULT_PAYOUT_CONFIG };
    return toPayoutConfig(row);
  } catch {
    // Tabla inexistente (sql/afiliados-comisiones.sql sin correr) u otro error.
    return null;
  }
}

/**
 * Config del motor + BONOS POR HITOS en UNA sola lectura de la fila id=1.
 *
 * Existe para las superficies públicas, que necesitan las dos mitades a la vez
 * (/afiliados y /terminos-afiliados): llamar a `getPayoutConfig()` y a un
 * hipotético `getMilestones()` costaría dos SELECT por regeneración. El motor de
 * comisiones sigue usando `getPayoutConfig()` tal cual — no sabe de hitos.
 *
 * Misma degradación: tabla inexistente → los dos en null; tabla sin fila →
 * los defaults de cada mitad. Nunca lanza.
 */
export async function getPayoutSettings(): Promise<{
  cfg: PayoutConfig | null;
  milestones: MilestonesConfig | null;
}> {
  try {
    const row = await prisma.affiliatePayoutConfig.findUnique({ where: { id: 1 } });
    if (!row) return { cfg: { ...DEFAULT_PAYOUT_CONFIG }, milestones: { ...DEFAULT_MILESTONES } };
    return { cfg: toPayoutConfig(row), milestones: normalizeMilestones(row) };
  } catch {
    // Tabla inexistente (sql/afiliados-comisiones.sql sin correr) u otro error.
    // Ojo: las COLUMNAS de hitos sin crear (sql/afiliados-hitos.sql sin correr)
    // caen aquí también, porque Prisma las pide en el SELECT.
    return { cfg: null, milestones: null };
  }
}

/**
 * Prefijo con el que `recordStripeInvoice` etiqueta las notas de una factura
 * de PRORRATEO: `notes = "Stripe <billing_reason> <número>"`. Es el único dato
 * que sobrevive en subscription_invoices para distinguirlas.
 */
export const PRORATION_NOTE_PREFIX = "Stripe subscription_update";

/**
 * Número de cobro de la clínica para esta factura: 1 = primer cobro.
 *
 * Se cuenta sobre subscription_invoices PAGADAS excluyendo la factura actual
 * (`currentInvoiceRef`), así que da lo mismo si el registro del cobro ya
 * ocurrió o no: el resultado es determinista.
 *
 * Los PRORRATEOS quedan fuera: son cargos por días sueltos de un cambio de
 * plan, no cobros del ciclo. Si contaran, un upgrade correría la numeración y
 * el pago único se dispararía en la factura equivocada (o nunca).
 *
 * ⚠️ `reference` y `notes` son nullable y `{ not: … }` descarta los NULL en
 * Postgres (feedback_prisma_not_like_descarta_nulls) — de ahí las ramas OR
 * explícitas: los cobros manuales sin referencia ni notas TAMBIÉN cuentan.
 *
 * null = no se pudo determinar (error de BD); el caller debe conservar la
 * lógica anterior en vez de arriesgar un monto equivocado.
 */
export async function getInvoiceNo(
  clinicId: string,
  currentInvoiceRef: string | null,
): Promise<number | null> {
  try {
    const filters: any[] = [
      { OR: [{ notes: null }, { notes: { not: { startsWith: PRORATION_NOTE_PREFIX } } }] },
    ];
    if (currentInvoiceRef) {
      filters.push({ OR: [{ reference: null }, { reference: { not: currentInvoiceRef } }] });
    }
    const previous = await prisma.subscriptionInvoice.count({
      where: { clinicId, status: "paid", AND: filters },
    });
    return previous + 1;
  } catch {
    return null;
  }
}

export interface ClinicTerms {
  clinicId: string;
  affiliateId: string;
  payoutMode: PayoutMode;
  oneTimePaidAt: Date | null;
}

/** Términos congelados de una clínica. null = sin términos (o tabla ausente). */
export async function getClinicTerms(clinicId: string): Promise<ClinicTerms | null> {
  try {
    const row = await prisma.affiliateClinicTerms.findUnique({ where: { clinicId } });
    if (!row) return null;
    return {
      clinicId: row.clinicId,
      affiliateId: row.affiliateId,
      payoutMode: normalizePayoutMode(row.payoutMode),
      oneTimePaidAt: row.oneTimePaidAt ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Congela la modalidad de una clínica referida. Se llama al atribuirse el alta
 * y, como backstop, desde el webhook para las clínicas referidas ANTES de esta
 * ola. Si ya existían términos NO los pisa (son inmutables por diseño).
 * Devuelve los términos vigentes o null si la tabla aún no existe.
 */
export async function ensureClinicTerms(
  clinicId: string,
  affiliateId: string,
  mode: PayoutMode,
): Promise<ClinicTerms | null> {
  const existing = await getClinicTerms(clinicId);
  if (existing) return existing;
  try {
    const row = await prisma.affiliateClinicTerms.create({
      data: { clinicId, affiliateId, payoutMode: normalizePayoutMode(mode) },
    });
    return {
      clinicId: row.clinicId,
      affiliateId: row.affiliateId,
      payoutMode: normalizePayoutMode(row.payoutMode),
      oneTimePaidAt: row.oneTimePaidAt ?? null,
    };
  } catch {
    // P2002 (carrera: otro proceso los creó primero) → releemos; tabla
    // inexistente → null.
    return await getClinicTerms(clinicId);
  }
}

/**
 * CANDADO del pago único: marca oneTimePaidAt SOLO si seguía en null.
 * Devuelve false si otro proceso ya lo reclamó — el caller debe abortar la
 * transacción para no pagar dos veces. Se llama DENTRO de la $transaction que
 * crea la comisión, con el cliente `tx`.
 */
export async function claimOneTimePayout(
  tx: Prisma.TransactionClient,
  clinicId: string,
): Promise<boolean> {
  const res = await tx.affiliateClinicTerms.updateMany({
    where: { clinicId, oneTimePaidAt: null },
    data: { oneTimePaidAt: new Date() },
  });
  return res.count > 0;
}

/**
 * Modalidad que se le congelará a las PRÓXIMAS clínicas de un afiliado:
 * la suya si el programa permite elegir, si no la del programa.
 */
export function effectiveAffiliateMode(
  affiliatePayoutMode: string | null | undefined,
  cfg: PayoutConfig | null,
): PayoutMode {
  if (!cfg) return normalizePayoutMode(affiliatePayoutMode);
  if (!cfg.allowAffiliateChoice) return cfg.defaultPayoutMode;
  return normalizePayoutMode(affiliatePayoutMode ?? cfg.defaultPayoutMode);
}
