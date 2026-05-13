import { prisma } from "@/lib/prisma";

export interface PatientActivityCounts {
  pediatria:   number;
  periodoncia: number;
  endodoncia:  number;
  implantes:   number;
  ortodoncia:  number;
}

export interface LoadActivityCountsInput {
  clinicId: string;
  patientId: string;
}

/**
 * Conteo de registros del paciente por módulo de especialidad. Se usa para
 * atenuar items del quick-nav cuando el módulo está activo en la clínica
 * pero el paciente todavía no tiene registros en esa especialidad. El item
 * permanece clickable — la atenuación solo des-prioriza visualmente.
 *
 * Implantes excluye los REMOVED. El resto filtra soft-deletes por
 * `deletedAt: null`.
 */
export async function getPatientActivityCounts(
  input: LoadActivityCountsInput,
): Promise<PatientActivityCounts> {
  const base = { patientId: input.patientId, clinicId: input.clinicId };

  const [pediatria, periodoncia, endodoncia, implantes, ortodoncia] = await Promise.all([
    prisma.pediatricRecord.count({          where: { ...base, deletedAt: null } }),
    prisma.periodontalRecord.count({        where: { ...base, deletedAt: null } }),
    prisma.endodonticTreatment.count({      where: { ...base, deletedAt: null } }),
    prisma.implant.count({                  where: { ...base, currentStatus: { not: "REMOVED" } } }),
    prisma.orthodonticTreatmentPlan.count({ where: { ...base, deletedAt: null } }),
  ]);

  return { pediatria, periodoncia, endodoncia, implantes, ortodoncia };
}
