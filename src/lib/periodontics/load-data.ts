// Periodontics — helper compartido que arma PerioTabData. SPEC §6 + §10.
//
// Usado por:
//   - /dashboard/specialties/periodontics/[patientId]/page.tsx (página dedicada)
//   - /dashboard/patients/[id]/page.tsx                         (tab embebida)
//
// Multi-tenant: el caller pasa clinicId; este helper lo respeta en todas
// las queries. El gating (canAccessModule + categoría DENTAL) se asume
// validado por el caller — esta función solo carga datos.

import { prisma } from "@/lib/prisma";
import { computePerioMetrics } from "./periodontogram-math";
import { MAINTENANCE_REMINDER_TYPES } from "./maintenance-reminders";
import type { Site, ToothLevel } from "./schemas";
import type { PeriodonticsClientProps } from "@/components/specialties/periodontics/PeriodonticsClient";

export interface LoadPerioDataInput {
  clinicId: string;
  patientId: string;
}

export type PerioTabData = Omit<PeriodonticsClientProps, never> & {
  /** Conteo total de PeriodontalRecord activos del paciente — útil para empty state. */
  recordsCount: number;
};

/**
 * Devuelve `null` si el paciente no existe, fue eliminado o no pertenece a
 * la clínica. El caller decide qué hacer (404, redirect, fallback).
 */
export async function loadPerioData(
  input: LoadPerioDataInput,
): Promise<PerioTabData | null> {
  const patient = await prisma.patient.findFirst({
    where: { id: input.patientId, clinicId: input.clinicId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      chronicConditions: true,
      allergies: true,
      currentMedications: true,
    },
  });
  if (!patient) return null;

  const [latestRecord, plan, surgeries, maintenanceRecords, lastRisk, allBopRecords, recordsCount, nextMaintenanceReminder] =
    await Promise.all([
      prisma.periodontalRecord.findFirst({
        where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { classification: true },
      }),
      prisma.periodontalTreatmentPlan.findFirst({
        where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
      }),
      prisma.periodontalSurgery.findMany({
        where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
        orderBy: { surgeryDate: "desc" },
        take: 30,
      }),
      prisma.periodontalRecord.findMany({
        where: {
          patientId: patient.id,
          clinicId: input.clinicId,
          deletedAt: null,
          recordType: "MANTENIMIENTO",
        },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, createdAt: true, bopPercentage: true, plaqueIndexOleary: true },
      }),
      prisma.periodontalRiskAssessment.findFirst({
        where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
        orderBy: { evaluatedAt: "desc" },
      }),
      prisma.periodontalRecord.findMany({
        where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { createdAt: true, bopPercentage: true },
      }),
      prisma.periodontalRecord.count({
        where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
      }),
      prisma.clinicalReminder.findFirst({
        where: {
          patientId: patient.id,
          clinicId: input.clinicId,
          module: "periodontics",
          status: "pending",
          deletedAt: null,
          reminderType: { in: [...MAINTENANCE_REMINDER_TYPES] },
        },
        orderBy: { dueDate: "asc" },
        select: { id: true, dueDate: true, reminderType: true },
      }),
    ]);

  const sites = ((latestRecord?.sites as unknown as Site[] | null) ?? []) as Site[];
  const teeth = ((latestRecord?.toothLevel as unknown as ToothLevel[] | null) ?? []) as ToothLevel[];
  const metrics = latestRecord ? computePerioMetrics(sites, teeth) : null;

  const fmt = (d: Date) => d.toLocaleDateString("es-MX");
  const fullName = `${patient.firstName} ${patient.lastName}`.trim();

  const recallMonths =
    lastRisk &&
    (lastRisk.recommendedRecallMonths === 3 ||
      lastRisk.recommendedRecallMonths === 4 ||
      lastRisk.recommendedRecallMonths === 6)
      ? (lastRisk.recommendedRecallMonths as 3 | 4 | 6)
      : null;

  return {
    patientId: patient.id,
    patientName: fullName,
    recordId: latestRecord?.id,
    initialSites: sites,
    initialTeeth: teeth,
    initialMetrics: metrics,
    classification: latestRecord?.classification
      ? {
          id: latestRecord.classification.id,
          stage: latestRecord.classification.stage,
          grade: latestRecord.classification.grade,
          extension: latestRecord.classification.extension,
          overridden: latestRecord.classification.overriddenByDoctor,
        }
      : null,
    riskCategory: lastRisk?.riskCategory ?? null,
    recallMonths,
    nextMaintenanceAt: pickEarliestMaintenanceDate(
      plan?.nextEvaluationAt ?? null,
      nextMaintenanceReminder?.dueDate ?? null,
      fmt,
    ),
    bopHistory: allBopRecords.map((r) => ({
      date: fmt(r.createdAt),
      bopPct: r.bopPercentage ?? 0,
    })),
    alerts: buildAlerts(metrics, surgeries.length),
    systemicFactors: buildSystemicFactors(patient),
    plan: plan
      ? {
          currentPhase: plan.currentPhase,
          phaseDates: {
            phase1StartedAt: plan.phase1StartedAt ? fmt(plan.phase1StartedAt) : null,
            phase1CompletedAt: plan.phase1CompletedAt ? fmt(plan.phase1CompletedAt) : null,
            phase2StartedAt: plan.phase2StartedAt ? fmt(plan.phase2StartedAt) : null,
            phase2CompletedAt: plan.phase2CompletedAt ? fmt(plan.phase2CompletedAt) : null,
            phase3StartedAt: plan.phase3StartedAt ? fmt(plan.phase3StartedAt) : null,
            phase3CompletedAt: plan.phase3CompletedAt ? fmt(plan.phase3CompletedAt) : null,
            phase4StartedAt: plan.phase4StartedAt ? fmt(plan.phase4StartedAt) : null,
          },
        }
      : null,
    surgeries: surgeries.map((s) => ({
      id: s.id,
      surgeryDate: fmt(s.surgeryDate),
      surgeryType: s.surgeryType,
      teeth: extractTeethFromTreatedSites(s.treatedSites),
      sutureRemovalDate: s.sutureRemovalDate ? fmt(s.sutureRemovalDate) : null,
      hasConsent: Boolean(s.consentSignedFileId),
    })),
    maintenanceHistory: maintenanceRecords.map((m) => ({
      id: m.id,
      date: fmt(m.createdAt),
      bopPct: m.bopPercentage ?? 0,
      plaquePct: m.plaqueIndexOleary ?? 0,
    })),
    recordsCount,
  };
}

/**
 * Devuelve la fecha más temprana entre la próxima evaluación del plan y el
 * próximo ClinicalReminder de mantenimiento auto-creado al cerrar SRP.
 * Si solo hay una, devuelve esa.
 */
function pickEarliestMaintenanceDate(
  planNextAt: Date | null,
  reminderDueAt: Date | null,
  fmt: (d: Date) => string,
): string | null {
  if (planNextAt && reminderDueAt) {
    return fmt(planNextAt < reminderDueAt ? planNextAt : reminderDueAt);
  }
  if (planNextAt) return fmt(planNextAt);
  if (reminderDueAt) return fmt(reminderDueAt);
  return null;
}

function buildAlerts(
  metrics: ReturnType<typeof computePerioMetrics> | null,
  surgeryCount: number,
): string[] {
  const alerts: string[] = [];
  if (!metrics) return alerts;
  if (metrics.sites6plus > 5)
    alerts.push(`${metrics.sites6plus} sitios con bolsa ≥6 mm — terapia activa pendiente.`);
  if (metrics.bopPct > 25) alerts.push(`BoP ${metrics.bopPct}% — inflamación generalizada.`);
  if (metrics.plaquePct > 30)
    alerts.push(`Índice de placa ${metrics.plaquePct}% — refuerza higiene.`);
  if (surgeryCount > 0)
    alerts.push(`${surgeryCount} cirugía(s) periodontal(es) registrada(s).`);
  return alerts;
}

function buildSystemicFactors(patient: {
  chronicConditions: string[];
  allergies: string[];
  currentMedications: string[];
}): string[] {
  const out: string[] = [];
  for (const c of patient.chronicConditions) out.push(c);
  if (patient.allergies.length > 0) out.push(`Alergias: ${patient.allergies.join(", ")}`);
  if (patient.currentMedications.length > 0)
    out.push(`Medicación: ${patient.currentMedications.join(", ")}`);
  return out;
}

function extractTeethFromTreatedSites(treated: unknown): number[] {
  if (!Array.isArray(treated)) return [];
  return treated
    .map((t: unknown) => {
      if (typeof t === "object" && t !== null && "fdi" in t) {
        const v = (t as { fdi: unknown }).fdi;
        return typeof v === "number" ? v : null;
      }
      return null;
    })
    .filter((n): n is number => n !== null);
}
