import { prisma } from "@/lib/prisma";
import { getPlanLimitsForClinic } from "@/lib/plans";
import { CLINIC_OVERRIDE_SELECT } from "@/lib/billing/plan-overrides";
import { cupoDeUsuarios, type CupoUsuarios } from "./cupo-usuarios-shared";

/**
 * FUENTE ÚNICA del cupo de usuarios de UNA clínica. La usan POST /api/team,
 * el PATCH que reactiva y la pantalla de Equipo. `clinicId` sale de la sesión.
 */
export async function getCupoUsuarios(clinicId: string): Promise<CupoUsuarios> {
  if (!clinicId) throw new Error("getCupoUsuarios: falta clinicId");
  const [clinic, usados] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: clinicId }, select: CLINIC_OVERRIDE_SELECT }),
    prisma.user.count({ where: { clinicId, isActive: true } }),
  ]);
  if (!clinic) throw new Error("getCupoUsuarios: clínica no encontrada");
  const { maxUsers } = await getPlanLimitsForClinic(clinic);
  return cupoDeUsuarios(usados, maxUsers);
}
