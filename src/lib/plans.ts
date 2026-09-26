import "server-only";
import { prisma } from "@/lib/prisma";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import {
  buildResolvedPlan,
  type PlanConfigShape,
  type PlanLimits,
  type ResolvedPlan,
} from "@/lib/plan-shared";
import {
  applyClinicOverrides,
  planToLimits,
  type ClinicOverrideFields,
} from "@/lib/billing/plan-overrides";

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
    // Deprecado: se copia solo para no perder el valor de la fila; nadie lo usa.
    whatsappMonthly: row.whatsappMonthly,
    // ?? por si la fila viene de un deploy previo a la migración de cupos CFDI
    // (columna aún sin sembrar): el @default del schema es 50/200.
    cfdiMonthly: row.cfdiMonthly ?? 50,
    cfdiOverageCents: row.cfdiOverageCents ?? 200,
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
  for (const id of PLAN_IDS) value[id] = buildResolvedPlan(id, byId.get(id) ?? null);
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

/**
 * Límites efectivos del PLAN (async; lee de plan_configs con fallback).
 *
 * ⚠️ Esto es lo que dice el PLAN, no lo que tiene una clínica: una clínica dada
 * de alta antes de los planes de sep-2026 conserva sus propios topes y precio.
 * Cualquier sitio que aplique un tope de usuarios/sedes o calcule un importe a
 * cobrar A UNA CLÍNICA debe usar `getPlanLimitsForClinic` / `getResolvedPlanForClinic`.
 * Este queda para lo que es del plan a secas (storage, IA, pacientes, CFDI, la
 * lista de precios pública, el alta de una clínica nueva).
 */
export async function getPlanLimits(plan: string | null | undefined): Promise<PlanLimits> {
  const all = await loadAll();
  return planToLimits(all[coercePlanId(plan)]);
}

/**
 * El plan de ESTA clínica con sus condiciones conservadas encima (topes de
 * usuarios/sedes y precio mensual/anual). Sin overrides vigentes = el plan a
 * secas. La clínica que se pasa necesita los campos de `CLINIC_OVERRIDE_SELECT`;
 * si faltan, se entiende «sin override». Lógica en @/lib/billing/plan-overrides.
 */
export async function getResolvedPlanForClinic(
  clinic: ClinicOverrideFields | null | undefined,
): Promise<ResolvedPlan> {
  const base = await getResolvedPlan(clinic?.plan);
  return applyClinicOverrides(base, clinic);
}

/** Límites de ESTA clínica (mismos que `getPlanLimits` pero con sus overrides). */
export async function getPlanLimitsForClinic(
  clinic: ClinicOverrideFields | null | undefined,
): Promise<PlanLimits> {
  return planToLimits(await getResolvedPlanForClinic(clinic));
}

/** Invalida la cache en memoria (tras un update del admin). */
export function clearPlanConfigCache(): void {
  cached = null;
}
