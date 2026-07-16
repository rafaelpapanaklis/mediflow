import "server-only";
import { prisma } from "@/lib/prisma";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import {
  FALLBACK_PLAN_CONFIG,
  PLAN_MARKETING,
  type PlanConfigShape,
  type PlanLimits,
  type ResolvedPlan,
} from "@/lib/plan-shared";

/**
 * FUENTE ÚNICA (server) de la config de planes.
 *
 * Lee la tabla `plan_configs` (editable desde /admin/settings → Planes) con
 * CACHÉ en memoria (TTL 60s) y FALLBACK a las constantes de `plan-shared` si
 * la tabla está vacía o no responde — así nunca rompe en el primer deploy.
 *
 * Los tipos/validadores (PlanId, isPlanId, PLAN_IDS) viven en
 * `@/lib/billing/plans`. Las utilidades puras (formatBytes) y el FALLBACK
 * viven en `@/lib/plan-shared` (client-safe). Este módulo es SERVER-ONLY
 * porque importa prisma.
 */

// Re-export para consumidores server que esperaban estos símbolos en @/lib/plans.
export { formatBytes } from "@/lib/plan-shared";
export type { PlanLimits, ResolvedPlan } from "@/lib/plan-shared";
export type { PlanId } from "@/lib/billing/plans";

let cached: { value: Record<PlanId, ResolvedPlan>; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

function coercePlanId(plan: string | null | undefined): PlanId {
  return plan && (PLAN_IDS as readonly string[]).includes(plan) ? (plan as PlanId) : "PRO";
}

/** Construye el plan resuelto a partir de la fila DB (o el fallback). */
function buildResolved(planId: PlanId, row: PlanConfigShape | null): ResolvedPlan {
  const fb = FALLBACK_PLAN_CONFIG[planId];
  const src = row ?? fb;
  const moduleFeatures =
    row && row.features && typeof row.features === "object"
      ? { ...fb.features, ...row.features }
      : fb.features;
  return {
    id: planId,
    name: src.label,
    label: src.label,
    priceMxn: src.priceMxnMonthly,
    priceMxnMonthly: src.priceMxnMonthly,
    priceMxnAnnual: src.priceMxnAnnual,
    storageBytes: src.storageBytes,
    aiTokensDefault: src.aiTokensDefault,
    whatsappMonthly: src.whatsappMonthly,
    maxPatients: src.maxPatients,
    maxUsers: src.maxUsers,
    // NULL = ilimitado, igual que maxPatients/maxUsers. Que un NULL accidental
    // (columna recién agregada, fila sin sembrar) NO abra sucursales infinitas
    // en BASIC es responsabilidad del DEFAULT 1 de la columna — ver
    // sql/plan_configs_max_clinics.sql. Aquí un NULL sí es intención explícita
    // del admin ("Ilimitado" en /admin/settings → Planes).
    maxClinics: src.maxClinics,
    features: PLAN_MARKETING[planId].features,
    moduleFeatures,
  };
}

/** Normaliza una fila Prisma de plan_configs a PlanConfigShape (bytes a number). */
function rowToShape(row: any): PlanConfigShape {
  return {
    label: row.label,
    priceMxnMonthly: row.priceMxnMonthly,
    priceMxnAnnual: row.priceMxnAnnual,
    // storageBytes es BigInt en Prisma; lo bajamos a number (los valores caben
    // de sobra en Number.MAX_SAFE_INTEGER: 100GB ≈ 1.07e11).
    storageBytes: Number(row.storageBytes),
    aiTokensDefault: row.aiTokensDefault,
    whatsappMonthly: row.whatsappMonthly,
    maxPatients: row.maxPatients ?? null,
    maxUsers: row.maxUsers ?? null,
    maxClinics: row.maxClinics ?? null,
    features:
      row.features && typeof row.features === "object" ? (row.features as Record<string, boolean>) : {},
  };
}

async function loadAll(): Promise<Record<PlanId, ResolvedPlan>> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  let byId = new Map<string, PlanConfigShape>();
  try {
    const rows = await prisma.planConfig.findMany();
    for (const r of rows) byId.set(r.planId, rowToShape(r));
  } catch {
    // Tabla aún no migrada / DB no disponible → conserva la última cache buena
    // o cae al fallback (precios/límites actuales correctos).
    if (cached) return cached.value;
    byId = new Map();
  }

  const value = {} as Record<PlanId, ResolvedPlan>;
  for (const id of PLAN_IDS) value[id] = buildResolved(id, byId.get(id) ?? null);
  cached = { value, at: now };
  return value;
}

/** Todos los planes resueltos, en orden BASIC → PRO → CLINIC. */
export async function getResolvedPlans(): Promise<ResolvedPlan[]> {
  const all = await loadAll();
  return PLAN_IDS.map((id) => all[id]);
}

/** Un plan resuelto (drop-in del antiguo getPlan). Coacciona ids inválidos a PRO. */
export async function getResolvedPlan(plan: string | null | undefined): Promise<ResolvedPlan> {
  const all = await loadAll();
  return all[coercePlanId(plan)];
}

/** Límites efectivos del plan (async; lee de plan_configs con fallback). */
export async function getPlanLimits(plan: string | null | undefined): Promise<PlanLimits> {
  const all = await loadAll();
  const r = all[coercePlanId(plan)];
  return {
    storageBytes: r.storageBytes,
    aiTokensDefault: r.aiTokensDefault,
    whatsappMonthly: r.whatsappMonthly,
    monthlyPrice: r.priceMxnMonthly,
    maxPatients: r.maxPatients,
    maxUsers: r.maxUsers,
    maxClinics: r.maxClinics,
    label: r.label,
  };
}

/** Invalida la cache en memoria (tras un update del admin). */
export function clearPlanConfigCache(): void {
  cached = null;
}
