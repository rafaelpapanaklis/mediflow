export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PackagesClient } from "./packages-client";

export const metadata: Metadata = { title: "Paquetes — MediFlow" };

export default async function PackagesPage() {
  const user = await getCurrentUser();
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

  return <PackagesClient initialPackages={packages as any} initialRedemptions={redemptions as any} />;
}
