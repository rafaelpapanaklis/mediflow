import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

async function getClinicId() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const dbUser = await prisma.user.findUnique({ where: { supabaseId: user.id } });
  return dbUser?.clinicId ?? null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  // If it's a quantity change (+ or -)
  if (body.change !== undefined) {
    const item = await prisma.inventoryItem.findFirst({ where: { id: params.id, clinicId } });
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const newQty = Math.max(0, item.quantity + body.change);
    const [updated] = await prisma.$transaction([
      prisma.inventoryItem.update({ where: { id: params.id }, data: { quantity: newQty } }),
      prisma.inventoryHistory.create({ data: { itemId: params.id, change: body.change, reason: body.reason ?? null } }),
    ]);
    return NextResponse.json(updated);
  }

  // Full update
  const updated = await prisma.inventoryItem.updateMany({
    where: { id: params.id, clinicId },
    data: {
      ...(body.name        !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.quantity    !== undefined && { quantity: body.quantity }),
      ...(body.minQuantity !== undefined && { minQuantity: body.minQuantity }),
      ...(body.unit        !== undefined && { unit: body.unit }),
      ...(body.price       !== undefined && { price: body.price }),
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.inventoryItem.deleteMany({ where: { id: params.id, clinicId } });
  return NextResponse.json({ success: true });
}
