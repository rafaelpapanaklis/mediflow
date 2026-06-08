import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import type {
  SupplierProductDTO,
  SupplierProductImageDTO,
} from "@/lib/suppliers/types";
import { parsePageParams } from "@/lib/pagination";

function toImageDTO(img: any): SupplierProductImageDTO {
  return {
    id: img.id,
    productId: img.productId,
    url: img.url,
    sortOrder: img.sortOrder,
    createdAt: img.createdAt.toISOString(),
  };
}

function toProductDTO(p: any): SupplierProductDTO {
  return {
    id: p.id,
    supplierId: p.supplierId,
    name: p.name,
    description: p.description,
    category: p.category,
    sku: p.sku,
    price: p.price,
    unit: p.unit,
    stock: p.stock,
    isActive: p.isActive,
    images: (p.images ?? []).map(toImageDTO),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// GET /api/suppliers/[supplierId]/products — solo los productos activos del
// proveedor (que debe estar APPROVED).
export async function GET(
  req: NextRequest,
  { params }: { params: { supplierId: string } }
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verifica primero que el proveedor exista y esté APPROVED, para no filtrar
  // datos de proveedores no aprobados.
  const sup = await prisma.supplier.findFirst({
    where: { id: params.supplierId, status: "APPROVED" },
    select: { id: true },
  });
  if (!sup) {
    return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  }

  const { take, skip } = parsePageParams(req.nextUrl.searchParams);
  const products = await prisma.supplierProduct.findMany({
    where: { supplierId: params.supplierId, isActive: true },
    orderBy: { createdAt: "desc" },
    include: { images: { orderBy: { sortOrder: "asc" } } },
    take,
    skip,
  });

  const dtos: SupplierProductDTO[] = products.map(toProductDTO);
  return NextResponse.json(dtos);
}
