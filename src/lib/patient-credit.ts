// Saldo a favor (crédito) del paciente. v1 SIN consumo: el saldo a favor =
// SUM(amount) de patient_credits; NO se descuenta de los adeudos (facturas).
// Aislamiento por clínica SIEMPRE vía where clinicId.
//
// Resiliencia: la tabla patient_credits se aplica a MANO (sql/patient-credits.sql)
// y puede ir por detrás del deploy. Si aún no existe (P2021) o le falta una
// columna (P2022), estas lecturas devuelven 0 en vez de tumbar el perfil del
// paciente / la cobranza (mismo espíritu que la resiliencia de clinic-layout).

import { prisma } from "@/lib/prisma";

/** Códigos Prisma de "tabla/columna inexistente" → tratamos como saldo 0. */
function isMissingRelation(e: any): boolean {
  return e?.code === "P2021" || e?.code === "P2022";
}

/** Saldo a favor total de UN paciente (SUM amount), aislado por clínica. */
export async function getPatientCreditBalance(clinicId: string, patientId: string): Promise<number> {
  try {
    const agg = await prisma.patientCredit.aggregate({
      where: { clinicId, patientId },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  } catch (e) {
    if (isMissingRelation(e)) return 0;
    throw e;
  }
}

/** Saldo a favor total de TODA la clínica (suma de todos los créditos). */
export async function getClinicCreditTotal(clinicId: string): Promise<number> {
  try {
    const agg = await prisma.patientCredit.aggregate({
      where: { clinicId },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  } catch (e) {
    if (isMissingRelation(e)) return 0;
    throw e;
  }
}
