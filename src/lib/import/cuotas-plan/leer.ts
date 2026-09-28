// Lectura del plan de pagos a plazos migrado para la ficha del paciente
// ("Plan de pagos a plazos (migrado)", de solo lectura). Resiliente: la tabla
// migrated_installments se aplica a mano (sql/cuotas-por-vencer-migradas.sql)
// y puede ir por detrás del deploy — mismo espíritu que patient-credit.ts con
// patient_credits.

import { prisma } from "@/lib/prisma";

function isMissingRelation(e: any): boolean {
  return e?.code === "P2021" || e?.code === "P2022";
}

export interface CuotaMigrada {
  id: string;
  installmentNumber: number;
  amount: number;
  dueDate: string;
  status: string;
  paidAt: string | null;
  concept: string | null;
  planExternalId: string | null;
  origin: string;
}

/** Las cuotas migradas de UN paciente, aisladas por clínica, ordenadas por vencimiento. */
export async function getMigratedInstallments(clinicId: string, patientId: string): Promise<CuotaMigrada[]> {
  try {
    const rows = await prisma.migratedInstallment.findMany({
      where: { clinicId, patientId },
      orderBy: [{ dueDate: "asc" }, { installmentNumber: "asc" }],
      select: {
        id: true,
        installmentNumber: true,
        amount: true,
        dueDate: true,
        status: true,
        paidAt: true,
        concept: true,
        planExternalId: true,
        origin: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      installmentNumber: r.installmentNumber,
      amount: r.amount,
      dueDate: r.dueDate.toISOString(),
      status: r.status,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      concept: r.concept,
      planExternalId: r.planExternalId,
      origin: r.origin,
    }));
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}
