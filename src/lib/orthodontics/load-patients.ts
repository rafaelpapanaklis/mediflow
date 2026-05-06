// Orthodontics — loader agregado para el panel de la especialidad.
// Devuelve filas para la tabla, KPIs y la lista de doctores diagnosticantes.
// A diferencia de buildKanbanData, incluye los diagnósticos huérfanos (sin
// plan) como filas con status "DIAGNOSIS_ONLY" para que el doctor pueda
// retomarlos desde la lista agregada.

import { differenceInMonths, endOfDay, startOfDay } from "date-fns";
import type {
  OrthoPaymentStatus,
  OrthoPhaseKey,
  OrthoTreatmentStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PHASE_ORDER } from "./phase-machine";
import { computePaymentStatus } from "./payment-status";

export type OrthoRowStatus = OrthoTreatmentStatus | "DIAGNOSIS_ONLY";

export interface OrthoPatientRow {
  patientId: string;
  patientName: string;
  doctorId: string | null;
  doctorName: string | null;
  status: OrthoRowStatus;
  treatmentPlanId: string | null;
  diagnosisId: string;
  currentPhase: OrthoPhaseKey | null;
  monthInTreatment: number | null;
  estimatedDurationMonths: number | null;
  nextAppointmentAt: Date | null;
  paymentStatus: OrthoPaymentStatus | "NONE";
  amountOverdueMxn: number;
}

export interface OrthoSpecialtyKpis {
  activeTreatments: number;
  todayAppointments: number;
  overduePaymentsCount: number;
  overduePaymentsAmountMxn: number;
  finishingSoon: number;
}

export interface OrthoSpecialtyDoctor {
  id: string;
  name: string;
}

export interface LoadOrthodonticPatientsResult {
  rows: OrthoPatientRow[];
  kpis: OrthoSpecialtyKpis;
  doctors: OrthoSpecialtyDoctor[];
}

const ACTIVE_PLAN_STATUSES: OrthoTreatmentStatus[] = [
  "PLANNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "RETENTION",
];

export async function loadOrthodonticPatients(
  clinicId: string,
): Promise<LoadOrthodonticPatientsResult> {
  const now = new Date();

  const [diagnoses, todayAppointmentsCount] = await Promise.all([
    prisma.orthodonticDiagnosis.findMany({
      where: { clinicId, deletedAt: null },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        diagnosedBy: { select: { id: true, firstName: true, lastName: true } },
        treatmentPlan: {
          include: {
            phases: { orderBy: { orderIndex: "asc" } },
            paymentPlan: {
              include: {
                installments: {
                  select: { amount: true, dueDate: true, status: true, paidAt: true },
                },
              },
            },
            controls: {
              orderBy: { scheduledAt: "asc" },
              select: { scheduledAt: true, performedAt: true },
            },
          },
        },
      },
      orderBy: { diagnosedAt: "desc" },
      take: 500,
    }),
    prisma.orthodonticControlAppointment.count({
      where: {
        clinicId,
        scheduledAt: { gte: startOfDay(now), lte: endOfDay(now) },
      },
    }),
  ]);

  const rows: OrthoPatientRow[] = diagnoses.map((dx) => {
    const plan = dx.treatmentPlan;
    const doctor = dx.diagnosedBy;
    const baseRow = {
      patientId: dx.patient.id,
      patientName: `${dx.patient.firstName} ${dx.patient.lastName}`.trim(),
      doctorId: doctor?.id ?? null,
      doctorName: doctor ? `${doctor.firstName} ${doctor.lastName}`.trim() : null,
      diagnosisId: dx.id,
    };

    if (!plan) {
      return {
        ...baseRow,
        status: "DIAGNOSIS_ONLY" as const,
        treatmentPlanId: null,
        currentPhase: null,
        monthInTreatment: null,
        estimatedDurationMonths: null,
        nextAppointmentAt: null,
        paymentStatus: "NONE" as const,
        amountOverdueMxn: 0,
      };
    }

    const monthInTreatment = plan.installedAt
      ? Math.max(0, differenceInMonths(now, plan.installedAt))
      : 0;
    const currentPhase =
      plan.phases.find((ph) => ph.status === "IN_PROGRESS")?.phaseKey ?? PHASE_ORDER[0]!;
    const upcoming = plan.controls.find((c) => c.performedAt === null && c.scheduledAt >= now);
    const paymentSummary = plan.paymentPlan
      ? computePaymentStatus(
          plan.paymentPlan.installments.map((i) => ({
            amount: Number(i.amount),
            dueDate: i.dueDate,
            status: i.status,
            paidAt: i.paidAt,
          })),
          now,
        )
      : { status: "ON_TIME" as const, daysOverdue: 0, amountOverdue: 0 };

    return {
      ...baseRow,
      status: plan.status,
      treatmentPlanId: plan.id,
      currentPhase,
      monthInTreatment,
      estimatedDurationMonths: plan.estimatedDurationMonths,
      nextAppointmentAt: upcoming?.scheduledAt ?? null,
      paymentStatus: paymentSummary.status,
      amountOverdueMxn: Math.round(paymentSummary.amountOverdue),
    };
  });

  const activeTreatments = rows.filter(
    (r) => r.treatmentPlanId !== null && ACTIVE_PLAN_STATUSES.includes(r.status as OrthoTreatmentStatus),
  ).length;

  const overdueRows = rows.filter(
    (r) => r.paymentStatus === "LIGHT_DELAY" || r.paymentStatus === "SEVERE_DELAY",
  );
  const overduePaymentsCount = overdueRows.length;
  const overduePaymentsAmountMxn = overdueRows.reduce((s, r) => s + r.amountOverdueMxn, 0);

  const finishingSoon = rows.filter((r) => {
    if (r.estimatedDurationMonths === null || r.monthInTreatment === null) return false;
    const remaining = r.estimatedDurationMonths - r.monthInTreatment;
    return remaining >= 0 && remaining <= 1 && r.status === "IN_PROGRESS";
  }).length;

  const doctorsMap = new Map<string, OrthoSpecialtyDoctor>();
  for (const r of rows) {
    if (r.doctorId && r.doctorName && !doctorsMap.has(r.doctorId)) {
      doctorsMap.set(r.doctorId, { id: r.doctorId, name: r.doctorName });
    }
  }

  return {
    rows,
    kpis: {
      activeTreatments,
      todayAppointments: todayAppointmentsCount,
      overduePaymentsCount,
      overduePaymentsAmountMxn,
      finishingSoon,
    },
    doctors: Array.from(doctorsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
