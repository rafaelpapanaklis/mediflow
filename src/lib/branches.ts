import "server-only";
import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plans";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/plan-status";
import type { BranchBlockedReason, BranchQuota } from "@/lib/branches-shared";

/**
 * MULTI-CLÍNICA · FASE 1 — reglas de cupo de SUCURSALES.
 *
 * FUENTE ÚNICA de la regla "¿este dueño puede crear otra sede?", consumida por:
 *   • el layout de /dashboard (qué muestra el switcher del sidebar), y
 *   • POST /api/clinics (enforcement real).
 * La UI es sólo un espejo: el gate que manda es el del endpoint, que recuenta
 * contra la BD con el supabaseId de la SESIÓN.
 *
 * Un "dueño" es un supabaseId con rol SUPER_ADMIN en una clínica. El runtime
 * multi-clínica (1 supabaseId → N filas User, cookie de clínica activa,
 * aislamiento por clinicId) ya existía; esto sólo agrega crear + gatear.
 *
 * Fase 1 NO comparte datos entre sedes: cada sucursal sigue 100% aislada.
 */

export type { BranchBlockedReason, BranchQuota } from "@/lib/branches-shared";

type QuotaClinic = { plan?: string | null; subscriptionStatus?: string | null };

/**
 * Resuelve el cupo a partir de datos YA cargados por el caller (sin queries
 * propias más allá de la config de planes, que va con caché en memoria de 60s).
 *
 * `ownedCount` lo calcula cada caller desde su fuente confiable:
 *   • layout → getUserClinics() filtrando role === "SUPER_ADMIN",
 *   • API    → countOwnedClinics(supabaseId) contra la BD.
 */
export async function getBranchQuota(input: {
  clinic: QuotaClinic;
  isOwner: boolean;
  ownedCount: number;
}): Promise<BranchQuota> {
  const { maxClinics } = await getPlanLimits(input.clinic.plan);
  const max = maxClinics;
  const planAllowsBranches = max === null || max > 1;

  const status = input.clinic.subscriptionStatus ?? null;
  const subscriptionActive = status !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(status);

  const withinLimit = max === null || input.ownedCount < max;

  // El orden importa: es el motivo que se le muestra/devuelve al dueño.
  const blockedReason: BranchBlockedReason | null = !input.isOwner
    ? "ROLE"
    : !planAllowsBranches
      ? "PLAN"
      : !subscriptionActive
        ? "SUBSCRIPTION"
        : !withinLimit
          ? "LIMIT"
          : null;

  return {
    used: input.ownedCount,
    max,
    canCreate: blockedReason === null,
    planAllowsBranches,
    blockedReason,
  };
}

/**
 * Cuenta las clínicas de las que este supabaseId es DUEÑO. Anti-IDOR: el
 * supabaseId SIEMPRE sale de la sesión del server, nunca del body.
 * `@@unique([supabaseId, clinicId])` garantiza 1 fila User por clínica, así que
 * contar filas == contar clínicas.
 */
export async function countOwnedClinics(supabaseId: string): Promise<number> {
  return prisma.user.count({
    where: { supabaseId, role: "SUPER_ADMIN", isActive: true },
  });
}

/**
 * Slug único para la sucursal, derivado del nombre. Mismo criterio que el alta
 * de clínica nueva (src/app/api/auth/register/route.ts): ASCII, sin acentos,
 * máx 30 chars, con sufijo -1, -2… si ya existe.
 */
export async function generateClinicSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 30) || "sucursal";
  let slug = base;
  let i = 1;
  while (await prisma.clinic.findUnique({ where: { slug } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}
