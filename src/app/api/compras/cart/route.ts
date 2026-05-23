import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { cartInclude, toSupplierCartDTO } from "@/lib/suppliers/serializers";

// GET /api/compras/cart — todos los carritos de la clínica (uno por proveedor).
// El clinicId SIEMPRE sale de la sesión, nunca del request.
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const carts = await prisma.supplierCart.findMany({
    where: { clinicId: ctx.clinicId },
    include: cartInclude,
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json(carts.map(toSupplierCartDTO));
}

// POST /api/compras/cart — agrega un item. Body: { productId, quantity }.
// El proveedor se deriva del producto; clinicId de la sesión. El carrito de
// (clinicId, supplierId) se crea on-demand. Lo consume el botón "Agregar al
// carrito" del browse (T2).
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const productId = typeof body?.productId === "string" ? body.productId : "";
  const quantity = Math.max(1, Math.floor(Number(body?.quantity ?? 1)));
  if (!productId || !Number.isFinite(quantity)) {
    return NextResponse.json({ error: "productId y quantity válidos son requeridos" }, { status: 400 });
  }

  // Solo productos activos de proveedores aprobados son agregables.
  const product = await prisma.supplierProduct.findFirst({
    where: { id: productId, isActive: true, supplier: { status: "APPROVED" } },
    select: { id: true, supplierId: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Producto no disponible" }, { status: 404 });
  }

  const cart = await prisma.$transaction(async (tx) => {
    const c = await tx.supplierCart.upsert({
      where: { clinicId_supplierId: { clinicId: ctx.clinicId, supplierId: product.supplierId } },
      create: { clinicId: ctx.clinicId, supplierId: product.supplierId },
      update: { updatedAt: new Date() },
    });
    await tx.supplierCartItem.upsert({
      where: { cartId_productId: { cartId: c.id, productId } },
      create: { cartId: c.id, productId, quantity },
      update: { quantity: { increment: quantity } },
    });
    return c;
  });

  const full = await prisma.supplierCart.findUnique({
    where: { id: cart.id },
    include: cartInclude,
  });
  return NextResponse.json(full ? toSupplierCartDTO(full) : { ok: true }, { status: 201 });
}
