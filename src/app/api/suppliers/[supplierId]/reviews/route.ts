import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { toSupplierReviewDTO } from "@/lib/suppliers/serializers";

export const dynamic = "force-dynamic";

// GET /api/suppliers/[supplierId]/reviews — reseñas del proveedor (más
// recientes primero). Son la reputación pública del proveedor, no datos
// privados de una clínica, así que cualquier clínica en sesión las ve.
export async function GET(
  _req: NextRequest,
  { params }: { params: { supplierId: string } },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const reviews = await prisma.supplierReview.findMany({
    where: { supplierId: params.supplierId },
    include: { clinic: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(reviews.map(toSupplierReviewDTO));
}

// POST /api/suppliers/[supplierId]/reviews — la clínica reseña un pedido YA
// ENTREGADO de este proveedor. Body: { rating(1-5), comment?, orderId }.
//
// Reglas de validación:
//   - rating: entero del 1 al 5.
//   - orderId: debe ser un SupplierOrder de (clinicId de sesión + supplierId)
//     con status DELIVERED.
//   - Máximo 1 reseña por pedido (orderId es @unique).
// Tras crear la reseña RECALCULA, en la misma transacción,
//   supplier.rating      = AVG(rating de todas las reseñas del proveedor)
//   supplier.ratingCount  = COUNT de reseñas del proveedor
// y actualiza la fila del proveedor.
//
// SEGURIDAD MULTI-TENANT: el clinicId SIEMPRE sale de la sesión, nunca del body.
export async function POST(
  req: NextRequest,
  { params }: { params: { supplierId: string } },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { supplierId } = params;

  const body = await req.json().catch(() => null);
  const rating = Math.floor(Number(body?.rating));
  const comment =
    typeof body?.comment === "string" && body.comment.trim()
      ? body.comment.trim().slice(0, 1000)
      : null;
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";

  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: "La calificación debe ser un entero del 1 al 5." },
      { status: 400 },
    );
  }
  if (!orderId) {
    return NextResponse.json({ error: "orderId es requerido." }, { status: 400 });
  }

  // El pedido debe ser de esta clínica, de este proveedor y estar ENTREGADO.
  const order = await prisma.supplierOrder.findFirst({
    where: { id: orderId, clinicId: ctx.clinicId, supplierId, status: "DELIVERED" },
    select: { id: true },
  });
  if (!order) {
    return NextResponse.json(
      { error: "Solo puedes reseñar un pedido entregado de este proveedor." },
      { status: 404 },
    );
  }

  // 1 reseña por pedido (chequeo previo; la transacción + el índice @unique
  // cierran el hueco de una doble-entrega concurrente).
  const existing = await prisma.supplierReview.findUnique({
    where: { orderId },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Este pedido ya tiene una reseña." },
      { status: 409 },
    );
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const review = await tx.supplierReview.create({
        data: { supplierId, clinicId: ctx.clinicId, orderId, rating, comment },
        include: { clinic: { select: { name: true } } },
      });

      // Recalcula reputación sobre TODAS las reseñas del proveedor.
      const agg = await tx.supplierReview.aggregate({
        where: { supplierId },
        _avg: { rating: true },
        _count: { _all: true },
      });
      const ratingCount = agg._count._all;
      const avgRating = Math.round((agg._avg.rating ?? 0) * 10) / 10;

      await tx.supplier.update({
        where: { id: supplierId },
        data: { rating: avgRating, ratingCount },
      });

      return { review, rating: avgRating, ratingCount };
    });
  } catch (err) {
    // P2002 = otra request creó la reseña de este pedido entre el chequeo y
    // el create. Estado final: el pedido ya tiene reseña.
    if ((err as { code?: string })?.code === "P2002") {
      return NextResponse.json(
        { error: "Este pedido ya tiene una reseña." },
        { status: 409 },
      );
    }
    throw err;
  }

  return NextResponse.json(
    {
      review: toSupplierReviewDTO(result.review),
      rating: result.rating,
      ratingCount: result.ratingCount,
    },
    { status: 201 },
  );
}
