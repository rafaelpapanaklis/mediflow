// Pediatrics — loader agregado para el panel de la especialidad. Spec §7.

import { prisma } from "@/lib/prisma";
import { calculateAge } from "@/lib/pediatrics/age";
import { DEFAULT_PEDIATRICS_CUTOFF_YEARS } from "@/lib/pediatrics/permissions";
import type { CambraCategory } from "@/lib/pediatrics/cambra";

export interface PediatricPatientRow {
  patientId: string;
  patientName: string;
  ageDecimal: number;
  ageLabel: string;
  cambra: CambraCategory | null;
  latestFranklValue: number | null;
  nextAppointmentAt: Date | null;
  nextAppointmentType: string | null;
  cariesRecallDue: boolean;
}

export interface PediatricSpecialtyKpis {
  activePatients: number;
  pendingProphylaxis: number;
  highOrExtremeCambra: number;
  eruptionControls: number;
}

export interface LoadPediatricPatientsResult {
  rows: PediatricPatientRow[];
  kpis: PediatricSpecialtyKpis;
}

export async function loadPediatricPatients(
  clinicId: string,
  cutoffYears: number = DEFAULT_PEDIATRICS_CUTOFF_YEARS,
): Promise<LoadPediatricPatientsResult> {
  const now = new Date();
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - cutoffYears);

  const patients = await prisma.patient.findMany({
    where: {
      clinicId,
      deletedAt: null,
      dob: { not: null, gt: cutoffDate },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      dob: true,
      cariesAssessments: {
        where: { deletedAt: null },
        orderBy: { scoredAt: "desc" },
        take: 1,
        select: { category: true, nextDueAt: true },
      },
      behaviorAssessments: {
        where: { scale: "frankl", deletedAt: null },
        orderBy: { recordedAt: "desc" },
        take: 1,
        select: { value: true },
      },
      eruptionRecords: {
        where: { deletedAt: null, withinExpectedRange: false },
        select: { toothFdi: true },
      },
      appointments: {
        where: { startsAt: { gt: now }, status: { in: ["PENDING", "CONFIRMED"] } },
        orderBy: { startsAt: "asc" },
        take: 1,
        select: { startsAt: true, type: true },
      },
    },
    orderBy: { lastName: "asc" },
    take: 500,
  });

  const rows: PediatricPatientRow[] = patients.map((p) => {
    const age = calculateAge(p.dob!);
    const caries = p.cariesAssessments[0] ?? null;
    const next = p.appointments[0] ?? null;
    const cariesRecallDue = Boolean(caries?.nextDueAt && caries.nextDueAt < now);
    return {
      patientId: p.id,
      patientName: `${p.firstName} ${p.lastName}`.trim(),
      ageDecimal: age.decimal,
      ageLabel: age.long,
      cambra: (caries?.category as CambraCategory | undefined) ?? null,
      latestFranklValue: p.behaviorAssessments[0]?.value ?? null,
      nextAppointmentAt: next?.startsAt ?? null,
      nextAppointmentType: next?.type ?? null,
      cariesRecallDue,
    };
  });

  const activePatients = rows.length;
  const pendingProphylaxis = rows.filter((r) => r.cariesRecallDue).length;
  const highOrExtremeCambra = rows.filter(
    (r) => r.cambra === "alto" || r.cambra === "extremo",
  ).length;
  const eruptionControls = patients.filter((p) => p.eruptionRecords.length > 0).length;

  return {
    rows,
    kpis: {
      activePatients,
      pendingProphylaxis,
      highOrExtremeCambra,
      eruptionControls,
    },
  };
}
