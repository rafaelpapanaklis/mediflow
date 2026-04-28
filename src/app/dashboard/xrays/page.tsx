export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { XraysPatientsList } from "./patients-list-client";

export const metadata: Metadata = { title: "Radiografías — MediFlow" };

export default async function XraysPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

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

  // Conteo de radiografías + última fecha por paciente.
  //
  // Usamos $queryRaw con cast `category::text` para evitar
  // "operator does not exist: text = FileCategory" cuando la columna
  // patient_files.category quedó como TEXT en alguna DB legacy aunque
  // schema.prisma la declare como enum FileCategory. El cast textual
  // funciona en ambos casos (text vs enum) sin requerir migración
  // urgente del tipo de columna.
  const xrayFiles = await prisma.$queryRaw<Array<{ patientId: string | null; createdAt: Date }>>`
    SELECT "patientId", "createdAt"
    FROM patient_files
    WHERE "clinicId" = ${clinicId}
      AND category::text IN ('XRAY_PERIAPICAL', 'XRAY_PANORAMIC', 'XRAY_BITEWING', 'XRAY_OCCLUSAL')
  `;
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
