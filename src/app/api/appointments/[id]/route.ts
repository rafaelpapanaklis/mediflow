import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { deleteCalendarEvent, updateCalendarEvent, refreshAccessToken } from "@/lib/google-calendar";
import { revalidatePath } from "next/cache";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import { dateISOInTz, timeHHMMInTz, durationMinutes } from "@/lib/agenda/legacy-helpers";

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

  const clinicTz = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { timezone: true },
  });
  const tz = clinicTz?.timezone ?? "America/Mexico_City";

  let newStartsAt: Date | undefined;
  let newEndsAt: Date | undefined;
  if (
    body.date !== undefined ||
    body.startTime !== undefined ||
    body.endTime !== undefined ||
    body.durationMins !== undefined
  ) {
    const dateStr = body.date ?? dateISOInTz(appt.startsAt, tz);
    const startStr = body.startTime ?? timeHHMMInTz(appt.startsAt, tz);
    const [sH, sM] = String(startStr).split(":").map(Number);
    newStartsAt = tzLocalToUtc(String(dateStr).split("T")[0], sH, sM, tz);

    if (body.endTime !== undefined) {
      const [eH, eM] = String(body.endTime).split(":").map(Number);
      newEndsAt = tzLocalToUtc(String(dateStr).split("T")[0], eH, eM, tz);
    } else {
      const dur = body.durationMins != null
        ? Number(body.durationMins)
        : durationMinutes(appt.startsAt, appt.endsAt);
      newEndsAt = new Date(newStartsAt.getTime() + dur * 60_000);
    }
  }

  const updated = await prisma.appointment.update({
    where: { id: params.id },
    data: {
      ...(body.status       !== undefined && { status:       body.status                }),
      ...(body.patientId    !== undefined && { patientId:    body.patientId             }),
      ...(body.doctorId     !== undefined && { doctorId:     body.doctorId              }),
      ...(body.type         !== undefined && { type:         body.type                  }),
      ...(body.notes        !== undefined && { notes:        body.notes                 }),
      ...(body.startTime    !== undefined && { startTime:    body.startTime             }),
      ...(body.endTime      !== undefined && { endTime:      body.endTime               }),
      ...(body.durationMins !== undefined && { durationMins: Number(body.durationMins)  }),
      ...(body.date         !== undefined && { date:         new Date(body.date)        }),
      ...(newStartsAt && { startsAt: newStartsAt }),
      ...(newEndsAt   && { endsAt:   newEndsAt   }),
      ...(body.reminderSent !== undefined && { reminderSent: body.reminderSent          }),
      ...(body.price        !== undefined && { price:        Number(body.price)         }),
      ...(body.isPaid       !== undefined && { isPaid:       Boolean(body.isPaid)       }),
      ...(body.status === "CONFIRMED"     && { confirmedAt:  new Date()                 }),
      ...(body.status === "CANCELLED"     && { cancelledAt:  new Date(), cancelReason: body.cancelReason ?? null }),
    },
    include: {
      patient: { select: { firstName: true, lastName: true, email: true, phone: true } },
      doctor:  { select: { firstName: true, lastName: true } },
    },
  });

  // Google Calendar sync
  if (appt.googleCalendarEventId) {
    try {
      const clinic = await prisma.clinic.findUnique({
        where: { id: ctx.clinicId },
        select: { name: true, address: true, googleCalendarToken: true, googleRefreshToken: true, googleClinicCalendarId: true },
      });

      if (clinic?.googleRefreshToken) {
        const token = await refreshAccessToken(clinic.googleRefreshToken) ?? clinic.googleCalendarToken;

        if (token) {
          // If cancelled or no-show → delete the event
          if (body.status === "CANCELLED" || body.status === "NO_SHOW") {
            await deleteCalendarEvent(token, clinic.googleRefreshToken, appt.googleCalendarEventId, clinic.googleClinicCalendarId ?? "primary");
          }
          // If date, time, type, notes, doctor, or patient changed → update the event
          else if (body.date !== undefined || body.startTime !== undefined || body.endTime !== undefined ||
                   body.type !== undefined || body.notes !== undefined || body.doctorId !== undefined || body.patientId !== undefined) {
            await updateCalendarEvent(token, clinic.googleRefreshToken, appt.googleCalendarEventId, {
              type:           updated.type,
              startsAt:       updated.startsAt,
              endsAt:         updated.endsAt,
              clinicTimezone: tz,
              patientName:    `${updated.patient.firstName} ${updated.patient.lastName}`,
              clinicName:     clinic.name,
              clinicAddress:  clinic.address,
              notes:          updated.notes,
              doctorName:     updated.doctor ? `${updated.doctor.firstName} ${updated.doctor.lastName}` : null,
              calendarId:     clinic.googleClinicCalendarId ?? "primary",
            });
          }
        }
      }
    } catch (e) {
      console.error("Google Calendar sync on PATCH failed:", e);
    }
  }

  // WhatsApp notification on reschedule
  if (body.date !== undefined || body.startTime !== undefined) {
    try {
      const waClinic = await prisma.clinic.findUnique({
        where: { id: appt.clinicId },
        select: { waConnected: true, waPhoneNumberId: true, waAccessToken: true, name: true },
      });

      if (waClinic?.waConnected && waClinic.waPhoneNumberId && waClinic.waAccessToken && updated.patient.phone) {
        const fecha = new Intl.DateTimeFormat("es-MX", {
          timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric",
        }).format(updated.startsAt);
        const hora = timeHHMMInTz(updated.startsAt, tz);

        await sendWhatsAppMessage(
          waClinic.waPhoneNumberId,
          waClinic.waAccessToken,
          updated.patient.phone,
          `📅 Tu cita en ${waClinic.name} ha sido reprogramada.\n\nNueva fecha: ${fecha}\nNueva hora: ${hora}\n\nSi necesitas cancelar, responde este mensaje.`
        );
      }
    } catch (e) {
      console.error("WhatsApp reschedule notification failed:", e);
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/appointments");

  return NextResponse.json({
    ...updated,
    date:      updated.date instanceof Date ? updated.date.toISOString() : updated.date,
    startsAt:  updated.startsAt.toISOString(),
    endsAt:    updated.endsAt.toISOString(),
    createdAt: updated.createdAt instanceof Date ? updated.createdAt.toISOString() : updated.createdAt,
    updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : updated.updatedAt,
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (ctx.isDoctor) {
    return NextResponse.json({ error: "Los doctores no pueden eliminar citas" }, { status: 403 });
  }

  const appt = await prisma.appointment.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { googleCalendarEventId: true, clinicId: true },
  });

  if (appt?.googleCalendarEventId) {
    try {
      const clinic = await prisma.clinic.findUnique({
        where: { id: appt.clinicId },
        select: { googleCalendarToken: true, googleRefreshToken: true, googleClinicCalendarId: true },
      });
      if (clinic?.googleRefreshToken) {
        const token = await refreshAccessToken(clinic.googleRefreshToken) ?? clinic.googleCalendarToken;
        if (token) {
          await deleteCalendarEvent(token, clinic.googleRefreshToken, appt.googleCalendarEventId, clinic.googleClinicCalendarId ?? "primary");
        }
      }
    } catch (e) {
      console.error("Failed to delete Google Calendar event:", e);
    }
  }

  await prisma.appointment.deleteMany({
    where: { id: params.id, clinicId: ctx.clinicId },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/appointments");

  return NextResponse.json({ success: true });
}
