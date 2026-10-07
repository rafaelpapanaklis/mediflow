import { prisma } from "@/lib/prisma";
import { getPlanLimitsForClinic } from "@/lib/plans";
import { CLINIC_OVERRIDE_SELECT } from "@/lib/billing/plan-overrides";
import { cupoDeUsuarios, type CupoUsuarios } from "./cupo-usuarios-shared";
import { sedesDelDueno } from "@/lib/storage-owner";
import { personasDistintas } from "./sede-adicional";

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
  // M7: con tope finito, el cupo es POR DUEÑO (como almacenamiento e IA): una madre con
  // `maxUsersOverride` lo hereda a cada sede y, contado por sede, el tope se multiplicaba.
  // Se cuentan las personas distintas con ficha activa en todas las sedes vivas del dueño.
  // Sin tope (Clínica nuevo) no se gasta la consulta extra.
  if (maxUsers !== null) {
    const sedes = await sedesDelDueno(clinicId);
    if (sedes.length > 1) {
      const filas = await prisma.user.findMany({
        where: { clinicId: { in: sedes }, isActive: true },
        select: { supabaseId: true },
      });
      return cupoDeUsuarios(personasDistintas(filas), maxUsers);
    }
  }
  return cupoDeUsuarios(usados, maxUsers);
}
