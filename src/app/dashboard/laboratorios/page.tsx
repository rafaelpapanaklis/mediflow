export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LaboratoriosClient } from "./laboratorios-client";

export const metadata: Metadata = { title: "Laboratorios — MediFlow" };

export default async function LaboratoriosPage() {
  // Exige sesión de clínica. El laboratorio es global (sin clinicId),
  // así que solo necesitamos validar que haya usuario autenticado.
  await getCurrentUser();

  const labs = await prisma.dentalLab.findMany({
    where: { status: "APPROVED" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      city: true,
      state: true,
      services: true,
      description: true,
      rating: true,
      onTimePct: true,
      _count: { select: { labServices: true } },
    },
  });

  const data = labs.map((l) => ({
    id: l.id,
    name: l.name,
    slug: l.slug,
    logoUrl: l.logoUrl,
    city: l.city,
    state: l.state,
    services: l.services,
    description: l.description,
    rating: l.rating,
    onTimePct: l.onTimePct,
    serviceCount: l._count.labServices,
  }));

  return <LaboratoriosClient initialLabs={data} />;
}
