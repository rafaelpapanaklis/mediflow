// Lectura de casos de ortodoncia migrados para la ficha del paciente
// ("Casos de ortodoncia (migrados)", de solo lectura). Resiliente: la tabla
// migrated_ortho_cases se aplica a mano (sql/ortodoncia-casos-migrados.sql) y
// puede ir por detrás del deploy — mismo espíritu que pagos-historial/leer.ts
// con migrated_payments (P2021/P2022 → lista vacía, nunca tumba la ficha).

import { prisma } from "@/lib/prisma";

function isMissingRelation(e: any): boolean {
  return e?.code === "P2021" || e?.code === "P2022";
}

export interface CasoOrthoMigrado {
  id: string;
  technique: string | null;
  treatingDoctorId: string | null;
  treatingDoctorName: string | null;
  status: string;
  statusRaw: string | null;
  installedAt: string | null;
  estimatedDurationMonths: number | null;
  totalAmount: number | null;
  originInvoiceFolio: string | null;
  origin: string;
}

/** Los casos de ortodoncia migrados de UN paciente, aislados por clínica, del más reciente al más viejo. */
export async function getMigratedOrthoCases(clinicId: string, patientId: string): Promise<CasoOrthoMigrado[]> {
  try {
    const rows = await prisma.migratedOrthoCase.findMany({
      where: { clinicId, patientId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        technique: true,
        treatingDoctorId: true,
        treatingDoctorName: true,
        status: true,
        statusRaw: true,
        installedAt: true,
        estimatedDurationMonths: true,
        totalAmount: true,
        originInvoiceFolio: true,
        origin: true,
      },
    });
    if (rows.length === 0) return [];
    const doctorIds = Array.from(new Set(rows.map((r) => r.treatingDoctorId).filter((id): id is string => !!id)));
    const doctores = doctorIds.length
      ? await prisma.user.findMany({ where: { id: { in: doctorIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nombreDoctor = new Map(doctores.map((d) => [d.id, `${d.firstName} ${d.lastName}`.trim()]));
    return rows.map((r) => ({
      id: r.id,
      technique: r.technique,
      treatingDoctorId: r.treatingDoctorId,
      treatingDoctorName: r.treatingDoctorId ? nombreDoctor.get(r.treatingDoctorId) ?? r.treatingDoctorName : r.treatingDoctorName,
      status: r.status,
      statusRaw: r.statusRaw,
      installedAt: r.installedAt ? r.installedAt.toISOString() : null,
      estimatedDurationMonths: r.estimatedDurationMonths,
      totalAmount: r.totalAmount,
      originInvoiceFolio: r.originInvoiceFolio,
      origin: r.origin,
    }));
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}
