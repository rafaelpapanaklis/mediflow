import "server-only";
import { prisma } from "@/lib/prisma";
import {
  BARBER_PLAN_IDS,
  FALLBACK_BARBER_PLAN_CONFIG,
  isBarberPlanId,
  type BarberPlanConfigShape,
  type BarberPlanId,
  type BarberResolvedPlan,
} from "@/lib/barber/plan-shared";

/**
 * FUENTE ÚNICA (server) de la config de planes BARBER — espejo de
 * src/lib/plans.ts del dental.
 *
 * Lee la tabla `barber_plan_configs` con CACHÉ en memoria (TTL 60s) y
 * FALLBACK a FALLBACK_BARBER_PLAN_CONFIG (= el seed de sql/barber.sql) si la
 * tabla está vacía o aún no existe — así nunca rompe en el primer deploy con
 * el SQL sin aplicar.
 *
 * Los tipos y el fallback viven en @/lib/barber/plan-shared (client-safe).
 * Este módulo es SERVER-ONLY porque importa prisma.
 */

let cached: { value: Record<BarberPlanId, BarberResolvedPlan>; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

function coerceBarberPlanId(plan: string | null | undefined): BarberPlanId {
  return isBarberPlanId(plan) ? plan : "BASICO";
}

/** Normaliza una fila Prisma de barber_plan_configs (Decimal → number). */
function rowToShape(row: {
  name: string;
  priceMonthly: unknown;
  priceYearly: unknown;
  firstMonthPrice: unknown;
  maxBarbers: number;
  maxBranches: number;
  messageQuota: number;
  features: unknown;
  stripePriceIdMonthly: string | null;
  stripePriceIdYearly: string | null;
  sortOrder: number;
  isActive: boolean;
}): BarberPlanConfigShape {
  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);
  return {
    name: row.name,
    priceMonthly: num(row.priceMonthly) ?? 0,
    priceYearly: num(row.priceYearly),
    firstMonthPrice: num(row.firstMonthPrice),
    maxBarbers: row.maxBarbers,
    maxBranches: row.maxBranches,
    messageQuota: row.messageQuota,
    features:
      row.features && typeof row.features === "object"
        ? (row.features as Record<string, boolean>)
        : {},
    stripePriceIdMonthly: row.stripePriceIdMonthly ?? null,
    stripePriceIdYearly: row.stripePriceIdYearly ?? null,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

/** Fila DB (o fallback) → plan resuelto. features de la fila se FUSIONAN
 *  sobre el fallback (una key nueva del código no desaparece si la fila es
 *  vieja; una key editada en la tabla manda). */
function buildResolved(planId: BarberPlanId, row: BarberPlanConfigShape | null): BarberResolvedPlan {
  const fb = FALLBACK_BARBER_PLAN_CONFIG[planId];
  const src = row ?? fb;
  const features = row ? { ...fb.features, ...row.features } : fb.features;
  return { id: planId, ...src, features };
}

async function loadAll(): Promise<Record<BarberPlanId, BarberResolvedPlan>> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  let byId = new Map<string, BarberPlanConfigShape>();
  try {
    const rows = await prisma.barberPlanConfig.findMany();
    for (const r of rows) byId.set(r.planId, rowToShape(r));
  } catch {
    // Tabla aún no migrada / DB no disponible → conserva la última cache
    // buena o cae al fallback (que es el seed correcto).
    if (cached) return cached.value;
    byId = new Map();
  }

  const value = {} as Record<BarberPlanId, BarberResolvedPlan>;
  for (const id of BARBER_PLAN_IDS) value[id] = buildResolved(id, byId.get(id) ?? null);
  cached = { value, at: now };
  return value;
}

/** Todos los planes barber resueltos, en orden BASICO → AVANZADO → PROFESIONAL. */
export async function getBarberPlans(): Promise<BarberResolvedPlan[]> {
  const all = await loadAll();
  return BARBER_PLAN_IDS.map((id) => all[id]);
}

/** Un plan barber resuelto. Coacciona ids inválidos a BASICO. */
export async function getBarberPlan(
  plan: string | null | undefined,
): Promise<BarberResolvedPlan> {
  const all = await loadAll();
  return all[coerceBarberPlanId(plan)];
}

/** Invalida la cache en memoria (tras un update del admin). */
export function clearBarberPlanConfigCache(): void {
  cached = null;
}
