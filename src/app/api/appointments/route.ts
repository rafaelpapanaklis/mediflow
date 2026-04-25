import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthContext, buildAppointmentWhere } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createCalendarEvent, refreshAccessToken, getOrCreateClinicCalendar } from "@/lib/google-calendar";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import { dateISOInTz, timeHHMMInTz, durationMinutes } from "@/lib/agenda/legacy-helpers";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinicTz = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { timezone: true },
  });
  const tz = clinicTz?.timezone ?? "America/Mexico_City";

  const appts = await prisma.appointment.findMany({
    where: buildAppointmentWhere(ctx),
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:  { select: { id: true, firstName: true, lastName: true, color: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  return NextResponse.json(appts.map(a => ({
    ...a,
    date:         dateISOInTz(a.startsAt, tz),
    startTime:    timeHHMMInTz(a.startsAt, tz),
    endTime:      timeHHMMInTz(a.endsAt, tz),
    durationMins: durationMinutes(a.startsAt, a.endsAt),
    startsAt:     a.startsAt.toISOString(),
    endsAt:       a.endsAt.toISOString(),
    createdAt:    a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
    updatedAt:    a.updatedAt instanceof Date ? a.updatedAt.toISOString() : a.updatedAt,
  })));
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  const doctorId = ctx.isDoctor ? ctx.userId : (body.doctorId ?? ctx.userId);

  const patient = await prisma.patient.findFirst({
    where:  { id: body.patientId, clinicId: ctx.clinicId },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // Get doctor info
  const doctor = await prisma.user.findFirst({
    where:  { id: doctorId, clinicId: ctx.clinicId, isActive: true },
    select: { id: true, firstName: true, lastName: true, email: true,
              googleCalendarToken: true, googleRefreshToken: true,
              googleCalendarEnabled: true, googleCalendarEmail: true,
              stripeAccountId: true, stripeOnboarded: true, teleconsultPrice: true },
  });
  if (!doctor) return NextResponse.json({ error: "Doctor no encontrado" }, { status: 404 });

  // Teleconsultation validations
  if (body.mode === "TELECONSULTATION") {
    if (!doctor.stripeAccountId || !doctor.stripeOnboarded) {
      return NextResponse.json({ error: "El doctor no tiene configurado Stripe para recibir pagos" }, { status: 400 });
    }
    if (!doctor.teleconsultPrice) {
      return NextResponse.json({ error: "El doctor no tiene precio de teleconsulta configurado" }, { status: 400 });
    }
  }

  const clinic = await prisma.clinic.findUnique({
    where:  { id: ctx.clinicId },
    select: {
      name: true, address: true, timezone: true,
      googleCalendarEnabled: true,
      googleCalendarToken:   true,
      googleRefreshToken:    true,
      googleClinicCalendarId: true,
    },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  const tz = clinic.timezone;
  const durationMins: number = body.durationMins ?? 30;
  const [sH, sM] = String(body.startTime).split(":").map(Number);
  const startsAt = tzLocalToUtc(String(body.date).split("T")[0], sH, sM, tz);
  const endsAt = body.endTime
    ? (() => {
        const [eH, eM] = String(body.endTime).split(":").map(Number);
        return tzLocalToUtc(String(body.date).split("T")[0], eH, eM, tz);
      })()
    : new Date(startsAt.getTime() + durationMins * 60_000);

  const appt = await prisma.appointment.create({
    data: {
      clinicId:     ctx.clinicId,
      patientId:    body.patientId,
      doctorId,
      type:         body.type,
      startsAt,
      endsAt,
      status:       "PENDING",
      notes:        body.notes ?? null,
      mode:         body.mode || "IN_PERSON",
      ...(body.mode === "TELECONSULTATION" && {
        paymentStatus: "pending",
        paymentAmount: doctor.teleconsultPrice,
      }),
    },
  });

  // ── Google Calendar sync ────────────────────────────────────────────────
  // STRATEGY: Use clinic-level calendar if admin has connected Google.
  // Otherwise fall back to the doctor's personal calendar.

  let gcalEventId: string | null = null;

  // Option A: Clinic calendar (admin connected)
  if (clinic?.googleCalendarEnabled && clinic.googleRefreshToken) {
    let token = clinic.googleCalendarToken;

    // Refresh if needed
    if (!token) {
      token = await refreshAccessToken(clinic.googleRefreshToken);
      if (token) {
        await prisma.clinic.update({ where: { id: ctx.clinicId }, data: { googleCalendarToken: token } });
      }
    }

    if (token) {
      // Auto-create clinic calendar if it doesn't exist yet
      let calendarId = clinic.googleClinicCalendarId;
      if (!calendarId) {
        try {
          calendarId = await getOrCreateClinicCalendar(token, clinic.googleRefreshToken, clinic.name);
          if (calendarId) {
            await prisma.clinic.update({ where: { id: ctx.clinicId }, data: { googleClinicCalendarId: calendarId } });
          }
        } catch (err) {
          console.error("Error creating clinic calendar on-the-fly:", err);
        }
      }

      gcalEventId = await createCalendarEvent(token, clinic.googleRefreshToken, {
        id:          appt.id,
        type:        appt.type,
        startsAt,
        endsAt,
        clinicTimezone: tz,
        patientName: `${patient.firstName} ${patient.lastName}`,
        clinicName:  clinic.name,
        clinicAddress: clinic.address,
        notes:       appt.notes,
        doctorName:  doctor ? `${doctor.firstName} ${doctor.lastName}` : null,
        doctorEmail: null,
        patientEmail: patient.email ?? null,
        calendarId:  calendarId ?? "primary",
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
        startsAt,
        endsAt,
        clinicTimezone: tz,
        patientName: `${patient.firstName} ${patient.lastName}`,
        clinicName:  clinic.name,
        clinicAddress: clinic.address,
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

  // ── WhatsApp confirmation to patient (skip for teleconsultation — sent after payment) ──
  if (body.mode !== "TELECONSULTATION") {
  const clinicWa = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { waConnected: true, waPhoneNumberId: true, waAccessToken: true, name: true },
  });

  if (clinicWa?.waConnected && clinicWa.waPhoneNumberId && clinicWa.waAccessToken && patient.phone) {
    try {
      const dateFormatted = new Intl.DateTimeFormat("es-MX", {
        timeZone: tz, weekday: "long", day: "numeric", month: "long",
      }).format(startsAt);
      const msg = `✅ Cita agendada en ${clinicWa.name}\n\n📅 ${dateFormatted}\n🕐 ${timeHHMMInTz(startsAt, tz)} - ${timeHHMMInTz(endsAt, tz)}\n📋 ${appt.type}\n${doctor ? `👨‍⚕️ ${doctor.firstName} ${doctor.lastName}` : ""}\n\n¿Confirmas tu asistencia? Responde *sí* o *no*`;

      await sendWhatsAppMessage(clinicWa.waPhoneNumberId, clinicWa.waAccessToken, patient.phone, msg);

      // Create reminder record for tracking
      await prisma.whatsAppReminder.create({
        data: {
          clinicId:      ctx.clinicId,
          appointmentId: appt.id,
          patientPhone:  patient.phone,
          type:          "CONFIRMATION",
          message:       msg,
          status:        "SENT",
          sentAt:        new Date(),
        },
      });
    } catch (e) {
      console.error("WhatsApp confirmation failed:", e);
      // Don't fail the appointment creation
    }
  }

  } // end if not TELECONSULTATION

  // Invalidate dashboard cache so KPIs refresh
  revalidatePath("/dashboard");

  return NextResponse.json({
    ...appt,
    startsAt: appt.startsAt.toISOString(),
    endsAt: appt.endsAt.toISOString(),
    ...(body.mode === "TELECONSULTATION" && { paymentUrl: `/pago/${appt.id}` }),
  }, { status: 201 });
}
