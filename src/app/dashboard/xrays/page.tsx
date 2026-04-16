export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toPublicFileUrl } from "@/lib/storage";
import { XraysClient } from "./xrays-client";

export const metadata: Metadata = { title: "Radiografías — MediFlow" };

export default async function XraysPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const [patients, recentFiles, clinic] = await Promise.all([
    prisma.patient.findMany({
      where: { clinicId, status: "ACTIVE" },
      orderBy: { firstName: "asc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        patientNumber: true,
        _count: { select: { files: true } },
      },
    }),
    prisma.patientFile.findMany({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, patientNumber: true } },
      },
    }),
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { aiTokensUsed: true, aiTokensLimit: true },
    }),
  ]);

  const aiUsed  = clinic?.aiTokensUsed  ?? 0;
  const aiLimit = clinic?.aiTokensLimit ?? 0;

  const normalizedRecentFiles = recentFiles.map(f => ({ ...f, url: toPublicFileUrl(f.url) }));

  return (
    <XraysClient
      patients={patients as any}
      recentFiles={normalizedRecentFiles as any}
      clinicId={clinicId}
      aiUsed={aiUsed}
      aiLimit={aiLimit}
    />
  );
}
