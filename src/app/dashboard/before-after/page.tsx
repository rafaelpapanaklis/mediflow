export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BeforeAfterClient } from "./before-after-client";

export const metadata: Metadata = { title: "Antes y Después — MediFlow" };

export default async function BeforeAfterPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const patients = await prisma.patient.findMany({
    where: { clinicId, status: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      _count: { select: { beforeAfterPhotos: true } },
    },
    orderBy: { firstName: "asc" },
  });

  return <BeforeAfterClient patients={patients as any} />;
}
