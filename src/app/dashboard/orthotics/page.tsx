export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OrthoticsClient } from "./orthotics-client";

export const metadata: Metadata = { title: "Ortopédicos — DaleControl" };

export default async function OrthoticsPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  // Orthotics pipeline uses InventoryItem with category prefixed "orthotics_"
  // Each item represents a patient order with the stage stored in the unit field
  // ws1-t4 (defensivo, sin cambio de comportamiento): select explícito —
  // misma razón que en Ejercicios, ver su nota.
  const items = await prisma.inventoryItem.findMany({
    where: { clinicId, category: { startsWith: "orthotics_" } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, clinicId: true, name: true, description: true, category: true,
      emoji: true, quantity: true, minQuantity: true, unit: true, price: true,
      createdAt: true, updatedAt: true,
    },
  });

  return <OrthoticsClient key={clinicId} initialItems={items as any} />;
}
