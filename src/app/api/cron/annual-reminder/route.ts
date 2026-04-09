import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Verify cron secret
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  let sent = 0, skipped = 0, errors = 0;

  // Get all clinics with recall active
  const clinics = await prisma.clinic.findMany({
    where: { recallActive: true, waConnected: true },
    select: { id: true, name: true, recallMonths: true, waPhoneNumberId: true, waAccessToken: true },
  });

  for (const clinic of clinics) {
    const recallDate = new Date(now);
    recallDate.setMonth(recallDate.getMonth() - clinic.recallMonths);

    // Find active patients whose last appointment was before recallDate
    // and haven't received a recall in the last 30 days
    const patients = await prisma.patient.findMany({
      where: {
        clinicId: clinic.id,
        status:   "ACTIVE",
        phone:    { not: null },
        appointments: {
          none: { date: { gte: recallDate }, status: { not: "CANCELLED" } },
        },
      },
      select: {
        id: true, firstName: true, lastName: true, phone: true,
        appointments: {
          orderBy: { date: "desc" },
          take: 1,
          select: { date: true },
        },
      },
      take: 100, // process in batches
    });

    for (const patient of patients) {
      if (!patient.phone) { skipped++; continue; }

      // Check if we already sent a recall reminder recently (last 30 days)
      const recentReminder = await prisma.whatsAppReminder.findFirst({
        where: {
          clinicId:    clinic.id,
          patientPhone: patient.phone,
          type:        "RECALL",
          sentAt:      { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      });
      if (recentReminder) { skipped++; continue; }

      const lastVisitText = patient.appointments[0]?.date
        ? new Date(patient.appointments[0].date).toLocaleDateString("es-MX", { month: "long", year: "numeric" })
        : "hace tiempo";

      const msg = `Hola ${patient.firstName} 😊\n\nTe contactamos de *${clinic.name}*.\n\nNos damos cuenta que tu última visita fue ${lastVisitText} y queremos recordarte que una revisión periódica es importante para mantener tu salud dental.\n\n🦷 Te invitamos a agendar tu cita de revisión.\n¿Te gustaría programar una? Responde *SÍ* y te contactamos de inmediato.`;

      try {
        await sendWhatsAppMessage(clinic.waPhoneNumberId!, clinic.waAccessToken!, patient.phone, msg);

        // Log reminder
        await prisma.whatsAppReminder.create({
          data: {
            clinicId:     clinic.id,
            patientPhone: patient.phone,
            type:         "RECALL",
            message:      msg,
            status:       "SENT",
            sentAt:       now,
          },
        });
        sent++;
      } catch (e) {
        console.error(`Recall error for patient ${patient.id}:`, e);
        errors++;
      }

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return NextResponse.json({ sent, skipped, errors, clinics: clinics.length });
}
