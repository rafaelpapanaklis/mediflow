// Lectura del historial de gastos de laboratorio migrado para la ficha del
// paciente ("Gastos de laboratorio (migrados)", de solo lectura). Resiliente:
// la tabla migrated_lab_expenses se aplica a mano
// (sql/laboratorio-historial-migrado.sql) y puede ir por detrás del deploy —
// mismo espíritu que pagos-historial/leer.ts con migrated_payments (P2021/
// P2022 → lista vacía, nunca tumba la ficha).

import { prisma } from "@/lib/prisma";

function isMissingRelation(e: any): boolean {
  return e?.code === "P2021" || e?.code === "P2022";
}

export interface GastoLaboratorioMigrado {
  id: string;
  labName: string | null;
  action: string;
  cost: number;
  patientPrice: number | null;
  doctorId: string | null;
  doctorName: string | null;
  incurredAt: string;
  origin: string;
}

/** Los gastos de laboratorio históricos migrados de UN paciente, aislados por clínica, del más reciente al más viejo. */
export async function getMigratedLabExpenses(clinicId: string, patientId: string): Promise<GastoLaboratorioMigrado[]> {
  try {
    const rows = await prisma.migratedLabExpense.findMany({
      where: { clinicId, patientId },
      orderBy: { incurredAt: "desc" },
      select: {
        id: true,
        labName: true,
        action: true,
        cost: true,
        patientPrice: true,
        doctorId: true,
        incurredAt: true,
        origin: true,
      },
    });
    if (rows.length === 0) return [];
    const doctorIds = Array.from(new Set(rows.map((r) => r.doctorId).filter((id): id is string => !!id)));
    const doctores = doctorIds.length
      ? await prisma.user.findMany({ where: { id: { in: doctorIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nombreDoctor = new Map(doctores.map((d) => [d.id, `${d.firstName} ${d.lastName}`.trim()]));
    return rows.map((r) => ({
      id: r.id,
      labName: r.labName,
      action: r.action,
      cost: r.cost,
      patientPrice: r.patientPrice,
      doctorId: r.doctorId,
      doctorName: r.doctorId ? nombreDoctor.get(r.doctorId) ?? null : null,
      incurredAt: r.incurredAt.toISOString(),
      origin: r.origin,
    }));
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}
