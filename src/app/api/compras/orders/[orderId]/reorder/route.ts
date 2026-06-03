import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { cartInclude, toSupplierCartDTO } from "@/lib/suppliers/serializers";

export const dynamic = "force-dynamic";

// POST /api/compras/orders/[orderId]/reorder — vuelve a agregar al carrito los
// productos de un pedido anterior. Reusa EXACTAMENTE el patrón de
// POST /api/compras/cart: upsert del carrito de (clinicId, supplierId) +
// upsert de cada item con `increment`.
//
// Reglas:
//   - El pedido se busca por (clinicId de sesión + orderId): una clínica jamás
//     recompra el pedido de otra.
//   - El proveedor debe seguir APPROVED.
//   - Se omiten productos inactivos, sin stock o ya borrados (productId null).
//   - El precio NO se copia del pedido: el carrito guarda solo cantidad y el
//     precio se toma del producto vigente al ver el carrito / hacer checkout,
//     así que el reorder usa siempre el PRECIO ACTUAL.
//
// SEGURIDAD MULTI-TENANT: el clinicId SIEMPRE sale de la sesión, nunca del body.
export async function POST(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const order = await prisma.supplierOrder.findFirst({
    where: { id: params.orderId, clinicId: ctx.clinicId },
    include: { items: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  const supplierId = order.supplierId;

  // El proveedor debe seguir aprobado para poder volver a comprarle.
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, status: "APPROVED" },
    select: { id: true },
  });
  if (!supplier) {
    return NextResponse.json(
      { error: "Este proveedor no está disponible en este momento." },
      { status: 409 },
    );
  }

  // Productos del pedido que siguen disponibles (activos + con stock). Los
  // items con productId null (producto borrado) quedan fuera del filtro.
  const orderedIds = Array.from(
    new Set(
      order.items
        .map((it) => it.productId)
        .filter((id): id is string => typeof id === "string"),
    ),
  );

  const availableProducts = orderedIds.length
    ? await prisma.supplierProduct.findMany({
        where: { id: { in: orderedIds }, supplierId, isActive: true, stock: { gt: 0 } },
        select: { id: true },
      })
    : [];
  const availableIds = new Set(availableProducts.map((p) => p.id));

  // Suma las cantidades por producto (un pedido podría repetir un productId).
  const qtyByProduct: Record<string, number> = {};
  for (const it of order.items) {
    if (!it.productId || !availableIds.has(it.productId)) continue;
    qtyByProduct[it.productId] = (qtyByProduct[it.productId] ?? 0) + it.quantity;
  }
  const entries = Object.entries(qtyByProduct);

  if (entries.length === 0) {
    return NextResponse.json(
      { error: "Ningún producto de este pedido está disponible para recomprar." },
      { status: 409 },
    );
  }

  const cart = await prisma.$transaction(async (tx) => {
    const c = await tx.supplierCart.upsert({
      where: { clinicId_supplierId: { clinicId: ctx.clinicId, supplierId } },
      create: { clinicId: ctx.clinicId, supplierId },
      update: { updatedAt: new Date() },
    });
    for (const [productId, quantity] of entries) {
      await tx.supplierCartItem.upsert({
        where: { cartId_productId: { cartId: c.id, productId } },
        create: { cartId: c.id, productId, quantity },
        update: { quantity: { increment: quantity } },
      });
    }
    return c;
  });

  const full = await prisma.supplierCart.findUnique({
    where: { id: cart.id },
    include: cartInclude,
  });
  return NextResponse.json(full ? toSupplierCartDTO(full) : { ok: true, cartId: cart.id });
}
