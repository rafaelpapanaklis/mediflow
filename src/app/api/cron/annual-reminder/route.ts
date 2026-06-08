import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/annual-reminder
// Encola recordatorios de recall (no envía directo): crea WhatsAppReminder
// PENDING y deja que /api/cron/whatsapp-queue los mande en batches. Sin techo
// por corrida y sin N+1 de dedupe — una sola query de recalls recientes por
// clínica -> Set en memoria.
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/annual-reminder] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const dedupeCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let queued = 0, skipped = 0;

  // Clínicas con recall activo y WhatsApp conectado.
  const clinics = await prisma.clinic.findMany({
    where: { recallActive: true, waConnected: true },
    select: { id: true, name: true, recallMonths: true },
  });

  for (const clinic of clinics) {
    const recallDate = new Date(now);
    recallDate.setMonth(recallDate.getMonth() - clinic.recallMonths);

    // Pacientes activos cuya última cita fue antes de recallDate (sin techo).
    const patients = await prisma.patient.findMany({
      where: {
        clinicId: clinic.id,
        status:   "ACTIVE",
        phone:    { not: null },
        appointments: {
          none: { startsAt: { gte: recallDate }, status: { not: "CANCELLED" } },
        },
      },
      select: {
        id: true, firstName: true, lastName: true, phone: true,
        appointments: {
          orderBy: { startsAt: "desc" },
          take: 1,
          select: { startsAt: true },
        },
      },
    });
    if (patients.length === 0) continue;

    // Dedupe en UNA sola query: recalls de los últimos 30 días (PENDING o
    // SENT) -> Set de teléfonos ya contactados. Reemplaza el findFirst por
    // paciente (N+1).
    const recentRecalls = await prisma.whatsAppReminder.findMany({
      where: {
        clinicId:  clinic.id,
        type:      "RECALL",
        status:    { in: ["PENDING", "SENT"] },
        createdAt: { gte: dedupeCutoff },
      },
      select: { patientPhone: true },
    });
    const contacted = new Set(
      recentRecalls.map((r) => r.patientPhone).filter(Boolean) as string[],
    );

    const rows: Prisma.WhatsAppReminderCreateManyInput[] = [];
    for (const patient of patients) {
      if (!patient.phone) { skipped++; continue; }
      if (contacted.has(patient.phone)) { skipped++; continue; }

      const lastVisitText = patient.appointments[0]?.startsAt
        ? new Date(patient.appointments[0].startsAt).toLocaleDateString("es-MX", { month: "long", year: "numeric" })
        : "hace tiempo";

      const msg = `Hola ${patient.firstName} 😊\n\nTe contactamos de *${clinic.name}*.\n\nNos damos cuenta que tu última visita fue ${lastVisitText} y queremos recordarte que una revisión periódica es importante para mantener tu salud dental.\n\n🦷 Te invitamos a agendar tu cita de revisión.\n¿Te gustaría programar una? Responde *SÍ* y te contactamos de inmediato.`;

      rows.push({
        clinicId:     clinic.id,
        patientPhone: patient.phone,
        type:         "RECALL",
        message:      msg,
        status:       "PENDING",
        scheduledFor: now,
      });
      contacted.add(patient.phone); // evita duplicar dentro de la misma corrida
    }

    // Encola en chunks (límite de parámetros de Postgres en INSERT masivo).
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await prisma.whatsAppReminder.createMany({ data: rows.slice(i, i + CHUNK) });
    }
    queued += rows.length;
  }

  return NextResponse.json({ queued, skipped, clinics: clinics.length });
}
