import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { makeSupplierOrderNumber } from "@/lib/suppliers/types";
import { orderInclude, toSupplierOrderDTO } from "@/lib/suppliers/serializers";

const round2 = (n: number) => Math.round(n * 100) / 100;

// GET /api/compras/orders — pedidos de la clínica (más recientes primero).
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const orders = await prisma.supplierOrder.findMany({
    where: { clinicId: ctx.clinicId },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(orders.map(toSupplierOrderDTO));
}

// POST /api/compras/orders — checkout de UN proveedor. Body: { supplierId,
// paymentMethod?, notes? }. Crea el SupplierOrder + items (precio/nombre
// congelados al momento) y vacía el carrito de (clinicId, supplierId). No hay
// pasarela: paymentStatus arranca UNPAID y el pago se acuerda offline/por chat.
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const supplierId = typeof body?.supplierId === "string" ? body.supplierId : "";
  const paymentMethod =
    typeof body?.paymentMethod === "string" && body.paymentMethod.trim()
      ? body.paymentMethod.trim()
      : null;
  const notes =
    typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  if (!supplierId) return NextResponse.json({ error: "supplierId es requerido" }, { status: 400 });

  const result = await prisma.$transaction(async (tx) => {
    const cart = await tx.supplierCart.findUnique({
      where: { clinicId_supplierId: { clinicId: ctx.clinicId, supplierId } },
      include: { items: { include: { product: true } } },
    });
    if (!cart || cart.items.length === 0) return { empty: true as const };

    const lineItems = cart.items.map((it) => ({
      productId: it.productId,
      productName: it.product.name,
      unitPrice: it.product.price,
      quantity: it.quantity,
      lineTotal: round2(it.product.price * it.quantity),
    }));
    const subtotal = round2(lineItems.reduce((s, li) => s + li.lineTotal, 0));

    const order = await tx.supplierOrder.create({
      data: {
        orderNumber: makeSupplierOrderNumber(),
        clinicId: ctx.clinicId,
        supplierId,
        status: "PENDING",
        paymentStatus: "UNPAID",
        paymentMethod,
        subtotal,
        total: subtotal,
        notes,
        items: { create: lineItems },
      },
    });

    // Vacía el carrito (cascade borra los items).
    await tx.supplierCart.delete({ where: { id: cart.id } });
    return { orderId: order.id };
  });

  if ("empty" in result) {
    return NextResponse.json({ error: "El carrito está vacío" }, { status: 400 });
  }

  const full = await prisma.supplierOrder.findUnique({
    where: { id: result.orderId },
    include: orderInclude,
  });
  return NextResponse.json(full ? toSupplierOrderDTO(full) : { ok: true }, { status: 201 });
}
