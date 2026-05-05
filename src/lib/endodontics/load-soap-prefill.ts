// Endodontics — loader server-side del prefill SOAP para una cita.
// Spec §10.2. Si el paciente tiene tratamiento activo o un diagnóstico
// reciente sin tratamiento, devuelve un SoapPrefill listo para hidratar
// el editor cuando el doctor abre la nota.

import { prisma } from "@/lib/prisma";
import { prefillSoapForEndo } from "@/lib/helpers/soapPrefillEndo";
import type {
  EndodonticDiagnosisRow,
  EndodonticTreatmentFull,
  SoapPrefill,
} from "@/lib/types/endodontics";

const TREATMENT_INCLUDE = {
  diagnosis: true,
  rootCanals: { include: { conductometryFile: true } },
  intracanalMedications: { orderBy: { placedAt: "desc" as const } },
  followUps: {
    include: { controlFile: true },
    orderBy: { scheduledAt: "asc" as const },
  },
  retreatmentInfo: true,
  apicalSurgery: { include: { intraoperativeFile: true } },
};

export async function loadEndoSoapPrefill(args: {
  clinicId: string;
  patientId: string;
}): Promise<SoapPrefill | null> {
  const { clinicId, patientId } = args;

  // 1. Tratamiento EN_CURSO (más reciente) — caso ideal.
  let tx = (await prisma.endodonticTreatment.findFirst({
    where: { clinicId, patientId, deletedAt: null, outcomeStatus: "EN_CURSO" },
    orderBy: { startedAt: "desc" },
    include: TREATMENT_INCLUDE,
  })) as EndodonticTreatmentFull | null;

  // 2. Si no hay activo, último tratamiento (cualquier outcome) — para
  //    SOAP de cita de control.
  if (!tx) {
    tx = (await prisma.endodonticTreatment.findFirst({
      where: { clinicId, patientId, deletedAt: null },
      orderBy: { startedAt: "desc" },
      include: TREATMENT_INCLUDE,
    })) as EndodonticTreatmentFull | null;
  }

  let toothFdi: number;
  let activeTreatment: EndodonticTreatmentFull | null = null;
  let diagnosis: EndodonticDiagnosisRow | null = null;

  if (tx) {
    toothFdi = tx.toothFdi;
    activeTreatment = tx.outcomeStatus === "EN_CURSO" ? tx : null;
    diagnosis = tx.diagnosis ?? null;
  } else {
    // 3. Sin tratamiento, busca diagnóstico AAE más reciente — para
    //    cita de evaluación inicial.
    const dx = await prisma.endodonticDiagnosis.findFirst({
      where: { clinicId, patientId, deletedAt: null },
      orderBy: { diagnosedAt: "desc" },
    });
    if (!dx) return null;
    toothFdi = dx.toothFdi;
    diagnosis = dx;
  }

  const recentVitality = await prisma.vitalityTest.findMany({
    where: { clinicId, patientId, toothFdi, deletedAt: null },
    orderBy: { evaluatedAt: "desc" },
    take: 4,
  });

  const lastFollowUp = activeTreatment
    ? [...activeTreatment.followUps]
        .filter((f) => f.performedAt)
        .sort(
          (a, b) =>
            (b.performedAt?.getTime() ?? 0) - (a.performedAt?.getTime() ?? 0),
        )[0] ?? null
    : null;

  return prefillSoapForEndo({
    toothFdi,
    diagnosis,
    recentVitality,
    activeTreatment,
    lastFollowUp,
  });
}
