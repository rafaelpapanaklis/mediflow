import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  // Verify appointment belongs to clinic; doctors can only update their own
  const appt = await prisma.appointment.findFirst({
    where: {
      id:       params.id,
      clinicId: ctx.clinicId,
      ...(ctx.isDoctor ? { doctorId: ctx.userId } : {}),
    },
  });
  if (!appt) return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });

  const updated = await prisma.appointment.update({
    where: { id: params.id },
    data: {
      ...(body.status       !== undefined && { status:       body.status                }),
      ...(body.notes        !== undefined && { notes:        body.notes                 }),
      ...(body.startTime    !== undefined && { startTime:    body.startTime             }),
      ...(body.endTime      !== undefined && { endTime:      body.endTime               }),
      ...(body.date         !== undefined && { date:         new Date(body.date)        }),
      ...(body.reminderSent !== undefined && { reminderSent: body.reminderSent          }),
      ...(body.price        !== undefined && { price:        Number(body.price)         }),
      ...(body.isPaid       !== undefined && { isPaid:       Boolean(body.isPaid)       }),
      ...(body.status === "CONFIRMED"     && { confirmedAt:  new Date()                 }),
      ...(body.status === "CANCELLED"     && { cancelledAt:  new Date(), cancelReason: body.cancelReason ?? null }),
    },
  });

  return NextResponse.json({
    ...updated,
    date:      updated.date instanceof Date ? updated.date.toISOString() : updated.date,
    createdAt: updated.createdAt instanceof Date ? updated.createdAt.toISOString() : updated.createdAt,
    updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : updated.updatedAt,
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only admins and receptionists can delete appointments
  if (ctx.isDoctor) {
    return NextResponse.json({ error: "Los doctores no pueden eliminar citas" }, { status: 403 });
  }

  await prisma.appointment.deleteMany({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  return NextResponse.json({ success: true });
}
