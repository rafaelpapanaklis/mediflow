import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { createCalendarEvent, refreshAccessToken } from "@/lib/google-calendar";

async function getUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return prisma.user.findUnique({
    where: { supabaseId: user.id },
    include: { clinic: true },
  });
}

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appts = await prisma.appointment.findMany({
    where: { clinicId: user.clinicId },
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

  // Create appointment in DB
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
      patient: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
      doctor:  { select: { id: true, firstName: true, lastName: true, email: true, googleCalendarToken: true, googleRefreshToken: true, googleCalendarEnabled: true, googleCalendarEmail: true } },
    },
  });

  // Auto-create Google Calendar event for the doctor if connected
  if (appt.doctor.googleCalendarEnabled && appt.doctor.googleRefreshToken) {
    let token = appt.doctor.googleCalendarToken;

    // Refresh token if needed
    if (!token) {
      token = await refreshAccessToken(appt.doctor.googleRefreshToken);
      if (token) {
        await prisma.user.update({ where: { id: appt.doctorId }, data: { googleCalendarToken: token } });
      }
    }

    if (token) {
      const gcalEventId = await createCalendarEvent(token, appt.doctor.googleRefreshToken, {
        id:           appt.id,
        type:         appt.type,
        date:         body.date,
        startTime:    appt.startTime,
        endTime:      appt.endTime,
        patientName:  `${appt.patient.firstName} ${appt.patient.lastName}`,
        clinicName:   user.clinic.name,
        clinicAddress:user.clinic.address,
        notes:        appt.notes,
        doctorEmail:  appt.doctor.googleCalendarEmail ?? appt.doctor.email,
        patientEmail: (appt.patient as any).email ?? null,
      });

      if (gcalEventId) {
        await prisma.appointment.update({
          where: { id: appt.id },
          data: { googleCalendarEventId: gcalEventId },
        });
      }
    }
  }

  return NextResponse.json(appt, { status: 201 });
}
