import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entry = await prisma.walkInQueue.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!entry) return NextResponse.json({ error: "Queue entry not found" }, { status: 404 });

  const body = await req.json();
  const updated = await prisma.walkInQueue.update({
    where: { id: params.id },
    data: {
      ...(body.status !== undefined && { status: body.status }),
      ...(body.assignedTo !== undefined && { assignedTo: body.assignedTo }),
      ...(body.startedAt !== undefined && { startedAt: new Date(body.startedAt) }),
      ...(body.completedAt !== undefined && { completedAt: new Date(body.completedAt) }),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entry = await prisma.walkInQueue.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!entry) return NextResponse.json({ error: "Queue entry not found" }, { status: 404 });

  await prisma.walkInQueue.deleteMany({ where: { id: params.id, clinicId: ctx.clinicId } });

  return NextResponse.json({ success: true });
}
