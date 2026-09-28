export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { exigirCategoriaParaPagina } from "@/lib/dashboard/guardia-categoria.server";
import { prisma } from "@/lib/prisma";
import { PackagesClient } from "./packages-client";

export const metadata: Metadata = { title: "Paquetes — DaleControl" };

export default async function PackagesPage() {
  // Guardia de categoría EN LA PÁGINA (no en un layout): esta pantalla solo abre
  // para las clínicas cuyo giro la tiene. La categoría sale de la sesión.
  const user = await exigirCategoriaParaPagina("/dashboard/packages");
  const clinicId = user.clinicId;

  const packages = await prisma.servicePackage.findMany({
    where: { clinicId },
    include: { _count: { select: { redemptions: true } } },
    orderBy: { name: "asc" },
  });

  const redemptions = await prisma.packageRedemption.findMany({
    where: { clinicId, status: "ACTIVE" },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true } },
      package: { select: { id: true, name: true } },
    },
    orderBy: { purchasedAt: "desc" },
  });

  return <PackagesClient key={clinicId} initialPackages={packages as any} initialRedemptions={redemptions as any} />;
}
