export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { exigirCategoriaParaPagina } from "@/lib/dashboard/guardia-categoria.server";
import { patientVisibilityAnd } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { FormulasClient } from "./formulas-client";

export const metadata: Metadata = { title: "Fórmulas — DaleControl" };

export default async function FormulasPage() {
  // Guardia de categoría EN LA PÁGINA (no en un layout): esta pantalla solo abre
  // para las clínicas cuyo giro la tiene. La categoría sale de la sesión.
  const user = await exigirCategoriaParaPagina("/dashboard/formulas");
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
