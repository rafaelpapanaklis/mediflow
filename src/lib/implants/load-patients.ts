// Implants — loader agregado para el panel de la especialidad. Spec §6.17.

import type { ImplantBrand, ImplantFollowUpMilestone, ImplantStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeImplantCountsFromRows } from "./specialty-kpis";

export { computeImplantCountsFromRows };

export interface ImplantPatientRow {
  implantId: string;
  patientId: string;
  patientName: string;
  doctorId: string | null;
  doctorName: string | null;
  toothFdi: number;
  brand: ImplantBrand;
  brandCustomName: string | null;
  modelName: string;
  status: ImplantStatus;
  placedAt: Date;
  nextControlAt: Date | null;
  nextControlMilestone: string | null;
}

export interface ImplantSpecialtyKpis {
  activeImplants: number;
  inHealing: number;
  inProsthetic: number;
  pendingAnnualControls: number;
}

export interface ImplantSpecialtyDoctor {
  id: string;
  name: string;
}

export interface LoadImplantPatientsResult {
  rows: ImplantPatientRow[];
  kpis: ImplantSpecialtyKpis;
  doctors: ImplantSpecialtyDoctor[];
}

const ANNUAL_MILESTONES: ImplantFollowUpMilestone[] = [
  "M_12_MONTHS",
  "M_24_MONTHS",
  "M_5_YEARS",
  "M_10_YEARS",
];

export async function loadImplantPatients(clinicId: string): Promise<LoadImplantPatientsResult> {
  const now = new Date();

  const [implants, pendingAnnualControls] = await Promise.all([
    prisma.implant.findMany({
      where: { clinicId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        placedByDoctor: { select: { id: true, firstName: true, lastName: true } },
        followUps: {
          where: { performedAt: null, scheduledAt: { not: null } },
          orderBy: { scheduledAt: "asc" },
          take: 1,
          select: { milestone: true, scheduledAt: true },
        },
      },
      orderBy: { placedAt: "desc" },
      take: 500,
    }),
    prisma.implantFollowUp.count({
      where: {
        clinicId,
        performedAt: null,
        milestone: { in: ANNUAL_MILESTONES },
      },
    }),
  ]);

  const rows: ImplantPatientRow[] = implants.map((i) => {
    const upcoming = i.followUps[0] ?? null;
    return {
      implantId: i.id,
      patientId: i.patient.id,
      patientName: `${i.patient.firstName} ${i.patient.lastName}`.trim(),
      doctorId: i.placedByDoctor?.id ?? null,
      doctorName: i.placedByDoctor
        ? `${i.placedByDoctor.firstName} ${i.placedByDoctor.lastName}`.trim()
        : null,
      toothFdi: i.toothFdi,
      brand: i.brand,
      brandCustomName: i.brandCustomName,
      modelName: i.modelName,
      status: i.currentStatus,
      placedAt: i.placedAt,
      nextControlAt: upcoming?.scheduledAt ?? null,
      nextControlMilestone: upcoming?.milestone ?? null,
    };
  });

  const partialKpis = computeImplantCountsFromRows(rows);

  const doctorsMap = new Map<string, ImplantSpecialtyDoctor>();
  for (const r of rows) {
    if (r.doctorId && r.doctorName && !doctorsMap.has(r.doctorId)) {
      doctorsMap.set(r.doctorId, { id: r.doctorId, name: r.doctorName });
    }
  }

  return {
    rows,
    kpis: { ...partialKpis, pendingAnnualControls },
    doctors: Array.from(doctorsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

