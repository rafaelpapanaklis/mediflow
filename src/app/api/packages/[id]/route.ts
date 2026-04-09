import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const pkg = await prisma.servicePackage.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });

  const body = await req.json();
  const updated = await prisma.servicePackage.update({
    where: { id: params.id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.price !== undefined && { price: Number(body.price) }),
      ...(body.totalSessions !== undefined && { totalSessions: Number(body.totalSessions) }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const pkg = await prisma.servicePackage.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });

  // Check for active redemptions
  const activeRedemptions = await prisma.packageRedemption.count({
    where: { packageId: params.id, status: "ACTIVE" },
  });
  if (activeRedemptions > 0) {
    return NextResponse.json(
      { error: "Cannot delete package with active redemptions" },
      { status: 409 }
    );
  }

  await prisma.servicePackage.delete({ where: { id: params.id } });

  return NextResponse.json({ success: true });
}
