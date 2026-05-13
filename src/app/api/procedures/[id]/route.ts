import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });

  try {
    const existing = await prisma.procedureCatalog.findFirst({
      where: { id: params.id, clinicId: ctx.clinicId },
    });
    if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    const body = await req.json();
    const updated = await prisma.procedureCatalog.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.code !== undefined && { code: body.code?.trim() || null }),
        ...(body.category !== undefined && { category: body.category.trim() }),
        ...(body.basePrice !== undefined && { basePrice: Number(body.basePrice) }),
        ...(body.duration !== undefined && { duration: body.duration ? Number(body.duration) : null }),
        ...(body.description !== undefined && { description: body.description?.trim() || null }),
        ...(body.isActive !== undefined && { isActive: Boolean(body.isActive) }),
      },
    });
    revalidateAfter("procedures");
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("Update procedure error:", err);
    return NextResponse.json({ error: err.message ?? "Error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });

  try {
    await prisma.procedureCatalog.deleteMany({ where: { id: params.id, clinicId: ctx.clinicId } });
    revalidateAfter("procedures");
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Error" }, { status: 500 });
  }
}
