import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");

  const items = await prisma.inventoryItem.findMany({
    where: { clinicId: ctx.clinicId, ...(category ? { category } : {}) },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // EQ-07: "Editar inventario" del modal (por default SA/ADMIN, los mismos
  // que dejaba pasar el `isAdmin` que había aquí), con override incluido.
  const denied = denyIfMissingPermission(ctx, "inventory.edit");
  if (denied) return denied;

  const body = await req.json();
  if (!body.name?.trim() || !body.category?.trim()) {
    return NextResponse.json({ error: "Nombre y categoría son requeridos" }, { status: 400 });
  }

  const item = await prisma.inventoryItem.create({
    data: {
      clinicId:    ctx.clinicId,
      name:        body.name.trim(),
      description: body.description ?? null,
      category:    body.category.trim(),
      emoji:       body.emoji ?? "📦",
      quantity:    Number(body.quantity ?? 0),
      minQuantity: Number(body.minQuantity ?? 5),
      unit:        body.unit ?? "pza",
      price:       body.price ? Number(body.price) : null,
    },
  });
  return NextResponse.json(item, { status: 201 });
}
