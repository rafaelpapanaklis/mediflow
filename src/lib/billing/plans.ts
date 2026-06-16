/**
 * Tipos y validadores de los planes de la plataforma DaleControl.
 *
 * Este módulo es PURO y client-safe (sin prisma, sin "server-only"): solo
 * expone el universo de ids, el guard `isPlanId` y el tipo descriptor. Es
 * importable desde client components.
 *
 * El PRECIO, los límites y los permisos por módulo ya NO viven aquí: salen de
 * la tabla `plan_configs` (editable desde el admin), resuelta server-side por
 * `src/lib/plans.ts` (`getResolvedPlan` / `getResolvedPlans` / `getPlanLimits`).
 * Los client components obtienen los planes vía el endpoint público
 * `GET /api/plans` o como props desde un server component.
 */

export const PLAN_IDS = ["BASIC", "PRO", "CLINIC"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Plan resuelto para UI (precio/features ya provienen de plan_configs). */
export interface PlanDescriptor {
  id: PlanId;
  name: string;
  priceMxn: number;
  features: string[];
}

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
}
