// Lectura del historial de pagos migrado para la ficha del paciente
// ("Pagos anteriores (migrados)", de solo lectura). Resiliente: la tabla
// migrated_payments se aplica a mano (sql/pagos-historial-migrados.sql) y
// puede ir por detrás del deploy — mismo espíritu que patient-credit.ts con
// patient_credits (P2021/P2022 → lista vacía, nunca tumba la ficha).

import { prisma } from "@/lib/prisma";

function isMissingRelation(e: any): boolean {
  return e?.code === "P2021" || e?.code === "P2022";
}

export interface PagoMigrado {
  id: string;
  amount: number;
  method: string | null;
  concept: string | null;
  doctorId: string | null;
  doctorName: string | null;
  paidAt: string;
  origin: string;
}

/** Los pagos históricos migrados de UN paciente, aislados por clínica, del más reciente al más viejo. */
export async function getMigratedPayments(clinicId: string, patientId: string): Promise<PagoMigrado[]> {
  try {
    const rows = await prisma.migratedPayment.findMany({
      where: { clinicId, patientId },
      orderBy: { paidAt: "desc" },
      select: {
        id: true,
        amount: true,
        method: true,
        concept: true,
        doctorId: true,
        paidAt: true,
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
      amount: r.amount,
      method: r.method,
      concept: r.concept,
      doctorId: r.doctorId,
      doctorName: r.doctorId ? nombreDoctor.get(r.doctorId) ?? null : null,
      paidAt: r.paidAt.toISOString(),
      origin: r.origin,
    }));
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}
