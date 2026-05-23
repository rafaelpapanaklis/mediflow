export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SuppliersClient } from "./suppliers-client";

export const metadata: Metadata = { title: "Proveedores — MediFlow" };

export default async function SuppliersPage() {
  // Exige sesión de clínica. El proveedor es global (sin clinicId),
  // así que solo necesitamos validar que haya usuario autenticado.
  await getCurrentUser();

  const suppliers = await prisma.supplier.findMany({
    where: { status: "APPROVED" },
    orderBy: { businessName: "asc" },
    select: {
      id: true,
      businessName: true,
      slug: true,
      logoUrl: true,
      city: true,
      state: true,
      categories: true,
      description: true,
      _count: { select: { products: true } },
    },
  });

  const data = suppliers.map((s) => ({
    id: s.id,
    businessName: s.businessName,
    slug: s.slug,
    logoUrl: s.logoUrl,
    city: s.city,
    state: s.state,
    categories: s.categories,
    description: s.description,
    productCount: s._count.products,
  }));

  return <SuppliersClient initialSuppliers={data} />;
}
