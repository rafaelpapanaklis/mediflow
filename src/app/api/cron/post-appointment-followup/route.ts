import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/**
 * Cron — seguimiento post-cita por WhatsApp.
 *
 * Solo a clínicas con postApptFollowupActive=true Y WhatsApp conectado. Para
 * cada cita COMPLETED/CHECKED_OUT cuyo startsAt cae en la ventana de 24-48h
 * atrás (≈ "un día después") y que aún no tiene seguimiento, envía "¿Cómo
 * estuvo tu visita?" y registra un WhatsAppReminder type FOLLOWUP (dedupe).
 * Default OFF: no envía nada sin el toggle.
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
  let sent = 0, skipped = 0, errors = 0;

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
      take: 500,
    });

    for (const appt of appts) {
      if (!appt.patient?.phone) { skipped++; continue; }

      // Dedupe: no reenviar si ya hay un seguimiento para esta cita.
      const dupe = await prisma.whatsAppReminder.findFirst({
        where: { clinicId: clinic.id, appointmentId: appt.id, type: "FOLLOWUP" },
        select: { id: true },
      });
      if (dupe) { skipped++; continue; }

      const msg = `Hola ${appt.patient.firstName} 👋\n\nGracias por tu visita a *${clinic.name}*. ¿Cómo te sentiste con tu atención? Tu opinión nos ayuda a mejorar. 🙏\n\nResponde a este mensaje y con gusto te leemos.`;
      try {
        await sendWhatsAppMessage(clinic.waPhoneNumberId, clinic.waAccessToken, appt.patient.phone, msg);
        await prisma.whatsAppReminder.create({
          data: { clinicId: clinic.id, appointmentId: appt.id, type: "FOLLOWUP", status: "SENT", message: msg, sentAt: now, scheduledFor: now },
        });
        sent++;
      } catch (e: any) {
        await prisma.whatsAppReminder.create({
          data: { clinicId: clinic.id, appointmentId: appt.id, type: "FOLLOWUP", status: "FAILED", errorMsg: e?.message ?? "error", scheduledFor: now },
        });
        errors++;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return NextResponse.json({ sent, skipped, errors, clinics: clinics.length });
}
