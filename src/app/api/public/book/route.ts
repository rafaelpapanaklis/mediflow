import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import { createCalendarEvent, refreshAccessToken, getOrCreateClinicCalendar } from "@/lib/google-calendar";
import { rateLimit } from "@/lib/rate-limit";
import { tzLocalToUtc, getTzParts } from "@/lib/agenda/time-utils";
import { isOverlapError } from "@/lib/agenda/api-helpers";
import { getPatientPortalContext } from "@/lib/patient-portal/guard";
import { resolveBookingPatient } from "@/lib/patient-portal/link";

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

  // Validate startTime format HH:MM
  if (!/^\d{2}:\d{2}$/.test(startTime)) {
    return NextResponse.json({ error: "Formato de hora inválido" }, { status: 400 });
  }

  // ── Require patient portal session ─────────────────────────────────────────
  const ctx = await getPatientPortalContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Inicia sesión para reservar tu cita", requiresAuth: true },
      { status: 401 }
    );
  }

  // ── Find clinic ────────────────────────────────────────────────────────────
  const clinic = await prisma.clinic.findUnique({
    where: { slug },
    select: {
      id: true, name: true, phone: true, timezone: true,
      waConnected: true, waPhoneNumberId: true, waAccessToken: true,
      // Quien reserva desde la web pública casi nunca ha escrito antes por
      // WhatsApp: la ventana de 24 h está cerrada y la confirmación solo sale
      // por plantilla (M-09).
      waTemplates: true,
      schedules: { select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true } },
    },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  // ── Validate date is not in the past — en la TZ DE LA CLÍNICA (P1-10) ─────
  // Con el reloj del server en UTC, después de las 18:00 CDMX "hoy" se
  // rechazaba como fecha pasada. Misma técnica que la ruta hermana del portal.
  const nowTz = getTzParts(new Date(), clinic.timezone);
  const todayInClinicTz = `${nowTz.year}-${String(nowTz.month).padStart(2, "0")}-${String(nowTz.day).padStart(2, "0")}`;
  if (date < todayInClinicTz) {
    return NextResponse.json({ error: "La fecha debe ser hoy o futura" }, { status: 400 });
  }

  // ── Verify doctor belongs to this clinic ──────────────────────────────────
  // doctorId === "any" = el paciente eligió "cualquier disponible". El doctor
  // NO se elige aquí: se elige DENTRO de la transacción que crea la cita, con
  // una lectura fresca de quién está ocupado. Si se eligiera ahora, dos
  // reservas simultáneas leerían la misma foto y caerían en el mismo doctor.
  const anyDoctor = doctorId === "any";
  const candidates = await prisma.user.findMany({
    where: {
      clinicId: clinic.id, isActive: true, role: { in: ["DOCTOR","ADMIN","SUPER_ADMIN"] },
      ...(anyDoctor ? {} : { id: doctorId }),
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });
  if (candidates.length === 0) return NextResponse.json({ error: "Doctor no disponible" }, { status: 404 });

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

  // ── Calculate end time ─────────────────────────────────────────────────────
  const endMins = slotMins + 30;
  const endTime = `${String(Math.floor(endMins / 60)).padStart(2,"0")}:${String(endMins % 60).padStart(2,"0")}`;

  // ── Resolve patient from portal session (link por email verificado o crear) ─
  const resolved = await resolveBookingPatient({
    accountId:       ctx.account.id,
    accountEmail:    ctx.account.email,
    clinicId:        clinic.id,
    firstName:       firstName.trim(),
    lastName:        lastName.trim(),
    phone:           cleanPhone,
    email:           email?.trim() || null,
    // Con "cualquiera" todavía no hay doctor: el expediente nace SIN doctor de
    // cabecera antes que con uno inventado.
    primaryDoctorId: anyDoctor ? null : doctorId,
  });

  // ── Check conflict + create appointment in a transaction (prevent double-booking) ──
  const startsAtBook = tzLocalToUtc(date, slotH, slotM, clinic.timezone);
  const endsAtBook = new Date(startsAtBook.getTime() + 30 * 60_000);

  /**
   * Elige un doctor libre y crea la cita en la MISMA transacción: la lectura
   * de ocupados y el INSERT no se pueden separar o dos reservas simultáneas
   * con "cualquiera" caerían en el mismo doctor.
   */
  const bookOnce = async () => {
    return prisma.$transaction(async (tx) => {
      // Pre-check por SOLAPE (P1-10), no por igualdad de startsAt: una cita de
      // 10:00–11:00 también bloquea "10:30". Mismo criterio que la constraint
      // EXCLUDE (ignora CANCELLED/NO_SHOW y filas con overrideReason).
      const conflicts = await tx.appointment.findMany({
        where: {
          clinicId:  clinic!.id,
          doctorId:  { in: candidates.map(c => c.id) },
          status:    { notIn: ["CANCELLED","NO_SHOW"] },
          overrideReason: null,
          startsAt:  { lt: endsAtBook },
          endsAt:    { gt: startsAtBook },
        },
        select: { doctorId: true },
      });
      const ocupados = new Set(conflicts.map(c => c.doctorId));
      const elegido = candidates.find(c => !ocupados.has(c.id));
      if (!elegido) throw new Error("SLOT_TAKEN");

      const created = await tx.appointment.create({
        data: {
          clinicId:    clinic!.id,
          patientId:   resolved.patientId,
          doctorId:    elegido.id,
          type:        type?.trim() || "Consulta general",
          startsAt:    startsAtBook,
          endsAt:      endsAtBook,
          status:      "SCHEDULED",
          notes:       notes?.trim() || null,
          // P1-11: origen real + bandeja de validación, como el bot de WhatsApp.
          // Antes caía en los defaults (STAFF, false) y la clínica jamás
          // revisaba las reservas web en fetchPendingValidation.
          source:             "WEBSITE",
          requiresValidation: true,
        },
      });
      return { appt: created, doctor: elegido };
    });
  };

  // Carrera perdida contra la constraint EXCLUDE (23P01): con "cualquiera"
  // puede quedar OTRO doctor libre, así que se relee y se reintenta. Con un
  // doctor concreto el reintento vuelve a encontrarlo ocupado y sale por 409.
  let booked: { appt: { id: string; startsAt: Date; endsAt: Date }; doctor: { id: string; firstName: string; lastName: string } } | null = null;
  for (let intento = 0; intento < 3; intento++) {
    try {
      booked = await bookOnce();
      break;
    } catch (err: any) {
      if (err?.message === "SLOT_TAKEN") break;   // no queda NINGÚN doctor libre
      if (isOverlapError(err)) continue;          // se lo ganaron: relee y reintenta
      throw err;
    }
  }

  if (!booked) {
    return NextResponse.json({
      error: anyDoctor
        ? "Ese horario acaba de ocuparse con todos los doctores. Elige otro horario, por favor."
        : "Este horario ya fue reservado. Por favor elige otro horario.",
    }, { status: 409 });
  }
  const { appt, doctor } = booked;

  // ── Send WhatsApp confirmation ─────────────────────────────────────────────
  if (clinic.waConnected && clinic.waPhoneNumberId && clinic.waAccessToken) {
    try {
      const dateFormatted = apptDate.toLocaleDateString("es-MX", {
        weekday:"long", day:"numeric", month:"long", year:"numeric",
      });
      const contactNum = clinic.phone ?? clinic.waPhoneNumberId;
      // Copy honesto (P1-11): la cita nace requiresValidation=true — la
      // clínica la confirma en la bandeja de validación, igual que el bot.
      const msg = `✅ *Cita registrada en ${clinic.name}*\n\n`
        + `📅 *Fecha:* ${dateFormatted}\n`
        + `🕐 *Hora:* ${startTime}\n`
        + `👨‍⚕️ *Doctor/a:* Dr/a. ${doctor.firstName} ${doctor.lastName}\n`
        + `📋 *Motivo:* ${type?.trim() || "Consulta general"}\n\n`
        + `La clínica confirmará tu cita en breve.\n`
        + `Para cambios o cancelaciones contáctanos: ${contactNum}`;

      await sendWhatsAppLogged({
        clinic,
        to: cleanPhone,
        body: msg,
        kind: "booking",
        // {{1}} paciente, {{2}} clínica, {{3}} fecha, {{4}} hora — el orden de
        // WA_TEMPLATE_SPECS. Meta sustituye por posición, no por nombre.
        templateParams: [firstName.trim(), clinic.name, dateFormatted, startTime],
      });
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
    patientId:     resolved.patientId,
    message:       "¡Cita registrada! La clínica la confirmará en breve.",
  });
  } catch (err: any) {
    console.error("Booking error:", err);
    // 23P01 fuera de la tx (carrera rarísima) también merece un 409 claro.
    if (isOverlapError(err)) {
      return NextResponse.json(
        { error: "Este horario ya fue reservado. Por favor elige otro horario." },
        { status: 409 },
      );
    }
    // Nunca el error crudo (venía de Postgres/stack interno) a un cliente
    // anónimo: mensaje genérico y el detalle queda en el log.
    return NextResponse.json({ error: "Error interno al agendar. Intenta de nuevo." }, { status: 500 });
  }
}
