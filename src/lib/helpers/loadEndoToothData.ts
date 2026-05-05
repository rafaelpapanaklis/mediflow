// Endodontics — helper compartido que arma ToothCenterViewData. Spec §6.

import { prisma } from "@/lib/prisma";
import type {
  ToothCenterViewData,
  EndoToothSummary,
} from "@/lib/types/endodontics";
import {
  categorizeTooth,
  defaultCanalsForFdi,
  selectCanalSvg,
} from "./canalAnatomy";

const PERMANENT_FDIS = [
  11, 12, 13, 14, 15, 16, 17, 18,
  21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
];

/**
 * Devuelve el centerData para un diente específico de un paciente.
 * Devuelve null si paciente no existe o no pertenece al clinicId.
 */
export async function loadEndoToothData(args: {
  clinicId: string;
  patientId: string;
  toothFdi: number;
}): Promise<ToothCenterViewData | null> {
  const patient = await prisma.patient.findFirst({
    where: { id: args.patientId, clinicId: args.clinicId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!patient) return null;

  const [diagnosis, recentVitality, treatments] = await Promise.all([
    prisma.endodonticDiagnosis.findFirst({
      where: {
        clinicId: args.clinicId,
        patientId: args.patientId,
        toothFdi: args.toothFdi,
        deletedAt: null,
      },
      orderBy: { diagnosedAt: "desc" },
    }),
    prisma.vitalityTest.findMany({
      where: {
        clinicId: args.clinicId,
        patientId: args.patientId,
        toothFdi: args.toothFdi,
        deletedAt: null,
      },
      orderBy: { evaluatedAt: "desc" },
      take: 8,
    }),
    prisma.endodonticTreatment.findMany({
      where: {
        clinicId: args.clinicId,
        patientId: args.patientId,
        toothFdi: args.toothFdi,
        deletedAt: null,
      },
      include: {
        diagnosis: true,
        rootCanals: { include: { conductometryFile: true } },
        intracanalMedications: { orderBy: { placedAt: "desc" } },
        followUps: { include: { controlFile: true }, orderBy: { scheduledAt: "asc" } },
        retreatmentInfo: true,
        apicalSurgery: { include: { intraoperativeFile: true } },
      },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  const activeTreatment = treatments.find((t) => t.outcomeStatus === "EN_CURSO") ?? null;
  const pastTreatments = treatments.filter((t) => t.outcomeStatus !== "EN_CURSO");

  const archetype = selectCanalSvg({
    fdi: args.toothFdi,
    actualCanals: activeTreatment?.rootCanals.map((c) => c.canonicalName) ?? defaultCanalsForFdi(args.toothFdi),
  });

  return {
    patientId: patient.id,
    patientName: `${patient.firstName} ${patient.lastName}`.trim(),
    toothFdi: args.toothFdi,
    category: categorizeTooth(args.toothFdi),
    archetype,
    diagnosis,
    recentVitality,
    activeTreatment,
    pastTreatments,
  };
}

/**
 * Devuelve el resumen de los 32 dientes para colorear el odontograma
 * miniatura. Lee tratamientos + follow-ups por paciente.
 */
export async function loadEndoToothSummaries(args: {
  clinicId: string;
  patientId: string;
}): Promise<EndoToothSummary[]> {
  const treatments = await prisma.endodonticTreatment.findMany({
    where: { clinicId: args.clinicId, patientId: args.patientId, deletedAt: null },
    include: { followUps: true },
  });

  return PERMANENT_FDIS.map((fdi) => {
    const txs = treatments.filter((t) => t.toothFdi === fdi);
    if (txs.length === 0) {
      return {
        fdi,
        hasActiveTreatment: false,
        outcomeStatus: null,
        hasPendingFollowUp: false,
        hasPendingRestoration: false,
        treatmentsCount: 0,
      };
    }
    const active = txs.find((t) => t.outcomeStatus === "EN_CURSO");
    const completed = txs.find((t) => t.outcomeStatus === "COMPLETADO");
    const pendingRestoration = txs.some(
      (t) => t.completedAt !== null && t.postOpRestorationCompletedAt === null,
    );
    const pendingFollowUp = txs.some((t) =>
      t.followUps.some((f) => f.performedAt === null && f.scheduledAt > new Date()),
    );
    return {
      fdi,
      hasActiveTreatment: Boolean(active),
      outcomeStatus: active?.outcomeStatus ?? completed?.outcomeStatus ?? txs[0]!.outcomeStatus,
      hasPendingFollowUp: pendingFollowUp,
      hasPendingRestoration: pendingRestoration,
      treatmentsCount: txs.length,
    };
  });
}
