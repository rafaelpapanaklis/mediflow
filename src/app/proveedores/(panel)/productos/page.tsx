export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSupplierContext } from "@/lib/supplier-auth";
import { prisma } from "@/lib/prisma";
import type { SupplierProductDTO } from "@/lib/suppliers/types";
import { ProductosClient } from "./productos-client";

export const metadata: Metadata = {
  title: "Productos · Proveedor — MediFlow",
  robots: { index: false, follow: false },
};

export default async function ProductosPage() {
  const ctx = await getSupplierContext();
  if (!ctx) redirect("/proveedores/login");
  if (ctx.status !== "APPROVED") redirect("/proveedores/pendiente");

  const products = await prisma.supplierProduct.findMany({
    where: { supplierId: ctx.supplierId },
    include: { images: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });

  const initialProducts: SupplierProductDTO[] = products.map((p) => ({
    id: p.id,
    supplierId: p.supplierId,
    name: p.name,
    description: p.description ?? null,
    category: p.category ?? null,
    sku: p.sku ?? null,
    price: p.price,
    unit: p.unit,
    stock: p.stock,
    isActive: p.isActive,
    images: p.images.map((img) => ({
      id: img.id,
      productId: img.productId,
      url: img.url,
      sortOrder: img.sortOrder,
      createdAt: img.createdAt.toISOString(),
    })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  return <ProductosClient initialProducts={initialProducts} />;
}
