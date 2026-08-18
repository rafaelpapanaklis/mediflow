export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { patientVisibilityAnd } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { toPublicFileUrl } from "@/lib/storage";
import { XraysClient } from "../xrays-client";

export const metadata: Metadata = { title: "Radiografías · paciente — DaleControl" };

interface Props {
  params: { patientId: string };
  searchParams: { fileId?: string };
}

export default async function XraysPatientPage({ params, searchParams }: Props) {
  const user = await getCurrentUser();
  // EQ-07: misma puerta que la lista y que GET /api/xrays.
  requirePermissionOrRedirect(user, "xrays.view");
  const clinicId = user.clinicId;
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };

  const patient = await prisma.patient.findFirst({
    where: {
      id: params.patientId,
      clinicId,
      // Visibilidad por paciente: no listar/mostrar pacientes restringidos a quien no está en su visibleUserIds.
      AND: [...patientVisibilityAnd(viewer)],
    },
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
      where: { clinicId, patientId: params.patientId, deletedAt: null },
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

  // EQ-07: qué acciones se pintan. Se resuelven aquí, del modal (rol +
  // override), y cada endpoint las revalida con 403.
  const permsUser = { role: user.role, permissionsOverride: user.permissionsOverride ?? [] };

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
      canUpload={hasPermission(permsUser, "xrays.upload")}
      canAnalyze={hasPermission(permsUser, "xrays.analyze")}
      canEditRecords={hasPermission(permsUser, "medicalRecord.edit")}
    />
  );
}
