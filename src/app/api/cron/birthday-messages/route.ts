import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { WA_REMINDER_STATUS } from "@/lib/whatsapp/reminder-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron — mensaje de cumpleaños por WhatsApp.
 *
 * Solo a clínicas con birthdayMsgActive=true Y WhatsApp conectado. A cada
 * paciente ACTIVE con teléfono cuyo dob (mes/día) sea hoy y al que no le
 * hayamos escrito este año (lastBirthdayMsgAt), le ENCOLA una felicitación en
 * WhatsAppReminder (PENDING) y marca lastBirthdayMsgAt en la misma transacción.
 * El envío real lo hace /api/cron/whatsapp-queue en batches. El match mes/día
 * se hace en SQL (no se traen miles de pacientes a JS). Default OFF.
 */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/birthday-messages] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const todayMonth = now.getUTCMonth() + 1; // EXTRACT(MONTH) es 1-indexado
  const todayDate = now.getUTCDate();
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  let queued = 0;

  const clinics = await prisma.clinic.findMany({
    where: { birthdayMsgActive: true, waConnected: true },
    select: { id: true, name: true, waPhoneNumberId: true, waAccessToken: true },
  });

  for (const clinic of clinics) {
    if (!clinic.waPhoneNumberId || !clinic.waAccessToken) continue;

    // Match exacto de mes/día en SQL (EXTRACT) para no traer miles de
    // pacientes a JS. dob es timestamp sin tz, así que EXTRACT devuelve los
    // componentes UTC almacenados (igual que getUTCMonth/getUTCDate).
    const candidates = await prisma.$queryRaw<
      Array<{ id: string; firstName: string; phone: string }>
    >`
      SELECT id, "firstName", phone
      FROM patients
      WHERE "clinicId" = ${clinic.id}
        AND status = 'ACTIVE'
        AND "deletedAt" IS NULL
        AND phone IS NOT NULL
        AND dob IS NOT NULL
        AND EXTRACT(MONTH FROM dob)::int = ${todayMonth}
        AND EXTRACT(DAY FROM dob)::int = ${todayDate}
        AND ("lastBirthdayMsgAt" IS NULL OR "lastBirthdayMsgAt" < ${yearStart})
    `;
    if (candidates.length === 0) continue;

    const rows: Prisma.WhatsAppReminderCreateManyInput[] = candidates.map((p) => ({
      clinicId:     clinic.id,
      patientPhone: p.phone,
      type:         "BIRTHDAY",
      message:      `¡Feliz cumpleaños, ${p.firstName}! 🎉\n\nTodo el equipo de *${clinic.name}* te desea un excelente día. Gracias por tu confianza. 💙`,
      status:       WA_REMINDER_STATUS.PENDING,
      scheduledFor: now,
    }));

    // Encola + marca lastBirthdayMsgAt atómicamente: o ambas o ninguna, para no
    // encolar sin marcar (doble felicitación) ni marcar sin encolar.
    await prisma.$transaction([
      prisma.whatsAppReminder.createMany({ data: rows }),
      prisma.patient.updateMany({
        where: { id: { in: candidates.map((p) => p.id) } },
        data: { lastBirthdayMsgAt: now },
      }),
    ]);
    queued += rows.length;
  }

  return NextResponse.json({ queued, clinics: clinics.length });
}
