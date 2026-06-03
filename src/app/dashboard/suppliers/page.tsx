export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SuppliersClient } from "./suppliers-client";

export const metadata: Metadata = { title: "Proveedores — MediFlow" };

export default async function SuppliersPage() {
  // Exige sesión de clínica. El proveedor es global (sin clinicId),
  // así que solo necesitamos la sesión para resolver sus favoritos.
  const user = await getCurrentUser();

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
      rating: true,
      ratingCount: true,
      // Solo productos activos, para que el contador de la tarjeta coincida
      // con lo que muestra la ficha del proveedor (que filtra isActive).
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });

  // Favoritos de la clínica de sesión → marca el corazón en cada tarjeta.
  const favorites = await prisma.supplierFavorite.findMany({
    where: { clinicId: user.clinicId },
    select: { supplierId: true },
  });
  const favSet = new Set(favorites.map((f) => f.supplierId));

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
    rating: s.rating,
    ratingCount: s.ratingCount,
    isFavorite: favSet.has(s.id),
  }));

  return <SuppliersClient initialSuppliers={data} />;
}
