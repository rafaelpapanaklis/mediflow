import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const item = await prisma.inventoryItem.findFirst({ where: { id: params.id, clinicId: ctx.clinicId } });
  if (!item) return NextResponse.json({ error: "Insumo no encontrado" }, { status: 404 });

  // Delta change (+ or -)
  if (body.change !== undefined) {
    const newQty  = Math.max(0, item.quantity + Number(body.change));
    const updated = await prisma.inventoryItem.update({
      where: { id: params.id },
      data:  { quantity: newQty, updatedAt: new Date() },
    });
    await prisma.inventoryHistory.create({
      data: { itemId: params.id, change: Number(body.change), reason: body.reason ?? null },
    });
    return NextResponse.json(updated);
  }

  // Direct quantity set
  if (body.quantity !== undefined) {
    const newQty  = Math.max(0, Number(body.quantity));
    const change  = newQty - item.quantity;
    const updated = await prisma.inventoryItem.update({
      where: { id: params.id },
      data:  { quantity: newQty, updatedAt: new Date() },
    });
    if (change !== 0) {
      await prisma.inventoryHistory.create({
        data: { itemId: params.id, change, reason: "Ajuste directo" },
      });
    }
    return NextResponse.json(updated);
  }

  // Update metadata fields
  const updated = await prisma.inventoryItem.update({
    where: { id: params.id },
    data: {
      ...(body.name        !== undefined && { name:        body.name        }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.minQuantity !== undefined && { minQuantity: Number(body.minQuantity) }),
      ...(body.unit        !== undefined && { unit:        body.unit        }),
      ...(body.price       !== undefined && { price:       body.price !== null ? Number(body.price) : null }),
      ...(body.emoji       !== undefined && { emoji:       body.emoji       }),
      updatedAt: new Date(),
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Solo administradores pueden eliminar insumos" }, { status: 403 });

  await prisma.inventoryItem.deleteMany({ where: { id: params.id, clinicId: ctx.clinicId } });
  return NextResponse.json({ success: true });
}
