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

export async function GET(req: NextRequest) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const where: any = { clinicId };
  if (category) where.category = category;
  const items = await prisma.inventoryItem.findMany({
    where, orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const item = await prisma.inventoryItem.create({
    data: {
      clinicId,
      name:        body.name,
      description: body.description ?? null,
      category:    body.category,
      emoji:       body.emoji ?? "📦",
      quantity:    body.quantity ?? 0,
      minQuantity: body.minQuantity ?? 5,
      unit:        body.unit ?? "pza",
      price:       body.price ?? null,
    },
  });
  return NextResponse.json(item, { status: 201 });
}
