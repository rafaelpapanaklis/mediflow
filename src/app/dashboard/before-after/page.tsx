export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { patientVisibilityAnd } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { BeforeAfterClient } from "./before-after-client";

export const metadata: Metadata = { title: "Antes y Después — DaleControl" };

export default async function BeforeAfterPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };

  const patients = await prisma.patient.findMany({
    where: {
      clinicId,
      status: "ACTIVE",
      // Visibilidad por paciente: no listar/mostrar pacientes restringidos a quien no está en su visibleUserIds.
      AND: [...patientVisibilityAnd(viewer)],
    },
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
