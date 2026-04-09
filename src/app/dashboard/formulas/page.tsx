export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FormulasClient } from "./formulas-client";

export const metadata: Metadata = { title: "Fórmulas — MediFlow" };

export default async function FormulasPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const patients = await prisma.patient.findMany({
    where: { clinicId, status: "ACTIVE" },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });

  return <FormulasClient patients={patients as any} />;
}
