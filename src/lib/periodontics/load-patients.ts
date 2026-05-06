// Periodontics — loader agregado para el panel de la especialidad.
// Devuelve filas de pacientes con plan o expediente periodontal, los
// 4 KPIs spec y la lista de doctores que clasificaron casos.

import type {
  PeriodontalGrade,
  PeriodontalPhase,
  PeriodontalRiskCategory,
  PeriodontalStage,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface PerioPatientRow {
  patientId: string;
  patientName: string;
  doctorId: string | null;
  doctorName: string | null;
  planId: string | null;
  currentPhase: PeriodontalPhase | null;
  stage: PeriodontalStage | null;
  grade: PeriodontalGrade | null;
  bopPct: number | null;
  riskCategory: PeriodontalRiskCategory | null;
  nextMaintenanceAt: Date | null;
  isMaintenanceOverdue: boolean;
}

export interface PerioSpecialtyKpis {
  activeCases: number;
  overdueMaintenance: number;
  pendingReevaluations: number;
  scheduledSurgeries: number;
}

export interface PerioSpecialtyDoctor {
  id: string;
  name: string;
}

export interface LoadPeriodonticPatientsResult {
  rows: PerioPatientRow[];
  kpis: PerioSpecialtyKpis;
  doctors: PerioSpecialtyDoctor[];
}

export async function loadPeriodonticPatients(
  clinicId: string,
): Promise<LoadPeriodonticPatientsResult> {
  const now = new Date();

  const [patientsWithRecords, plans, riskAssessments, scheduledSurgeriesCount] = await Promise.all([
    prisma.patient.findMany({
      where: {
        clinicId,
        deletedAt: null,
        periodontalRecords: { some: { deletedAt: null } },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        periodontalRecords: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            bopPercentage: true,
            classification: { select: { stage: true, grade: true, classifiedById: true } },
          },
        },
        periodontalPlans: {
          where: { deletedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: {
            id: true,
            currentPhase: true,
            nextEvaluationAt: true,
          },
        },
      },
      take: 500,
    }),
    prisma.periodontalTreatmentPlan.findMany({
      where: { clinicId, deletedAt: null },
      select: {
        id: true,
        patientId: true,
        currentPhase: true,
        nextEvaluationAt: true,
      },
    }),
    prisma.periodontalRiskAssessment.findMany({
      where: { clinicId, deletedAt: null },
      orderBy: { evaluatedAt: "desc" },
      select: { patientId: true, riskCategory: true },
      take: 500,
    }),
    prisma.periodontalSurgery.count({
      where: {
        clinicId,
        deletedAt: null,
        surgeryDate: { gt: now },
      },
    }),
  ]);

  const lastRiskByPatient = new Map<string, PeriodontalRiskCategory>();
  for (const r of riskAssessments) {
    if (!lastRiskByPatient.has(r.patientId)) lastRiskByPatient.set(r.patientId, r.riskCategory);
  }

  const doctorIds = new Set<string>();
  patientsWithRecords.forEach((p) => {
    const cls = p.periodontalRecords[0]?.classification;
    if (cls?.classifiedById) doctorIds.add(cls.classifiedById);
  });
  const doctors = await prisma.user.findMany({
    where: { id: { in: Array.from(doctorIds) }, isActive: true },
    select: { id: true, firstName: true, lastName: true },
  });
  const doctorById = new Map<string, { id: string; name: string }>();
  for (const d of doctors) {
    doctorById.set(d.id, { id: d.id, name: `${d.firstName} ${d.lastName}`.trim() });
  }

  const rows: PerioPatientRow[] = patientsWithRecords.map((p) => {
    const lastRecord = p.periodontalRecords[0];
    const cls = lastRecord?.classification ?? null;
    const plan = p.periodontalPlans[0] ?? null;
    const doctor = cls?.classifiedById ? doctorById.get(cls.classifiedById) : null;
    const isMaintenanceOverdue = Boolean(
      plan?.nextEvaluationAt && plan.nextEvaluationAt < now && plan.currentPhase === "PHASE_4",
    );
    return {
      patientId: p.id,
      patientName: `${p.firstName} ${p.lastName}`.trim(),
      doctorId: doctor?.id ?? null,
      doctorName: doctor?.name ?? null,
      planId: plan?.id ?? null,
      currentPhase: plan?.currentPhase ?? null,
      stage: cls?.stage ?? null,
      grade: cls?.grade ?? null,
      bopPct: lastRecord?.bopPercentage ?? null,
      riskCategory: lastRiskByPatient.get(p.id) ?? null,
      nextMaintenanceAt: plan?.nextEvaluationAt ?? null,
      isMaintenanceOverdue,
    };
  });

  const overdueMaintenance = plans.filter(
    (p) => p.nextEvaluationAt && p.nextEvaluationAt < now && p.currentPhase === "PHASE_4",
  ).length;
  const pendingReevaluations = plans.filter(
    (p) => p.nextEvaluationAt && p.nextEvaluationAt < now && p.currentPhase !== "PHASE_4",
  ).length;

  const doctorsList = Array.from(doctorById.values()).sort((a, b) => a.name.localeCompare(b.name));

  return {
    rows,
    kpis: {
      activeCases: plans.length,
      overdueMaintenance,
      pendingReevaluations,
      scheduledSurgeries: scheduledSurgeriesCount,
    },
    doctors: doctorsList,
  };
}
