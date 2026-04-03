import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

async function getUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return prisma.user.findUnique({ where: { supabaseId: user.id } });
}

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");
  const appts = await prisma.appointment.findMany({
    where: {
      clinicId: user.clinicId,
      ...(from && to ? { date: { gte: new Date(from), lte: new Date(to) } } : {}),
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  return NextResponse.json(appts);
}

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();

  // Auto-generate patient number if needed
  const appt = await prisma.appointment.create({
    data: {
      clinicId:    user.clinicId,
      patientId:   body.patientId,
      doctorId:    body.doctorId,
      type:        body.type,
      date:        new Date(body.date),
      startTime:   body.startTime,
      endTime:     body.endTime,
      durationMins:body.durationMins ?? 30,
      status:      "PENDING",
      notes:       body.notes ?? null,
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { select: { id: true, firstName: true, lastName: true } },
    },
  });
  return NextResponse.json(appt, { status: 201 });
}
