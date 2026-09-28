// ═══════════════════════════════════════════════════════════════════════════
// Datos financieros POR CASO que no le tocan a "Alta del caso" (ws1-t1, Ola 1
// · Cobro): F11 (cuántas reposiciones incluye el plan y cuántas ya se
// usaron) y F9 (qué descuento se le aplicó, solo para mostrarlo — el
// descuento en sí se aplica a mano en el editor de factura, que ya lo trae).
//
// Tabla `orthodontic_case_billing` (sql/ortodoncia-cobro.sql), una fila por
// caso, creada perezosamente. SQL crudo + sonda `to_regclass`: sin el SQL
// aplicado, todo caso se comporta como "2 reposiciones incluidas, 0 usadas,
// sin descuento" — no tumba nada.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";

export interface BillingDelCaso {
  includedReplacementsTotal: number;
  includedReplacementsUsed: number;
  discountRuleId: string | null;
  discountLabel: string | null;
  discountPct: number | null;
}

const NEUTRO: BillingDelCaso = {
  includedReplacementsTotal: 2,
  includedReplacementsUsed: 0,
  discountRuleId: null,
  discountLabel: null,
  discountPct: null,
};

let tabla: { existe: boolean; at: number } | null = null;
const TTL_MS = 60_000;

async function tablaExiste(): Promise<boolean> {
  const t = Date.now();
  if (tabla && (tabla.existe || t - tabla.at < TTL_MS)) return tabla.existe;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT to_regclass('public.orthodontic_case_billing') IS NOT NULL AS existe`;
    tabla = { existe: filas[0]?.existe === true, at: t };
    return tabla.existe;
  } catch (e) {
    console.warn("[ortodoncia:caso-billing] no se pudo comprobar la tabla:", e);
    return false;
  }
}

/** Solo para pruebas: olvida lo que se sabía de la tabla. */
export function _olvidarTablaCaso(): void {
  tabla = null;
}

interface Fila {
  includedReplacementsTotal: number;
  includedReplacementsUsed: number;
  discountRuleId: string | null;
  discountLabel: string | null;
  discountPct: unknown;
}

function deFila(f: Fila | undefined): BillingDelCaso {
  if (!f) return NEUTRO;
  return {
    includedReplacementsTotal: Number.isInteger(f.includedReplacementsTotal) ? f.includedReplacementsTotal : NEUTRO.includedReplacementsTotal,
    includedReplacementsUsed: Number.isInteger(f.includedReplacementsUsed) ? f.includedReplacementsUsed : 0,
    discountRuleId: f.discountRuleId ?? null,
    discountLabel: f.discountLabel ?? null,
    discountPct: f.discountPct != null && isFinite(Number(f.discountPct)) ? Number(f.discountPct) : null,
  };
}

/** Lee los datos financieros del caso, o los neutros si no hay fila (o falta la tabla). */
export async function leerBillingDelCaso(treatmentPlanId: string, clinicId: string): Promise<BillingDelCaso> {
  if (!treatmentPlanId || !clinicId) return NEUTRO;
  if (!(await tablaExiste())) return NEUTRO;
  try {
    const filas = await prisma.$queryRaw<Fila[]>`
      SELECT "includedReplacementsTotal", "includedReplacementsUsed", "discountRuleId", "discountLabel", "discountPct"
        FROM "orthodontic_case_billing"
       WHERE "treatmentPlanId" = ${treatmentPlanId} AND "clinicId" = ${clinicId}
       LIMIT 1`;
    return deFila(filas[0]);
  } catch (e) {
    console.warn("[ortodoncia:caso-billing] no se pudo leer:", e);
    return NEUTRO;
  }
}

async function asegurarFila(treatmentPlanId: string, clinicId: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "orthodontic_case_billing" ("treatmentPlanId", "clinicId")
    VALUES (${treatmentPlanId}, ${clinicId})
    ON CONFLICT ("treatmentPlanId") DO NOTHING`;
}

/** Registra qué descuento (F9) se le aplicó al caso — solo bookkeeping/reporte. */
export async function guardarDescuentoDelCaso(
  treatmentPlanId: string,
  clinicId: string,
  descuento: { ruleId: string | null; label: string | null; pct: number | null },
): Promise<{ ok: boolean; sinTabla: boolean }> {
  if (!treatmentPlanId || !clinicId) return { ok: false, sinTabla: false };
  if (!(await tablaExiste())) return { ok: false, sinTabla: true };
  try {
    await asegurarFila(treatmentPlanId, clinicId);
    await prisma.$executeRaw`
      UPDATE "orthodontic_case_billing"
         SET "discountRuleId" = ${descuento.ruleId}, "discountLabel" = ${descuento.label},
             "discountPct" = ${descuento.pct}::numeric, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "treatmentPlanId" = ${treatmentPlanId} AND "clinicId" = ${clinicId}`;
    return { ok: true, sinTabla: false };
  } catch (e) {
    console.warn("[ortodoncia:caso-billing] no se pudo guardar el descuento:", e);
    return { ok: false, sinTabla: false };
  }
}

/** Cuántas reposiciones incluye el plan (F11) — solo cuando la clínica lo cambia del default. */
export async function guardarReposicionesIncluidas(
  treatmentPlanId: string,
  clinicId: string,
  total: number,
): Promise<{ ok: boolean; sinTabla: boolean }> {
  if (!treatmentPlanId || !clinicId || !Number.isFinite(total) || total < 0) return { ok: false, sinTabla: false };
  if (!(await tablaExiste())) return { ok: false, sinTabla: true };
  try {
    await asegurarFila(treatmentPlanId, clinicId);
    await prisma.$executeRaw`
      UPDATE "orthodontic_case_billing"
         SET "includedReplacementsTotal" = ${Math.floor(total)}, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "treatmentPlanId" = ${treatmentPlanId} AND "clinicId" = ${clinicId}`;
    return { ok: true, sinTabla: false };
  } catch (e) {
    console.warn("[ortodoncia:caso-billing] no se pudo guardar reposiciones incluidas:", e);
    return { ok: false, sinTabla: false };
  }
}

export interface ConsumirReposicionResultado {
  ok: boolean;
  sinTabla: boolean;
  /** `true` si esta reposición SÍ contó dentro de las incluidas (había cupo). */
  fueIncluida: boolean;
  restantes: number;
}

/**
 * Marca una reposición como usada, SOLO si todavía hay cupo. Determinista y
 * atómico (UPDATE ... WHERE used < total, sin lectura-luego-escritura): dos
 * cobros a la vez no pueden "gastar" el mismo cupo dos veces.
 */
export async function consumirReposicionIncluida(treatmentPlanId: string, clinicId: string): Promise<ConsumirReposicionResultado> {
  if (!treatmentPlanId || !clinicId) return { ok: false, sinTabla: false, fueIncluida: false, restantes: 0 };
  if (!(await tablaExiste())) return { ok: false, sinTabla: true, fueIncluida: false, restantes: 0 };
  try {
    await asegurarFila(treatmentPlanId, clinicId);
    const filas = await prisma.$queryRaw<{ includedReplacementsUsed: number; includedReplacementsTotal: number }[]>`
      UPDATE "orthodontic_case_billing"
         SET "includedReplacementsUsed" = "includedReplacementsUsed" + 1, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "treatmentPlanId" = ${treatmentPlanId} AND "clinicId" = ${clinicId}
         AND "includedReplacementsUsed" < "includedReplacementsTotal"
       RETURNING "includedReplacementsUsed", "includedReplacementsTotal"`;
    if (filas[0]) {
      const restantes = Math.max(0, filas[0].includedReplacementsTotal - filas[0].includedReplacementsUsed);
      return { ok: true, sinTabla: false, fueIncluida: true, restantes };
    }
    const actual = await leerBillingDelCaso(treatmentPlanId, clinicId);
    return { ok: true, sinTabla: false, fueIncluida: false, restantes: Math.max(0, actual.includedReplacementsTotal - actual.includedReplacementsUsed) };
  } catch (e) {
    console.warn("[ortodoncia:caso-billing] no se pudo consumir la reposición:", e);
    return { ok: false, sinTabla: false, fueIncluida: false, restantes: 0 };
  }
}
