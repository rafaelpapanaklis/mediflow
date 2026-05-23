import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

// La propiedad se verifica SIEMPRE por la relación cart.clinicId de la sesión,
// nunca confiando en el itemId suelto: un item de otra clínica devuelve 404.
async function ownItem(itemId: string, clinicId: string) {
  return prisma.supplierCartItem.findFirst({
    where: { id: itemId, cart: { clinicId } },
    select: { id: true, cartId: true },
  });
}

// PATCH /api/compras/cart/[itemId] — cambia la cantidad. Body: { quantity }.
export async function PATCH(req: NextRequest, { params }: { params: { itemId: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const quantity = Math.max(1, Math.floor(Number(body?.quantity)));
  if (!Number.isFinite(quantity)) {
    return NextResponse.json({ error: "quantity válido es requerido" }, { status: 400 });
  }

  const item = await ownItem(params.itemId, ctx.clinicId);
  if (!item) return NextResponse.json({ error: "Item no encontrado" }, { status: 404 });

  await prisma.$transaction([
    prisma.supplierCartItem.update({ where: { id: item.id }, data: { quantity } }),
    prisma.supplierCart.update({ where: { id: item.cartId }, data: { updatedAt: new Date() } }),
  ]);
  return NextResponse.json({ ok: true });
}

// DELETE /api/compras/cart/[itemId] — quita el item del carrito.
export async function DELETE(_req: NextRequest, { params }: { params: { itemId: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const item = await ownItem(params.itemId, ctx.clinicId);
  if (!item) return NextResponse.json({ error: "Item no encontrado" }, { status: 404 });

  await prisma.$transaction([
    prisma.supplierCartItem.delete({ where: { id: item.id } }),
    prisma.supplierCart.update({ where: { id: item.cartId }, data: { updatedAt: new Date() } }),
  ]);
  return NextResponse.json({ ok: true });
}
