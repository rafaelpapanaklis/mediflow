export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { InventoryClient } from "./inventory-client";

export const metadata: Metadata = { title: "Inventario — MediFlow" };

export default async function InventoryPage() {
  const user = await getCurrentUser();
  const items = await prisma.inventoryItem.findMany({
    where: { clinicId: user.clinicId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return <InventoryClient initialItems={items as any} specialty={user.clinic.specialty} />;
}
