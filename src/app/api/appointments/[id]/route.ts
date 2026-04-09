import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { deleteCalendarEvent, updateCalendarEvent, refreshAccessToken } from "@/lib/google-calendar";
import { revalidatePath } from "next/cache";

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
      ...(body.reminderSent !== undefined && { reminderSent: body.reminderSent          }),
      ...(body.price        !== undefined && { price:        Number(body.price)         }),
      ...(body.isPaid       !== undefined && { isPaid:       Boolean(body.isPaid)       }),
      ...(body.status === "CONFIRMED"     && { confirmedAt:  new Date()                 }),
      ...(body.status === "CANCELLED"     && { cancelledAt:  new Date(), cancelReason: body.cancelReason ?? null }),
    },
    include: {
      patient: { select: { firstName: true, lastName: true, email: true } },
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
              type:         updated.type,
              date:         updated.date instanceof Date ? updated.date.toISOString() : updated.date as string,
              startTime:    updated.startTime,
              endTime:      updated.endTime,
              patientName:  `${updated.patient.firstName} ${updated.patient.lastName}`,
              clinicName:   clinic.name,
              clinicAddress: clinic.address,
              notes:        updated.notes,
              doctorName:   updated.doctor ? `${updated.doctor.firstName} ${updated.doctor.lastName}` : null,
              calendarId:   clinic.googleClinicCalendarId ?? "primary",
            });
          }
        }
      }
    } catch (e) {
      console.error("Google Calendar sync on PATCH failed:", e);
    }
  }

  revalidatePath("/dashboard");

  return NextResponse.json({
    ...updated,
    date:      updated.date instanceof Date ? updated.date.toISOString() : updated.date,
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
  return NextResponse.json({ success: true });
}
