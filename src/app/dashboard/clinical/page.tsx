export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ClinicalClient } from "./clinical-client";

export const metadata: Metadata = { title: "Notas clínicas — MediFlow" };

export default async function ClinicalPage({
  searchParams,
}: {
  searchParams: { patientId?: string };
}) {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  // Defensa: si la relación clinic no se hidrata por algún motivo
  // (FK roto, datos legacy), caemos a defaults para no crashear el render.
  const clinic = (user as { clinic?: { specialty?: string | null; category?: string | null } }).clinic ?? {};
  const specialty = clinic.specialty ?? "OTHER";
  const clinicCategory = clinic.category ?? "OTHER";

  const patients = await prisma.patient.findMany({
    where: { clinicId, status: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      patientNumber: true,
      gender: true,
      dob: true,
      isChild: true,
    },
    orderBy: { firstName: "asc" },
  });

  let records: Array<Record<string, unknown>> = [];
  let selectedPatient: Record<string, unknown> | null = null;
  let sessionCount = 0;

  if (searchParams.patientId) {
    const patient = await prisma.patient.findFirst({
      where: { id: searchParams.patientId, clinicId },
    });
    if (patient) {
      // Serializa Date → string para evitar problemas de hydration.
      selectedPatient = {
        ...patient,
        dob: patient.dob ? patient.dob.toISOString() : null,
      };
      const raw = await prisma.medicalRecord.findMany({
        where: { patientId: searchParams.patientId, clinicId },
        include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { visitDate: "desc" },
      });
      records = raw.map((r) => ({
        ...r,
        visitDate: r.visitDate.toISOString(),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
      sessionCount = records.length + 1;
    }
  }

  // Serializa pacientes (dob es Date) para que el client component
  // reciba strings consistentemente.
  const safePatients = patients.map((p) => ({
    ...p,
    dob: p.dob ? p.dob.toISOString() : null,
  }));

  return (
    <ClinicalClient
      specialty={specialty}
      clinicCategory={clinicCategory}
      patients={safePatients as never}
      selectedPatient={selectedPatient as never}
      records={records as never}
      sessionCount={sessionCount}
      currentPatientId={searchParams.patientId}
    />
  );
}
