import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Cron — tarea de staff por riesgo de no-show.
 *
 * Solo a clínicas con noShowTaskActive=true. NO envía WhatsApp: crea una tarea
 * INTERNA (Reminder) para que el equipo confirme citas próximas (siguientes
 * 48h) con NoShowPrediction.probability >= 0.6. Dedupe por marcador [appt:ID]
 * en el cuerpo de la tarea. Default OFF: no crea nada sin el toggle.
 */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/no-show-tasks] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  let created = 0, skipped = 0;

  const clinics = await prisma.clinic.findMany({
    where: { noShowTaskActive: true },
    select: { id: true },
  });

  for (const clinic of clinics) {
    // ws1-t11 (D7) — la tarea de una cita «Sin doctor» va al dueño de la clínica. Se busca una vez por clínica
    // y solo si hace falta.
    let dueno: string | null | undefined;
    const duenoDeLaClinica = async (): Promise<string | null> => {
      if (dueno === undefined) {
        const u = await prisma.user.findFirst({
          where: { clinicId: clinic.id, role: "SUPER_ADMIN", isActive: true },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        dueno = u?.id ?? null;
      }
      return dueno;
    };
    const predictions = await prisma.noShowPrediction.findMany({
      where: {
        probability: { gte: 0.6 },
        appointment: {
          clinicId: clinic.id,
          startsAt: { gte: now, lte: windowEnd },
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
        },
      },
      select: {
        probability: true,
        appointment: {
          select: {
            id: true,
            startsAt: true,
            doctorId: true,
            patient: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { probability: "desc" },
      take: 200,
    });

    for (const pred of predictions) {
      const appt = pred.appointment;
      if (!appt) { skipped++; continue; }

      // Dedupe: una sola tarea por cita (marcador estable en el cuerpo).
      const marker = `[appt:${appt.id}]`;
      const dupe = await prisma.reminder.findFirst({
        where: { clinicId: clinic.id, body: { contains: marker } },
        select: { id: true },
      });
      if (dupe) { skipped++; continue; }

      // Asignada al doctor de la cita; si no tiene, al dueño (sin dueño activo, no se crea: el cron sigue).
      const responsable = appt.doctorId ?? (await duenoDeLaClinica());
      if (!responsable) { skipped++; continue; }

      const name = `${appt.patient.firstName} ${appt.patient.lastName}`.trim();
      const pct = Math.round(pred.probability * 100);
      // Asignada al doctor de la cita (staff responsable); createdBy = mismo.
      await prisma.reminder.create({
        data: {
          clinicId: clinic.id,
          createdById: responsable,
          assignedToId: responsable,
          patientId: appt.patient.id,
          title: `Confirmar cita de alto riesgo: ${name}`,
          body: `Riesgo de inasistencia ${pct}%. Confirma la cita con el paciente. ${marker}`,
          dueAt: appt.startsAt,
        },
      });
      created++;
    }
  }

  return NextResponse.json({ created, skipped, clinics: clinics.length });
}
