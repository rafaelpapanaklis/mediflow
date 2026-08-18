export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { SuppliersClient } from "./suppliers-client";
import { PROVEEDOR_SELECT } from "@/lib/b2b/vendor-fields";

export const metadata: Metadata = { title: "Proveedores — Admin DaleControl" };

// Supplier es global (sin clinicId): el admin ve TODOS los proveedores.
export default async function AdminSuppliersPage() {
  // Tope de seguridad: SuppliersClient lista en memoria sin paginación. Acota a
  // 100 para no traer toda la tabla global de proveedores. TODO: paginar admin.
  // B2B-12: mismo caso que /admin/labs — SuppliersClient es "use client" y sin
  // `select` el mpAccessToken de cada proveedor viajaba en el payload RSC en
  // cada carga de la página.
  const suppliers = await prisma.supplier.findMany({
    select: PROVEEDOR_SELECT,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return <SuppliersClient initial={suppliers as any} />;
}
