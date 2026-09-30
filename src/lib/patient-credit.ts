// Saldo a favor (crédito) del paciente: SUM(amount) de patient_credits, que es
// un libro de movimientos. Al emitir una factura NUEVA el saldo se aplica como
// un Payment «anticipo» más una fila NEGATIVA aquí (patient-credit-aplicar.ts),
// así que esta suma ya sale descontada. Las facturas anteriores al cambio no se
// tocaron. Aislamiento por clínica SIEMPRE vía where clinicId.
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

/**
 * ws1-t4 — el saldo a favor de VARIOS pacientes en una sola consulta (Cobranza
 * de ortodoncia, una fila por caso). Misma suma que `getPatientCreditBalance`,
 * así que cada fila dice lo mismo que el resumen del paciente. Sin tabla, o si
 * la lectura falla, un mapa vacío (saldo 0): la pantalla no se cae por esto.
 */
export async function getPatientCreditBalances(clinicId: string, patientIds: string[]): Promise<Map<string, number>> {
  const salida = new Map<string, number>();
  const ids = Array.from(new Set(patientIds.filter(Boolean)));
  if (!clinicId || ids.length === 0) return salida;
  try {
    const filas = await prisma.patientCredit.groupBy({
      by: ["patientId"],
      where: { clinicId, patientId: { in: ids } },
      _sum: { amount: true },
    });
    for (const f of filas) salida.set(f.patientId, Math.round((f._sum.amount ?? 0) * 100) / 100);
  } catch (e) {
    if (!isMissingRelation(e)) console.warn("[saldo-a-favor] no se pudo leer el saldo de los pacientes:", (e as Error)?.message);
  }
  return salida;
}
