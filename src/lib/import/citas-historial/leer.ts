// Lectura del historial de citas migrado para la ficha del paciente ("Citas
// anteriores (migradas)", de solo lectura). Resiliente: migrated_visits se
// aplica a mano (sql/citas-historial-migradas.sql) y puede ir por detrás del
// deploy — mismo espíritu que pagos-historial/leer.ts.

import { prisma } from "@/lib/prisma";

function isMissingRelation(e: any): boolean {
  return e?.code === "P2021" || e?.code === "P2022";
}

export interface VisitaMigrada {
  id: string;
  startsAt: string;
  status: "COMPLETED" | "NO_SHOW" | "CANCELLED";
  type: string | null;
  notes: string | null;
  doctorId: string | null;
  doctorName: string | null;
  origin: string;
}

/** Las citas históricas migradas de UN paciente, aisladas por clínica, de la más reciente a la más vieja. */
export async function getMigratedVisits(clinicId: string, patientId: string): Promise<VisitaMigrada[]> {
  try {
    const rows = await prisma.migratedVisit.findMany({
      where: { clinicId, patientId },
      orderBy: { startsAt: "desc" },
      select: { id: true, startsAt: true, status: true, type: true, notes: true, doctorId: true, origin: true },
    });
    if (rows.length === 0) return [];
    const doctorIds = Array.from(new Set(rows.map((r) => r.doctorId).filter((id): id is string => !!id)));
    const doctores = doctorIds.length
      ? await prisma.user.findMany({ where: { id: { in: doctorIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nombreDoctor = new Map(doctores.map((d) => [d.id, `${d.firstName} ${d.lastName}`.trim()]));
    return rows.map((r) => ({
      id: r.id,
      startsAt: r.startsAt.toISOString(),
      status: r.status as VisitaMigrada["status"],
      type: r.type,
      notes: r.notes,
      doctorId: r.doctorId,
      doctorName: r.doctorId ? nombreDoctor.get(r.doctorId) ?? null : null,
      origin: r.origin,
    }));
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}
