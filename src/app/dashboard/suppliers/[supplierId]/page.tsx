export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { SupplierDetailClient } from "./supplier-detail-client";

export default async function SupplierDetailPage({ params }: { params: { supplierId: string } }) {
  await getCurrentUser(); // exige sesión de clínica

  const supplier = await prisma.supplier.findFirst({
    where: { id: params.supplierId, status: "APPROVED" },
    include: {
      products: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        include: { images: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });

  if (!supplier) notFound();

  const data = {
    id: supplier.id,
    businessName: supplier.businessName,
    logoUrl: supplier.logoUrl,
    description: supplier.description,
    city: supplier.city,
    state: supplier.state,
    address: supplier.address,
    phone: supplier.phone,
    email: supplier.email,
    categories: supplier.categories,
    paymentMethods: supplier.paymentMethods,
    // Perfil extendido + reputación (columnas del proveedor; los datos
    // por-clínica —favorito, reseñas, canReview— los trae la ruta GET).
    whatsapp: supplier.whatsapp,
    website: supplier.website,
    mapsUrl: supplier.mapsUrl,
    minOrderAmount: supplier.minOrderAmount,
    shippingNote: supplier.shippingNote,
    rating: supplier.rating,
    ratingCount: supplier.ratingCount,
  };

  const products = supplier.products.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    sku: p.sku,
    price: p.price,
    unit: p.unit,
    stock: p.stock,
    images: p.images.map((img) => ({ id: img.id, url: img.url })),
  }));

  return <SupplierDetailClient supplier={data} products={products} />;
}
