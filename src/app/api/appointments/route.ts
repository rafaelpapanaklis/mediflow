import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, buildAppointmentWhere } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createCalendarEvent, refreshAccessToken } from "@/lib/google-calendar";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const appts = await prisma.appointment.findMany({
    where: buildAppointmentWhere(ctx),
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { select: { id: true, firstName: true, lastName: true, color: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

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

  const doctorId = ctx.isDoctor ? ctx.userId : (body.doctorId ?? ctx.userId);

  const patient = await prisma.patient.findFirst({
    where:  { id: body.patientId, clinicId: ctx.clinicId },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // Get doctor info
  const doctor = await prisma.user.findUnique({
    where:  { id: doctorId },
    select: { id: true, firstName: true, lastName: true, email: true,
              googleCalendarToken: true, googleRefreshToken: true,
              googleCalendarEnabled: true, googleCalendarEmail: true },
  });

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
  });

  // ── Google Calendar sync ────────────────────────────────────────────────
  // STRATEGY: Use clinic-level calendar if admin has connected Google.
  // Otherwise fall back to the doctor's personal calendar.

  const clinic = await prisma.clinic.findUnique({
    where:  { id: ctx.clinicId },
    select: {
      name: true, address: true,
      googleCalendarEnabled: true,
      googleCalendarToken:   true,
      googleRefreshToken:    true,
      googleClinicCalendarId: true,
    },
  });

  let gcalEventId: string | null = null;

  // Option A: Clinic calendar (admin connected)
  if (clinic?.googleCalendarEnabled && clinic.googleRefreshToken && clinic.googleClinicCalendarId) {
    let token = clinic.googleCalendarToken;

    // Refresh if needed
    if (!token) {
      token = await refreshAccessToken(clinic.googleRefreshToken);
      if (token) {
        await prisma.clinic.update({ where: { id: ctx.clinicId }, data: { googleCalendarToken: token } });
      }
    }

    if (token) {
      gcalEventId = await createCalendarEvent(token, clinic.googleRefreshToken, {
        id:          appt.id,
        type:        appt.type,
        date:        body.date,
        startTime:   appt.startTime,
        endTime:     appt.endTime,
        patientName: `${patient.firstName} ${patient.lastName}`,
        clinicName:  clinic.name,
        clinicAddress: clinic.address,
        notes:       appt.notes,
        doctorName:  doctor ? `${doctor.firstName} ${doctor.lastName}` : null,
        doctorEmail: null, // don't add as attendee — just informational
        patientEmail: patient.email ?? null,
        calendarId:  clinic.googleClinicCalendarId, // ← clinic calendar, not primary
      });
    }
  }
  // Option B: Doctor's personal calendar (fallback)
  else if (doctor?.googleCalendarEnabled && doctor.googleRefreshToken) {
    let token = doctor.googleCalendarToken;
    if (!token) {
      token = await refreshAccessToken(doctor.googleRefreshToken);
      if (token) await prisma.user.update({ where: { id: doctorId }, data: { googleCalendarToken: token } });
    }
    if (token) {
      gcalEventId = await createCalendarEvent(token, doctor.googleRefreshToken, {
        id:          appt.id,
        type:        appt.type,
        date:        body.date,
        startTime:   appt.startTime,
        endTime:     appt.endTime,
        patientName: `${patient.firstName} ${patient.lastName}`,
        clinicName:  clinic?.name ?? ctx.clinic.name,
        clinicAddress: clinic?.address,
        notes:       appt.notes,
        doctorName:  doctor ? `${doctor.firstName} ${doctor.lastName}` : null,
        doctorEmail: doctor.googleCalendarEmail ?? doctor.email,
        patientEmail: patient.email ?? null,
        calendarId:  "primary",
      });
    }
  }

  if (gcalEventId) {
    await prisma.appointment.update({
      where: { id: appt.id },
      data:  { googleCalendarEventId: gcalEventId },
    });
  }

  return NextResponse.json({
    ...appt,
    date: appt.date instanceof Date ? appt.date.toISOString() : appt.date,
  }, { status: 201 });
}
