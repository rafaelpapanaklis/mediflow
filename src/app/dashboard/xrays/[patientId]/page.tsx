export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toPublicFileUrl } from "@/lib/storage";
import { XraysClient } from "../xrays-client";

export const metadata: Metadata = { title: "Radiografías · paciente — MediFlow" };

interface Props {
  params: { patientId: string };
  searchParams: { fileId?: string };
}

export default async function XraysPatientPage({ params, searchParams }: Props) {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const patient = await prisma.patient.findFirst({
    where: { id: params.patientId, clinicId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      patientNumber: true,
      _count: { select: { files: true } },
    },
  });
  if (!patient) notFound();

  const [files, clinic] = await Promise.all([
    prisma.patientFile.findMany({
      where: { clinicId, patientId: params.patientId },
      orderBy: { createdAt: "desc" },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, patientNumber: true } },
        xrayAnalysis: {
          select: {
            summary: true,
            findings: true,
            recommendations: true,
            severity: true,
          },
        },
      },
    }),
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { aiTokensUsed: true, aiTokensLimit: true },
    }),
  ]);

  const aiUsed = clinic?.aiTokensUsed ?? 0;
  const aiLimit = clinic?.aiTokensLimit ?? 0;
  const normalized = files.map((f) => ({ ...f, url: toPublicFileUrl(f.url) }));

  return (
    <XraysClient
      patients={[patient] as any}
      recentFiles={normalized as any}
      clinicId={clinicId}
      aiUsed={aiUsed}
      aiLimit={aiLimit}
      initialPatientId={patient.id}
      initialFileId={searchParams.fileId}
      lockedToPatient
    />
  );
}
