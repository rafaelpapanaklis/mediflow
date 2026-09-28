import "server-only";
import { prisma } from "@/lib/prisma";
import { esCitaOrtoConHoja } from "@/lib/orthodontics/agenda-constants";
import { ESTADOS_DE_CITA_POR_VENIR } from "@/lib/orthodontics/cambio-de-doctor";

/** Los controles futuros del caso que NO están con su doctor tratante (para avisar o mover). */
export async function controlesConOtroDoctor(args: {
  clinicId: string;
  patientId: string;
  treatingDoctorId: string;
  ahora?: Date;
}): Promise<Array<{ id: string; startsAt: Date; endsAt: Date }>> {
  const { clinicId, patientId, treatingDoctorId } = args;
  if (!clinicId || !patientId || !treatingDoctorId) return [];
  const filas = await prisma.appointment.findMany({
    where: {
      clinicId,
      patientId,
      doctorId: { not: treatingDoctorId },
      status: { in: [...ESTADOS_DE_CITA_POR_VENIR] },
      startsAt: { gt: args.ahora ?? new Date() },
    },
    select: { id: true, type: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: "asc" },
    take: 50,
  });
  return filas.filter((f) => esCitaOrtoConHoja(f.type)).map(({ id, startsAt, endsAt }) => ({ id, startsAt, endsAt }));
}
