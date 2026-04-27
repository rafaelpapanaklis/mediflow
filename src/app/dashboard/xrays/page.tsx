export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { FileCategory } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { XraysPatientsList } from "./patients-list-client";

export const metadata: Metadata = { title: "Radiografías — MediFlow" };

const XRAY_CATEGORIES: FileCategory[] = [
  FileCategory.XRAY_PERIAPICAL,
  FileCategory.XRAY_PANORAMIC,
  FileCategory.XRAY_BITEWING,
  FileCategory.XRAY_OCCLUSAL,
];

export default async function XraysPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  // Pacientes activos. Conteo y última fecha se calculan luego con queries
  // independientes para mantener types simples.
  const patients = await prisma.patient.findMany({
    where: { clinicId, status: "ACTIVE" },
    orderBy: { firstName: "asc" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      patientNumber: true,
      dob: true,
      gender: true,
    },
  });

  // Conteo de radiografías + última fecha por paciente. Una sola pasada.
  const xrayFiles = await prisma.patientFile.findMany({
    where: { clinicId, category: { in: XRAY_CATEGORIES } },
    select: { patientId: true, createdAt: true },
  });
  const countByPatient = new Map<string, number>();
  const lastByPatient = new Map<string, Date>();
  for (const f of xrayFiles) {
    if (!f.patientId) continue;
    countByPatient.set(f.patientId, (countByPatient.get(f.patientId) ?? 0) + 1);
    const prev = lastByPatient.get(f.patientId);
    if (!prev || f.createdAt > prev) lastByPatient.set(f.patientId, f.createdAt);
  }

  const patientsWithMeta = patients.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    patientNumber: p.patientNumber,
    dob: p.dob ? p.dob.toISOString() : null,
    gender: p.gender ?? null,
    xrayCount: countByPatient.get(p.id) ?? 0,
    lastXrayAt: lastByPatient.get(p.id)?.toISOString() ?? null,
  }));

  return <XraysPatientsList patients={patientsWithMeta} />;
}
