import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import type {
  SupplierProductDTO,
  SupplierProductImageDTO,
  SupplierReviewDTO,
} from "@/lib/suppliers/types";
import { toSupplierDTO, toSupplierReviewDTO } from "@/lib/suppliers/serializers";

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

// GET /api/suppliers/[supplierId] — ficha del proveedor + productos activos,
// reputación (reseñas) y datos por-clínica (favorito + si puede reseñar).
// El clinicId SIEMPRE sale de la sesión (getAuthContext), nunca del request.
export async function GET(
  req: NextRequest,
  { params }: { params: { supplierId: string } }
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  if (!supplier) {
    return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  }

  const products: SupplierProductDTO[] = supplier.products.map(toProductDTO);

  // ── Favorito de la clínica en sesión (no es columna del proveedor). ──
  const favorite = await prisma.supplierFavorite.findFirst({
    where: { clinicId: ctx.clinicId, supplierId: params.supplierId },
    select: { id: true },
  });
  const isFavorite = !!favorite;

  // ── Reseñas del proveedor (más recientes primero) con el nombre de la clínica. ──
  const reviewRows = await prisma.supplierReview.findMany({
    where: { supplierId: params.supplierId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { clinic: { select: { name: true } } },
  });
  const reviews: SupplierReviewDTO[] = reviewRows.map(toSupplierReviewDTO);

  // ── ¿Puede reseñar? Necesita un pedido DELIVERED de esta clínica+proveedor
  //    que todavía NO tenga reseña (SupplierReview.orderId es @unique). ──
  const deliveredOrders = await prisma.supplierOrder.findMany({
    where: { clinicId: ctx.clinicId, supplierId: params.supplierId, status: "DELIVERED" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  let reviewableOrderId: string | null = null;
  if (deliveredOrders.length > 0) {
    const reviewed = await prisma.supplierReview.findMany({
      where: {
        clinicId: ctx.clinicId,
        supplierId: params.supplierId,
        orderId: { in: deliveredOrders.map((o) => o.id) },
      },
      select: { orderId: true },
    });
    const reviewedIds = reviewed.map((r) => r.orderId);
    const found = deliveredOrders.find((o) => !reviewedIds.includes(o.id));
    reviewableOrderId = found ? found.id : null;
  }
  const canReview = reviewableOrderId !== null;

  return NextResponse.json({
    supplier: toSupplierDTO(supplier, { isFavorite }),
    products,
    reviews,
    canReview,
    reviewableOrderId,
  });
}
