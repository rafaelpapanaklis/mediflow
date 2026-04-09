export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { XraysClient } from "./xrays-client";

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
      _count: { select: { files: true } },
    },
  });

  const recentFiles = await prisma.patientFile.findMany({
    where: { clinicId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, patientNumber: true } },
    },
  });

  return (
    <XraysClient
      patients={patients as any}
      recentFiles={recentFiles as any}
      clinicId={clinicId}
    />
  );
}
