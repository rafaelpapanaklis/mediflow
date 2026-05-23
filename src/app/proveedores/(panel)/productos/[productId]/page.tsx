export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { getSupplierContext } from "@/lib/supplier-auth";
import { prisma } from "@/lib/prisma";
import type { SupplierProductDTO } from "@/lib/suppliers/types";
import { ProductoForm } from "../producto-form";

export const metadata: Metadata = {
  title: "Editar producto · Proveedor — MediFlow",
  robots: { index: false, follow: false },
};

export default async function EditarProductoPage({ params }: { params: { productId: string } }) {
  const ctx = await getSupplierContext();
  if (!ctx) redirect("/proveedores/login");
  if (ctx.status !== "APPROVED") redirect("/proveedores/pendiente");

  // Multi-tenant guard: el producto DEBE pertenecer al proveedor en sesión.
  const product = await prisma.supplierProduct.findFirst({
    where: { id: params.productId, supplierId: ctx.supplierId },
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });
  if (!product) notFound();

  const dto: SupplierProductDTO = {
    id: product.id,
    supplierId: product.supplierId,
    name: product.name,
    description: product.description ?? null,
    category: product.category ?? null,
    sku: product.sku ?? null,
    price: product.price,
    unit: product.unit,
    stock: product.stock,
    isActive: product.isActive,
    images: product.images.map((img) => ({
      id: img.id,
      productId: img.productId,
      url: img.url,
      sortOrder: img.sortOrder,
      createdAt: img.createdAt.toISOString(),
    })),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };

  return <ProductoForm mode="edit" product={dto} />;
}
