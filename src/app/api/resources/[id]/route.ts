import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const booking = await prisma.resourceBooking.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const body = await req.json();
  const updated = await prisma.resourceBooking.update({
    where: { id: params.id },
    data: {
      ...(body.resourceType !== undefined && { resourceType: body.resourceType }),
      ...(body.resourceName !== undefined && { resourceName: body.resourceName }),
      ...(body.startTime !== undefined && { startTime: new Date(body.startTime) }),
      ...(body.endTime !== undefined && { endTime: new Date(body.endTime) }),
      ...(body.appointmentId !== undefined && { appointmentId: body.appointmentId }),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const booking = await prisma.resourceBooking.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  await prisma.resourceBooking.deleteMany({ where: { id: params.id, clinicId: ctx.clinicId } });

  return NextResponse.json({ success: true });
}
