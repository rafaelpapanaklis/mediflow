import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { orderInclude, toSupplierOrderDTO } from "@/lib/suppliers/serializers";

// GET /api/compras/orders/[orderId] — detalle de un pedido de la clínica.
// Scopeado por clinicId de sesión: un pedido de otra clínica devuelve 404.
export async function GET(_req: NextRequest, { params }: { params: { orderId: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const order = await prisma.supplierOrder.findFirst({
    where: { id: params.orderId, clinicId: ctx.clinicId },
    include: orderInclude,
  });
  if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });

  return NextResponse.json(toSupplierOrderDTO(order));
}
