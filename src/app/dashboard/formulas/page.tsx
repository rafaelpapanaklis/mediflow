export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { patientVisibilityAnd } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { FormulasClient } from "./formulas-client";

export const metadata: Metadata = { title: "Fórmulas — DaleControl" };

export default async function FormulasPage() {
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
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });

  return <FormulasClient patients={patients as any} />;
}
