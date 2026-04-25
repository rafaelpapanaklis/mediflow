import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { createCalendarEvent, refreshAccessToken, getOrCreateClinicCalendar } from "@/lib/google-calendar";
import { rateLimit } from "@/lib/rate-limit";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";

export async function POST(req: NextRequest) {
  try {
  const rl = rateLimit(req, 10); // 10 requests per minute per IP
  if (rl) return rl;

  const body = await req.json();
  const { slug, doctorId, date, startTime, type, firstName, lastName, phone, email, notes } = body;

  // ── Validate required fields ───────────────────────────────────────────────
  if (!slug || !doctorId || !date || !startTime || !firstName?.trim() || !lastName?.trim() || !phone) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const cleanPhone = phone.replace(/[\s\-\(\)\+]/g, "");
  if (cleanPhone.length < 10) {
    return NextResponse.json({ error: "Teléfono inválido — mínimo 10 dígitos" }, { status: 400 });
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Formato de fecha inválido" }, { status: 400 });
  }

  // FIX: parse as local date to avoid UTC timezone issues
  const [y, m, d] = date.split("-").map(Number);
  const apptDate = new Date(y, m - 1, d);

  // Validate date is not in the past (compare date-only, not time)
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (apptDate < today) {
    return NextResponse.json({ error: "La fecha debe ser hoy o futura" }, { status: 400 });
  }

  // Validate startTime format HH:MM
  if (!/^\d{2}:\d{2}$/.test(startTime)) {
    return NextResponse.json({ error: "Formato de hora inválido" }, { status: 400 });
  }

  // ── Find clinic ────────────────────────────────────────────────────────────
  const clinic = await prisma.clinic.findUnique({
    where: { slug },
    select: {
      id: true, name: true, phone: true, timezone: true,
      waConnected: true, waPhoneNumberId: true, waAccessToken: true,
      schedules: { select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true } },
    },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  // ── Verify doctor belongs to this clinic ──────────────────────────────────
  const doctor = await prisma.user.findFirst({
    where: { id: doctorId, clinicId: clinic.id, isActive: true, role: { in: ["DOCTOR","ADMIN","SUPER_ADMIN"] } },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!doctor) return NextResponse.json({ error: "Doctor no disponible" }, { status: 404 });

  // ── Validate day is open ───────────────────────────────────────────────────
  const jsDayOfWeek = apptDate.getDay();
  const scheduleDay  = jsDayOfWeek === 0 ? 6 : jsDayOfWeek - 1;
  const daySchedule  = clinic.schedules.find(s => s.dayOfWeek === scheduleDay);
  if (!daySchedule?.enabled) {
    return NextResponse.json({ error: "La clínica no atiende ese día" }, { status: 400 });
  }

  // ── Verify startTime is within schedule ───────────────────────────────────
  const [slotH, slotM] = startTime.split(":").map(Number);
  const slotMins = slotH * 60 + slotM;
  const [openH, openM] = daySchedule.openTime.split(":").map(Number);
  const [closeH, closeM] = daySchedule.closeTime.split(":").map(Number);
  if (slotMins < openH * 60 + openM || slotMins + 30 > closeH * 60 + closeM) {
    return NextResponse.json({ error: "El horario está fuera del horario de atención" }, { status: 400 });
  }

  // ── Verify slot is available ──────────────────────────────────────────────
  const dateStart = new Date(y, m - 1, d, 0, 0, 0, 0);
  const dateEnd   = new Date(y, m - 1, d, 23, 59, 59, 999);

  // ── Calculate end time ─────────────────────────────────────────────────────
  const endMins = slotMins + 30;
  const endTime = `${String(Math.floor(endMins / 60)).padStart(2,"0")}:${String(endMins % 60).padStart(2,"0")}`;

  // ── Find or create patient ─────────────────────────────────────────────────
  let patient = await prisma.patient.findFirst({
    where: { clinicId: clinic.id, phone: cleanPhone },
  });

  if (!patient) {
    try {
      patient = await prisma.$transaction(async (tx) => {
        // Serializa creates concurrentes por clínica tomando row-lock del registro de la clínica
        await tx.$executeRaw`SELECT 1 FROM clinics WHERE id = ${clinic.id} FOR UPDATE`;
        const count = await tx.patient.count({ where: { clinicId: clinic.id } });
        const patientNumber = `P${String(count + 1).padStart(4, "0")}`;
        return tx.patient.create({
          data: {
            clinicId:       clinic.id,
            patientNumber,
            firstName:      firstName.trim(),
            lastName:       lastName.trim(),
            phone:          cleanPhone,
            email:          email?.trim() || null,
            primaryDoctorId:doctorId,
          },
        });
      });
    } catch (err) {
      console.error("[public/book] patient create failed:", err);
    }
  }

  if (!patient) {
    return NextResponse.json({ error: "Error creando perfil de paciente" }, { status: 500 });
  }

  // ── Check conflict + create appointment in a transaction (prevent double-booking) ──
  const appt = await prisma.$transaction(async (tx) => {
    const conflict = await tx.appointment.findFirst({
      where: {
        clinicId:  clinic.id,
        doctorId,
        date:      { gte: dateStart, lte: dateEnd },
        startTime,
        status:    { notIn: ["CANCELLED","NO_SHOW"] },
      },
    });
    if (conflict) {
      throw new Error("SLOT_TAKEN");
    }

    const startsAtBook = tzLocalToUtc(date, slotH, slotM, clinic.timezone);
    const endsAtBook = new Date(startsAtBook.getTime() + 30 * 60_000);
    return tx.appointment.create({
      data: {
        clinicId:    clinic.id,
        patientId:   patient!.id,
        doctorId,
        type:        type?.trim() || "Consulta general",
        date:        apptDate,
        startTime,
        endTime,
        durationMins:30,
        startsAt:    startsAtBook,
        endsAt:      endsAtBook,
        status:      "PENDING",
        notes:       notes?.trim() || null,
      },
    });
  }).catch((err) => {
    if (err.message === "SLOT_TAKEN") return null;
    throw err;
  });

  if (!appt) {
    return NextResponse.json({
      error: "Este horario ya fue reservado. Por favor elige otro horario.",
    }, { status: 409 });
  }

  // ── Send WhatsApp confirmation ─────────────────────────────────────────────
  if (clinic.waConnected && clinic.waPhoneNumberId && clinic.waAccessToken) {
    try {
      const dateFormatted = apptDate.toLocaleDateString("es-MX", {
        weekday:"long", day:"numeric", month:"long", year:"numeric",
      });
      const contactNum = clinic.phone ?? clinic.waPhoneNumberId;
      const msg = `✅ *Cita confirmada en ${clinic.name}*\n\n`
        + `📅 *Fecha:* ${dateFormatted}\n`
        + `🕐 *Hora:* ${startTime}\n`
        + `👨‍⚕️ *Doctor/a:* Dr/a. ${doctor.firstName} ${doctor.lastName}\n`
        + `📋 *Motivo:* ${type?.trim() || "Consulta general"}\n\n`
        + `Para cambios o cancelaciones contáctanos: ${contactNum}`;

      await sendWhatsAppMessage(
        clinic.waPhoneNumberId,
        clinic.waAccessToken,
        cleanPhone,
        msg
      );
    } catch (e) {
      console.error("WhatsApp confirmation failed:", e);
      // Don't fail the booking — WhatsApp is best-effort
    }
  }

  // ── Google Calendar sync ─────────────────────────────────────────────────
  try {
    const clinicGcal = await prisma.clinic.findUnique({
      where: { id: clinic.id },
      select: {
        name: true, address: true,
        googleCalendarEnabled: true, googleCalendarToken: true,
        googleRefreshToken: true, googleClinicCalendarId: true,
      },
    });

    if (clinicGcal?.googleCalendarEnabled && clinicGcal.googleRefreshToken) {
      let token = clinicGcal.googleCalendarToken;
      if (!token) {
        token = await refreshAccessToken(clinicGcal.googleRefreshToken);
        if (token) await prisma.clinic.update({ where: { id: clinic.id }, data: { googleCalendarToken: token } });
      }
      if (token) {
        // Auto-create clinic calendar if missing
        let calendarId = clinicGcal.googleClinicCalendarId;
        if (!calendarId) {
          try {
            calendarId = await getOrCreateClinicCalendar(token, clinicGcal.googleRefreshToken, clinicGcal.name);
            if (calendarId) {
              await prisma.clinic.update({ where: { id: clinic.id }, data: { googleClinicCalendarId: calendarId } });
            }
          } catch (err) {
            console.error("Error creating clinic calendar on-the-fly:", err);
          }
        }

        const gcalEventId = await createCalendarEvent(token, clinicGcal.googleRefreshToken, {
          id: appt.id, type: type?.trim() || "Consulta general",
          startsAt: appt.startsAt, endsAt: appt.endsAt, clinicTimezone: clinic.timezone,
          patientName: `${firstName.trim()} ${lastName.trim()}`,
          clinicName: clinicGcal.name, clinicAddress: clinicGcal.address,
          notes: notes?.trim() || null,
          doctorName: `${doctor.firstName} ${doctor.lastName}`,
          doctorEmail: null, patientEmail: email?.trim() || null,
          calendarId: calendarId ?? "primary",
        });
        if (gcalEventId) {
          await prisma.appointment.update({ where: { id: appt.id }, data: { googleCalendarEventId: gcalEventId } });
        }
      }
    }
  } catch (e) {
    console.error("Google Calendar sync failed:", e);
  }

  return NextResponse.json({
    success:       true,
    appointmentId: appt.id,
    patientId:     patient.id,
    message:       "¡Cita agendada con éxito! Te enviaremos un recordatorio por WhatsApp.",
  });
  } catch (err: any) {
    console.error("Booking error:", err);
    return NextResponse.json({ error: err.message ?? "Error interno al agendar" }, { status: 500 });
  }
}
