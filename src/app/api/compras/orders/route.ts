import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { makeSupplierOrderNumber } from "@/lib/suppliers/types";
import { orderInclude, toSupplierOrderDTO } from "@/lib/suppliers/serializers";
import { isB2BPaymentMethod, type B2BPaymentMethod } from "@/lib/payments-b2b";

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
// paymentMethod, notes? }. paymentMethod DEBE ser un método B2B
// (TRANSFER/MERCADOPAGO/CASH) que el proveedor tenga habilitado. Crea el
// SupplierOrder + items (precio/nombre congelados al momento) y vacía el
// carrito de (clinicId, supplierId). El pago arranca UNPAID: transferencia y
// efectivo los marca el vendedor a mano; MercadoPago lo confirma el webhook.
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const supplierId = typeof body?.supplierId === "string" ? body.supplierId : "";
  const paymentMethodRaw =
    typeof body?.paymentMethod === "string" ? body.paymentMethod.trim() : "";
  const notes =
    typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  if (!supplierId) return NextResponse.json({ error: "supplierId es requerido" }, { status: 400 });
  if (!isB2BPaymentMethod(paymentMethodRaw)) {
    return NextResponse.json({ error: "Selecciona un método de pago válido." }, { status: 400 });
  }
  const paymentMethod: B2BPaymentMethod = paymentMethodRaw;

  const result = await prisma.$transaction(async (tx) => {
    // El proveedor debe seguir APPROVED al momento del checkout: si fue
    // suspendido o rechazado tras agregarlo al carrito, no se permite pedir.
    const supplier = await tx.supplier.findUnique({
      where: { id: supplierId },
      select: {
        status: true,
        payTransferEnabled: true,
        payMercadoPagoEnabled: true,
        payCashEnabled: true,
      },
    });
    if (!supplier || supplier.status !== "APPROVED") {
      return { unavailable: true as const };
    }

    // El método elegido debe estar habilitado por el proveedor.
    const enabledByMethod: Record<B2BPaymentMethod, boolean> = {
      TRANSFER: supplier.payTransferEnabled,
      MERCADOPAGO: supplier.payMercadoPagoEnabled,
      CASH: supplier.payCashEnabled,
    };
    if (!enabledByMethod[paymentMethod]) {
      return { methodDisabled: true as const };
    }

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

  if ("unavailable" in result) {
    return NextResponse.json(
      { error: "Este proveedor no está disponible en este momento." },
      { status: 409 },
    );
  }
  if ("methodDisabled" in result) {
    return NextResponse.json(
      { error: "El proveedor no acepta este método de pago." },
      { status: 409 },
    );
  }
  if ("empty" in result) {
    return NextResponse.json({ error: "El carrito está vacío" }, { status: 400 });
  }

  const full = await prisma.supplierOrder.findUnique({
    where: { id: result.orderId },
    include: orderInclude,
  });
  return NextResponse.json(full ? toSupplierOrderDTO(full) : { ok: true }, { status: 201 });
}
