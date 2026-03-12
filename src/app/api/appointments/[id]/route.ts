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
  const data: any = {};
  if (body.status)       { data.status = body.status.toUpperCase(); }
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.cancelReason) data.cancelReason = body.cancelReason;
  if (body.status === "CONFIRMED")   data.confirmedAt = new Date();
  if (body.status === "CANCELLED")   data.cancelledAt = new Date();

  await prisma.appointment.updateMany({ where: { id: params.id, clinicId }, data });
  const updated = await prisma.appointment.findUnique({ where: { id: params.id }, include: { patient: true, doctor: true } });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.appointment.updateMany({ where: { id: params.id, clinicId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  return NextResponse.json({ success: true });
}
