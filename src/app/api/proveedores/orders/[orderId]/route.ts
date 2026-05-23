import { type NextRequest, NextResponse } from "next/server";
import { getSupplierContext } from "@/lib/supplier-auth";
import { prisma } from "@/lib/prisma";
import { canTransition } from "@/lib/suppliers/orders-shared";
import type { SupplierOrderStatus, SupplierPaymentStatus } from "@/lib/suppliers/types";

export const dynamic = "force-dynamic";

const VALID_STATUSES = ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
const VALID_PAYMENTS = ["UNPAID", "PAID"] as const;

// GET /api/proveedores/orders/[orderId] → detalle de un pedido del proveedor.
export async function GET(
  _req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Cuenta no aprobada." }, { status: 403 });
  }

  const order = await prisma.supplierOrder.findFirst({
    // Scopeado por supplierId → un proveedor nunca ve el pedido de otro.
    where: { id: params.orderId, supplierId: ctx.supplierId },
    include: {
      clinic: { select: { name: true, city: true, state: true, phone: true, email: true } },
      items: { orderBy: { productName: "asc" } },
    },
  });

  if (!order) return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });
  return NextResponse.json(order, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}

// PATCH /api/proveedores/orders/[orderId] → avanzar status y/o paymentStatus.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Cuenta no aprobada." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }
  const payload = (body ?? {}) as { status?: unknown; paymentStatus?: unknown };

  const nextStatus = typeof payload.status === "string" ? payload.status : undefined;
  const nextPayment = typeof payload.paymentStatus === "string" ? payload.paymentStatus : undefined;

  if (nextStatus === undefined && nextPayment === undefined) {
    return NextResponse.json({ error: "Nada que actualizar." }, { status: 400 });
  }
  if (nextStatus !== undefined && !(VALID_STATUSES as readonly string[]).includes(nextStatus)) {
    return NextResponse.json({ error: "Estado de pedido inválido." }, { status: 400 });
  }
  if (nextPayment !== undefined && !(VALID_PAYMENTS as readonly string[]).includes(nextPayment)) {
    return NextResponse.json({ error: "Estado de pago inválido." }, { status: 400 });
  }

  // Multi-tenant: confirmar que el pedido es de ESTE proveedor antes de tocarlo.
  const order = await prisma.supplierOrder.findFirst({
    where: { id: params.orderId, supplierId: ctx.supplierId },
    select: { id: true, status: true },
  });
  if (!order) return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });

  // Validar la transición de status contra la máquina de estados compartida.
  if (
    nextStatus !== undefined &&
    nextStatus !== order.status &&
    !canTransition(order.status, nextStatus as SupplierOrderStatus)
  ) {
    return NextResponse.json(
      { error: `No se puede pasar de "${order.status}" a "${nextStatus}".` },
      { status: 409 },
    );
  }

  const updated = await prisma.supplierOrder.update({
    where: { id: order.id },
    data: {
      ...(nextStatus !== undefined ? { status: nextStatus as SupplierOrderStatus } : {}),
      ...(nextPayment !== undefined ? { paymentStatus: nextPayment as SupplierPaymentStatus } : {}),
    },
    include: {
      clinic: { select: { name: true } },
      items: true,
    },
  });

  return NextResponse.json(updated);
}
