import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/**
 * Cron — mensaje de cumpleaños por WhatsApp.
 *
 * Solo a clínicas con birthdayMsgActive=true Y WhatsApp conectado. A cada
 * paciente ACTIVE con teléfono cuyo dob (mes/día UTC) sea hoy y al que no le
 * hayamos escrito este año (lastBirthdayMsgAt), le manda una felicitación y
 * marca lastBirthdayMsgAt. Default OFF: no envía nada sin el toggle.
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
  const todayMonth = now.getUTCMonth();
  const todayDate = now.getUTCDate();
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  let sent = 0, skipped = 0, errors = 0;

  const clinics = await prisma.clinic.findMany({
    where: { birthdayMsgActive: true, waConnected: true },
    select: { id: true, name: true, waPhoneNumberId: true, waAccessToken: true },
  });

  for (const clinic of clinics) {
    if (!clinic.waPhoneNumberId || !clinic.waAccessToken) continue;

    // Candidatos: dob no nulo y aún no felicitados este año. El match exacto
    // de mes/día se hace en JS (Prisma no filtra por EXTRACT fácilmente).
    const candidates = await prisma.patient.findMany({
      where: {
        clinicId: clinic.id,
        status: "ACTIVE",
        deletedAt: null,
        phone: { not: null },
        dob: { not: null },
        OR: [{ lastBirthdayMsgAt: null }, { lastBirthdayMsgAt: { lt: yearStart } }],
      },
      select: { id: true, firstName: true, phone: true, dob: true },
      take: 5000,
    });

    for (const p of candidates) {
      if (!p.phone || !p.dob) { skipped++; continue; }
      const dob = new Date(p.dob);
      if (dob.getUTCMonth() !== todayMonth || dob.getUTCDate() !== todayDate) continue;

      const msg = `¡Feliz cumpleaños, ${p.firstName}! 🎉\n\nTodo el equipo de *${clinic.name}* te desea un excelente día. Gracias por tu confianza. 💙`;
      try {
        await sendWhatsAppMessage(clinic.waPhoneNumberId, clinic.waAccessToken, p.phone, msg);
        await prisma.patient.update({ where: { id: p.id }, data: { lastBirthdayMsgAt: now } });
        sent++;
      } catch (e) {
        console.error(`[cron/birthday-messages] error patient ${p.id}:`, e);
        errors++;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return NextResponse.json({ sent, skipped, errors, clinics: clinics.length });
}
