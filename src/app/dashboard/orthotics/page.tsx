export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OrthoticsClient } from "./orthotics-client";

export const metadata: Metadata = { title: "Ortopédicos — MediFlow" };

export default async function OrthoticsPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  // Orthotics pipeline uses InventoryItem with category prefixed "orthotics_"
  // Each item represents a patient order with the stage stored in the unit field
  const items = await prisma.inventoryItem.findMany({
    where: { clinicId, category: { startsWith: "orthotics_" } },
    orderBy: { createdAt: "asc" },
  });

  return <OrthoticsClient initialItems={items as any} />;
}
