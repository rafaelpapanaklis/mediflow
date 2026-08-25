import "server-only";
import { prisma } from "@/lib/prisma";
import {
  FALLBACK_REALTY_PLAN_CONFIG,
  REALTY_PLAN_IDS,
  isRealtyPlanId,
  type RealtyPlanConfigShape,
  type RealtyPlanId,
  type RealtyResolvedPlan,
} from "@/lib/realty/plan-shared";

/**
 * FUENTE ÚNICA (server) de la config de planes INMUEBLES — espejo de
 * src/lib/barber/plans.ts.
 *
 * Lee la tabla `realty_plan_configs` con CACHÉ en memoria (TTL 60s) y
 * FALLBACK a FALLBACK_REALTY_PLAN_CONFIG (= el seed de sql/realty.sql) si la
 * tabla está vacía o aún no existe — así nunca rompe en el primer deploy con
 * el SQL sin aplicar.
 *
 * Los tipos y el fallback viven en @/lib/realty/plan-shared (client-safe).
 * Este módulo es SERVER-ONLY porque importa prisma.
 */

let cached: { value: Record<RealtyPlanId, RealtyResolvedPlan>; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

function coerceRealtyPlanId(plan: string | null | undefined): RealtyPlanId {
  return isRealtyPlanId(plan) ? plan : "PROPIETARIO";
}

/** Normaliza una fila Prisma de realty_plan_configs (Decimal → number). */
function rowToShape(row: {
  name: string;
  priceMonthly: unknown;
  priceYearly: unknown;
  maxUsers: number;
  maxOffices: number;
  maxProperties: number;
  storageQuotaMb: number;
  messageQuota: number;
  features: unknown;
  stripeLookupKey: string | null;
  sortOrder: number;
  isActive: boolean;
}): RealtyPlanConfigShape {
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    name: row.name,
    priceMonthly: num(row.priceMonthly) ?? 0,
    priceYearly: num(row.priceYearly),
    maxUsers: row.maxUsers,
    maxOffices: row.maxOffices,
    maxProperties: row.maxProperties,
    storageQuotaMb: row.storageQuotaMb,
    messageQuota: row.messageQuota,
    features:
      row.features && typeof row.features === "object"
        ? (row.features as Record<string, boolean>)
        : {},
    stripeLookupKey: row.stripeLookupKey ?? null,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

/**
 * Fila DB (o fallback) → plan resuelto. Las features de la fila se FUSIONAN
 * sobre el fallback: una key nueva del código no desaparece si la fila es
 * vieja, y una key editada en la tabla manda.
 */
function buildResolved(
  planId: RealtyPlanId,
  row: RealtyPlanConfigShape | null,
): RealtyResolvedPlan {
  const fb = FALLBACK_REALTY_PLAN_CONFIG[planId];
  const src = row ?? fb;
  const features = row ? { ...fb.features, ...row.features } : fb.features;
  return { id: planId, ...src, features };
}

async function loadAll(): Promise<Record<RealtyPlanId, RealtyResolvedPlan>> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  let byId = new Map<string, RealtyPlanConfigShape>();
  try {
    const rows = await prisma.realtyPlanConfig.findMany();
    for (const r of rows) byId.set(r.planId, rowToShape(r));
  } catch {
    // Tabla aún no migrada / DB no disponible → conserva la última cache
    // buena o cae al fallback (que es el seed correcto).
    if (cached) return cached.value;
    byId = new Map();
  }

  const value = {} as Record<RealtyPlanId, RealtyResolvedPlan>;
  for (const id of REALTY_PLAN_IDS) value[id] = buildResolved(id, byId.get(id) ?? null);
  cached = { value, at: now };
  return value;
}

/** Todos los planes resueltos, en orden PROPIETARIO → ASESOR → INMOBILIARIA. */
export async function getRealtyPlans(): Promise<RealtyResolvedPlan[]> {
  const all = await loadAll();
  return REALTY_PLAN_IDS.map((id) => all[id]);
}

/** Un plan resuelto. Coacciona ids inválidos a PROPIETARIO. */
export async function getRealtyPlan(
  plan: string | null | undefined,
): Promise<RealtyResolvedPlan> {
  const all = await loadAll();
  return all[coerceRealtyPlanId(plan)];
}

/** Invalida la cache en memoria (tras un update del admin). */
export function clearRealtyPlanConfigCache(): void {
  cached = null;
}
