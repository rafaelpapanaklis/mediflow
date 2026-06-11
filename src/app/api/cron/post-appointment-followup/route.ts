import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { WA_REMINDER_STATUS } from "@/lib/whatsapp/reminder-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron — seguimiento post-cita por WhatsApp.
 *
 * Solo a clínicas con postApptFollowupActive=true Y WhatsApp conectado. Para
 * cada cita COMPLETED/CHECKED_OUT cuyo startsAt cae en la ventana de 24-48h
 * atrás y que aún no tiene seguimiento, ENCOLA "¿Cómo estuvo tu visita?" en
 * WhatsAppReminder (PENDING, type FOLLOWUP). El envío real lo hace
 * /api/cron/whatsapp-queue en batches. Dedupe por appointmentId con UNA sola
 * query por clínica (sin N+1). Default OFF.
 */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/post-appointment-followup] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  let queued = 0, skipped = 0;

  const clinics = await prisma.clinic.findMany({
    where: { postApptFollowupActive: true, waConnected: true },
    select: { id: true, name: true, waPhoneNumberId: true, waAccessToken: true },
  });

  for (const clinic of clinics) {
    if (!clinic.waPhoneNumberId || !clinic.waAccessToken) continue;

    const appts = await prisma.appointment.findMany({
      where: {
        clinicId: clinic.id,
        status: { in: ["COMPLETED", "CHECKED_OUT"] },
        startsAt: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, patient: { select: { firstName: true, phone: true } } },
    });
    if (appts.length === 0) continue;

    // Dedupe en UNA sola query: citas que ya tienen seguimiento -> Set.
    // Reemplaza el findFirst por cita (N+1).
    const existing = await prisma.whatsAppReminder.findMany({
      where: {
        clinicId: clinic.id,
        type: "FOLLOWUP",
        appointmentId: { in: appts.map((a) => a.id) },
      },
      select: { appointmentId: true },
    });
    const done = new Set(
      existing.map((e) => e.appointmentId).filter(Boolean) as string[],
    );

    const rows: Prisma.WhatsAppReminderCreateManyInput[] = [];
    for (const appt of appts) {
      if (!appt.patient?.phone) { skipped++; continue; }
      if (done.has(appt.id)) { skipped++; continue; }

      rows.push({
        clinicId:      clinic.id,
        appointmentId: appt.id,
        patientPhone:  appt.patient.phone,
        type:          "FOLLOWUP",
        message:       `Hola ${appt.patient.firstName} 👋\n\nGracias por tu visita a *${clinic.name}*. ¿Cómo te sentiste con tu atención? Tu opinión nos ayuda a mejorar. 🙏\n\nResponde a este mensaje y con gusto te leemos.`,
        status:        WA_REMINDER_STATUS.PENDING,
        scheduledFor:  now,
      });
      done.add(appt.id); // evita duplicar dentro de la misma corrida
    }

    if (rows.length > 0) {
      await prisma.whatsAppReminder.createMany({ data: rows });
      queued += rows.length;
    }
  }

  return NextResponse.json({ queued, skipped, clinics: clinics.length });
}
