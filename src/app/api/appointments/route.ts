import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, buildAppointmentWhere } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createCalendarEvent, refreshAccessToken } from "@/lib/google-calendar";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appts = await prisma.appointment.findMany({
    where: buildAppointmentWhere(ctx), // Doctors only see their own
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { select: { id: true, firstName: true, lastName: true, color: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  // Serialize dates
  return NextResponse.json(appts.map(a => ({
    ...a,
    date:      a.date instanceof Date ? a.date.toISOString() : a.date,
    createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
    updatedAt: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : a.updatedAt,
  })));
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  // Doctors can only create appointments for themselves
  const doctorId = ctx.isDoctor ? ctx.userId : (body.doctorId ?? ctx.userId);

  // Verify patient belongs to this clinic
  const patient = await prisma.patient.findFirst({
    where: { id: body.patientId, clinicId: ctx.clinicId },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const appt = await prisma.appointment.create({
    data: {
      clinicId:     ctx.clinicId,
      patientId:    body.patientId,
      doctorId,
      type:         body.type,
      date:         new Date(body.date),
      startTime:    body.startTime,
      endTime:      body.endTime,
      durationMins: body.durationMins ?? 30,
      status:       "PENDING",
      notes:        body.notes ?? null,
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { select: { id: true, firstName: true, lastName: true, color: true, googleCalendarToken: true, googleRefreshToken: true, googleCalendarEnabled: true, googleCalendarEmail: true, email: true } },
    },
  });

  // Google Calendar sync
  if (appt.doctor.googleCalendarEnabled && appt.doctor.googleRefreshToken) {
    let token = appt.doctor.googleCalendarToken;
    if (!token) {
      token = await refreshAccessToken(appt.doctor.googleRefreshToken);
      if (token) await prisma.user.update({ where: { id: doctorId }, data: { googleCalendarToken: token } });
    }
    if (token) {
      const gcalEventId = await createCalendarEvent(token, appt.doctor.googleRefreshToken, {
        id: appt.id, type: appt.type, date: body.date,
        startTime: appt.startTime, endTime: appt.endTime,
        patientName: `${patient.firstName} ${patient.lastName}`,
        clinicName: ctx.clinic.name, clinicAddress: ctx.clinic.address,
        notes: appt.notes, doctorEmail: appt.doctor.googleCalendarEmail ?? appt.doctor.email,
        patientEmail: patient.email ?? null,
      });
      if (gcalEventId) await prisma.appointment.update({ where: { id: appt.id }, data: { googleCalendarEventId: gcalEventId } });
    }
  }

  return NextResponse.json({
    ...appt,
    date: appt.date instanceof Date ? appt.date.toISOString() : appt.date,
  }, { status: 201 });
}
