export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { SuppliersClient } from "./suppliers-client";

export const metadata: Metadata = { title: "Proveedores — Admin DaleControl" };

// Supplier es global (sin clinicId): el admin ve TODOS los proveedores.
export default async function AdminSuppliersPage() {
  // Tope de seguridad: SuppliersClient lista en memoria sin paginación. Acota a
  // 100 para no traer toda la tabla global de proveedores. TODO: paginar admin.
  const suppliers = await prisma.supplier.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return <SuppliersClient initial={suppliers as any} />;
}
