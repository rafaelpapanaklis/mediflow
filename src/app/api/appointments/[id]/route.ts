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
  const appt = await prisma.appointment.updateMany({
    where: { id: params.id, clinicId },
    data: {
      ...(body.status      !== undefined && { status:       body.status      }),
      ...(body.notes       !== undefined && { notes:        body.notes       }),
      ...(body.startTime   !== undefined && { startTime:    body.startTime   }),
      ...(body.endTime     !== undefined && { endTime:      body.endTime     }),
      ...(body.date        !== undefined && { date:         new Date(body.date) }),
      ...(body.reminderSent!== undefined && { reminderSent: body.reminderSent }),
      ...(body.status === "CONFIRMED"    && { confirmedAt:  new Date()       }),
      ...(body.status === "CANCELLED"    && { cancelledAt:  new Date()       }),
    },
  });
  return NextResponse.json(appt);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.appointment.deleteMany({ where: { id: params.id, clinicId } });
  return NextResponse.json({ success: true });
}
