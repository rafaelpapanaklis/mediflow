// Endodontics — loader agregado para el panel de la especialidad.
// KPIs spec §6 + filas de la tabla por tratamiento.

import type { EndoOutcomeStatus, EndoTreatmentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeEndoCountsFromRows } from "./specialty-kpis";

export { computeEndoCountsFromRows };

export type EndoRowStatus = EndoOutcomeStatus | "RESTORATION_PENDING";

export interface EndoPatientRow {
  treatmentId: string;
  patientId: string;
  patientName: string;
  toothFdi: number;
  treatmentType: EndoTreatmentType;
  doctorId: string | null;
  doctorName: string | null;
  outcomeStatus: EndoOutcomeStatus;
  currentStep: number;
  sessionsCount: number;
  startedAt: Date;
  completedAt: Date | null;
  needsRestoration: boolean;
  nextFollowUpAt: Date | null;
  nextFollowUpMilestone: string | null;
}

export interface EndoSpecialtyKpis {
  activeTreatments: number;
  pendingFollowUps: number;
  retreatmentsActive: number;
  pendingRestorations: number;
}

export interface EndoSpecialtyDoctor {
  id: string;
  name: string;
}

export interface LoadEndodonticPatientsResult {
  rows: EndoPatientRow[];
  kpis: EndoSpecialtyKpis;
  doctors: EndoSpecialtyDoctor[];
}

export async function loadEndodonticPatients(
  clinicId: string,
): Promise<LoadEndodonticPatientsResult> {
  const treatments = await prisma.endodonticTreatment.findMany({
    where: { clinicId, deletedAt: null },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true } },
      doctor: { select: { id: true, firstName: true, lastName: true } },
      followUps: {
        where: { performedAt: null, deletedAt: null },
        orderBy: { scheduledAt: "asc" },
        select: { milestone: true, scheduledAt: true },
      },
    },
    orderBy: { startedAt: "desc" },
    take: 500,
  });

  const rows: EndoPatientRow[] = treatments.map((t) => {
    const upcoming = t.followUps[0] ?? null;
    const needsRestoration =
      t.completedAt !== null && t.postOpRestorationCompletedAt === null;
    return {
      treatmentId: t.id,
      patientId: t.patient.id,
      patientName: `${t.patient.firstName} ${t.patient.lastName}`.trim(),
      toothFdi: t.toothFdi,
      treatmentType: t.treatmentType,
      doctorId: t.doctor?.id ?? null,
      doctorName: t.doctor ? `${t.doctor.firstName} ${t.doctor.lastName}`.trim() : null,
      outcomeStatus: t.outcomeStatus,
      currentStep: t.currentStep,
      sessionsCount: t.sessionsCount,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      needsRestoration,
      nextFollowUpAt: upcoming?.scheduledAt ?? null,
      nextFollowUpMilestone: upcoming?.milestone ?? null,
    };
  });

  const partialKpis = computeEndoCountsFromRows(rows);

  const pendingFollowUpsAgg = await prisma.endodonticFollowUp.count({
    where: {
      treatment: { clinicId, deletedAt: null },
      performedAt: null,
      deletedAt: null,
    },
  });

  const doctorsMap = new Map<string, EndoSpecialtyDoctor>();
  for (const r of rows) {
    if (r.doctorId && r.doctorName && !doctorsMap.has(r.doctorId)) {
      doctorsMap.set(r.doctorId, { id: r.doctorId, name: r.doctorName });
    }
  }

  return {
    rows,
    kpis: { ...partialKpis, pendingFollowUps: pendingFollowUpsAgg },
    doctors: Array.from(doctorsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

