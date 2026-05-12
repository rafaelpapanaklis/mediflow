"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { DEFAULT_PEDIATRICS_CUTOFF_YEARS } from "@/lib/pediatrics/permissions";

export type SpecialtySlug =
  | "orthodontics"
  | "endodontics"
  | "periodontics"
  | "implants"
  | "pediatrics";

export interface SpecialtyPatientResult {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  ageYears: number | null;
  isAdult: boolean;
  existingCount: number;
}

export interface SearchPatientsInput {
  specialty: SpecialtySlug;
  q?: string;
}

export interface SearchPatientsOutput {
  ok: boolean;
  results: SpecialtyPatientResult[];
}

const MAX_RESULTS = 30;

function ageFromDob(dob: Date | null): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export async function searchPatientsForSpecialty(
  input: SearchPatientsInput,
): Promise<SearchPatientsOutput> {
  const user = await getCurrentUser();
  const q = (input.q ?? "").trim();

  const baseWhere = { clinicId: user.clinicId, deletedAt: null } as const;
  const where =
    q.length === 0
      ? baseWhere
      : {
          ...baseWhere,
          OR: [
            { firstName: { contains: q, mode: "insensitive" as const } },
            { lastName: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        };

  const patients = await prisma.patient.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      dob: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: MAX_RESULTS,
  });

  const counts = await loadSpecialtyCounts(
    input.specialty,
    user.clinicId,
    patients.map((p) => p.id),
  );

  const results: SpecialtyPatientResult[] = patients.map((p) => {
    const age = ageFromDob(p.dob);
    return {
      id: p.id,
      fullName: `${p.firstName} ${p.lastName}`.trim(),
      phone: p.phone,
      email: p.email,
      ageYears: age,
      isAdult: age !== null && age >= DEFAULT_PEDIATRICS_CUTOFF_YEARS,
      existingCount: counts.get(p.id) ?? 0,
    };
  });

  return { ok: true, results };
}

async function loadSpecialtyCounts(
  specialty: SpecialtySlug,
  clinicId: string,
  patientIds: string[],
): Promise<Map<string, number>> {
  if (patientIds.length === 0) return new Map();
  const baseWhere = { clinicId, patientId: { in: patientIds } };
  const map = new Map<string, number>();

  switch (specialty) {
    case "orthodontics": {
      // Ortodoncia v2 rewrite (Fase 9 pendiente). El filtro por especialidad
      // ortho devuelve 0 hasta que OrthoCase + OrthoDiagnosis v2 esté wired.
      break;
    }
    case "endodontics": {
      const groups = await prisma.endodonticTreatment.groupBy({
        by: ["patientId"],
        where: { ...baseWhere, deletedAt: null },
        _count: { _all: true },
      });
      for (const g of groups) map.set(g.patientId, g._count._all);
      break;
    }
    case "periodontics": {
      const groups = await prisma.periodontalRecord.groupBy({
        by: ["patientId"],
        where: { ...baseWhere, deletedAt: null },
        _count: { _all: true },
      });
      for (const g of groups) map.set(g.patientId, g._count._all);
      break;
    }
    case "implants": {
      const groups = await prisma.implant.groupBy({
        by: ["patientId"],
        where: baseWhere,
        _count: { _all: true },
      });
      for (const g of groups) map.set(g.patientId, g._count._all);
      break;
    }
    case "pediatrics":
      break;
  }

  return map;
}
