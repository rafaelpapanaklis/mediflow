export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { SuppliersClient } from "./suppliers-client";

export const metadata: Metadata = { title: "Proveedores — Admin MediFlow" };

// Supplier es global (sin clinicId): el admin ve TODOS los proveedores.
export default async function AdminSuppliersPage() {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { createdAt: "desc" },
  });
  return <SuppliersClient initial={suppliers as any} />;
}
