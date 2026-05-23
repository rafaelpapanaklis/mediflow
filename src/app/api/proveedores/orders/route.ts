import { type NextRequest, NextResponse } from "next/server";
import { getSupplierContext } from "@/lib/supplier-auth";
import { prisma } from "@/lib/prisma";
import type { SupplierOrderStatus } from "@/lib/suppliers/types";

export const dynamic = "force-dynamic";

const VALID_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;

// GET /api/proveedores/orders → pedidos recibidos por el proveedor en sesión.
// Filtro opcional ?status=PENDING|CONFIRMED|SHIPPED|DELIVERED|CANCELLED.
export async function GET(req: NextRequest) {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Cuenta no aprobada." }, { status: 403 });
  }

  const statusParam = req.nextUrl.searchParams.get("status");
  const status =
    statusParam && (VALID_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as SupplierOrderStatus)
      : undefined;

  const orders = await prisma.supplierOrder.findMany({
    // Multi-tenant: siempre scopeado por el supplierId de la sesión.
    where: { supplierId: ctx.supplierId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      clinic: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });

  return NextResponse.json(orders, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}
