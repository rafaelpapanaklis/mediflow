export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LaboratoriosClient } from "./laboratorios-client";

export const metadata: Metadata = { title: "Laboratorios — DaleControl" };

export default async function LaboratoriosPage() {
  // Exige sesión de clínica. El laboratorio es global (sin clinicId),
  // así que solo necesitamos validar que haya usuario autenticado.
  await getCurrentUser();

  // Tope de seguridad: LaboratoriosClient filtra/busca en memoria (sin "Ver
  // más"). Acota a 100 para no escanear todo el directorio global de
  // laboratorios. TODO: paginación server-side real al pasar de 100.
  const labs = await prisma.dentalLab.findMany({
    where: { status: "APPROVED" },
    orderBy: { name: "asc" },
    take: 100,
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
      trafficLevel: true,
      trafficManualMin: true,
      trafficManualMax: true,
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
    trafficLevel: l.trafficLevel,
    trafficManualMin: l.trafficManualMin,
    trafficManualMax: l.trafficManualMax,
    serviceCount: l._count.labServices,
  }));

  return <LaboratoriosClient initialLabs={data} />;
}
