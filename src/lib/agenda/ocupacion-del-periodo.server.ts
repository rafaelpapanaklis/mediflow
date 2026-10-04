// Cargador de la OCUPACIÓN por horario de un periodo (ws1-t2, C-26). La cuenta
// vive en `ocupacion-del-periodo.ts` (pura). `clinicId` SIEMPRE de la sesión:
// sin él no se consulta (`clinicId: undefined` no filtra nada en Prisma).
// Tres lecturas en paralelo (horario, quién recibe citas, citas del periodo).

import { prisma } from "@/lib/prisma";
import { RECIBE_CITAS_WHERE } from "@/lib/agenda/roles-que-atienden";
import { ocupacionDelPeriodo, type OcupacionDelPeriodo } from "./ocupacion-del-periodo";

export async function cargarOcupacionDelPeriodo(
  clinicId: string,
  zona: string,
  desde: Date,
  hasta: Date,
): Promise<OcupacionDelPeriodo> {
  if (!clinicId) throw new Error("sesion_invalida: falta clinicId");
  const [schedules, profesionales, citas] = await Promise.all([
    prisma.clinicSchedule.findMany({
      where: { clinicId },
      select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
    }),
    prisma.user.findMany({ where: { clinicId, ...RECIBE_CITAS_WHERE }, select: { id: true } }),
    prisma.appointment.findMany({
      where: { clinicId, startsAt: { gte: desde, lt: hasta }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
      select: { startsAt: true, endsAt: true, status: true, doctorId: true },
    }),
  ]);
  return ocupacionDelPeriodo({
    desde,
    hasta,
    zona,
    schedules,
    profesionales: profesionales.map((p) => p.id),
    citas,
  });
}
