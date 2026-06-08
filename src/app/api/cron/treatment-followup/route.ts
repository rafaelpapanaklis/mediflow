import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/treatment-followup
// Called daily by Vercel Cron (configured in vercel.json).
// Encola recordatorios para pacientes con su próxima sesión de tratamiento
// vencida y deja que /api/cron/whatsapp-queue los envíe en batches. Marca
// lastFollowUpSent en la MISMA transacción que el encolado (dedupe 7 días),
// sin sleep serial ni techo por corrida.
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/treatment-followup] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Find ACTIVE plans where:
  // 1. nextExpectedDate has passed (patient should have come in already)
  // 2. No follow-up sent in the last 7 days (prevent spam)
  const overduePlans = await prisma.treatmentPlan.findMany({
    where: {
      status:           "ACTIVE",
      nextExpectedDate: { lt: now, not: null }, // must be set and in the past
      OR: [
        { lastFollowUpSent: null },
        { lastFollowUpSent: { lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
      ],
    },
    include: {
      patient: { select: { firstName: true, phone: true } },
      doctor:  { select: { firstName: true, lastName: true } },
      clinic: {
        select: {
          name: true, phone: true,
          waConnected: true, waPhoneNumberId: true, waAccessToken: true,
        },
      },
      sessions: {
        where:   { completedAt: { not: null } },
        orderBy: { sessionNumber: "asc" },
      },
    },
  });

  let skipped = 0;
  const rows: Prisma.WhatsAppReminderCreateManyInput[] = [];
  const claimedPlanIds: string[] = [];

  for (const plan of overduePlans) {
    // Skip if no WhatsApp
    if (!plan.clinic.waConnected || !plan.clinic.waPhoneNumberId || !plan.clinic.waAccessToken) {
      skipped++; continue;
    }
    // Skip if no patient phone
    if (!plan.patient.phone) { skipped++; continue; }

    // nextExpectedDate is confirmed non-null by the where clause, but TS can't
    // narrow it after the include, so check explicitly.
    if (!plan.nextExpectedDate) { skipped++; continue; }

    const completedSessions = plan.sessions.length;
    const remaining         = Math.max(0, plan.totalSessions - completedSessions);
    const daysOverdue       = Math.floor(
      (now.getTime() - plan.nextExpectedDate.getTime()) / (24 * 60 * 60 * 1000)
    );

    const message = buildFollowUpMessage({
      patientName:      plan.patient.firstName,
      clinicName:       plan.clinic.name,
      clinicPhone:      plan.clinic.phone ?? "",
      doctorName:       `Dr/a. ${plan.doctor.firstName} ${plan.doctor.lastName}`,
      treatmentName:    plan.name,
      completedSessions,
      totalSessions:    plan.totalSessions,
      remaining,
      daysOverdue,
    });

    rows.push({
      clinicId:     plan.clinicId,
      patientPhone: plan.patient.phone,
      type:         "TREATMENT_FOLLOWUP",
      message,
      status:       "PENDING",
      scheduledFor: now,
    });
    claimedPlanIds.push(plan.id);
  }

  if (rows.length > 0) {
    // Encola + marca lastFollowUpSent atómicamente (dedupe 7 días): así un re-run
    // no reencola los mismos planes aunque el queue aún no los haya enviado.
    await prisma.$transaction([
      prisma.whatsAppReminder.createMany({ data: rows }),
      prisma.treatmentPlan.updateMany({
        where: { id: { in: claimedPlanIds } },
        data: { lastFollowUpSent: now },
      }),
    ]);
  }

  return NextResponse.json({
    ok:        true,
    processed: overduePlans.length,
    queued:    rows.length,
    skipped,
    timestamp: now.toISOString(),
  });
}

function buildFollowUpMessage(p: {
  patientName: string; clinicName: string; clinicPhone: string;
  doctorName: string; treatmentName: string;
  completedSessions: number; totalSessions: number;
  remaining: number; daysOverdue: number;
}) {
  // Progress bar: 10 chars wide
  const filled      = p.totalSessions > 0 ? Math.round((p.completedSessions / p.totalSessions) * 10) : 0;
  const progressBar = "▓".repeat(filled) + "░".repeat(10 - filled);
  const pct         = p.totalSessions > 0 ? Math.round((p.completedSessions / p.totalSessions) * 100) : 0;

  let urgency: string;
  if (p.daysOverdue > 30)      urgency = "⚠️ Llevas más de un mes sin continuar tu tratamiento.";
  else if (p.daysOverdue > 14) urgency = "Ya pasó un tiempo desde tu última sesión.";
  else                          urgency = "Es momento de continuar con tu tratamiento.";

  const contactLine = p.clinicPhone ? `\nPara agendar: ${p.clinicPhone}` : "";

  return `Hola ${p.patientName} 👋\n\n`
    + `${urgency}\n\n`
    + `📋 *Tratamiento:* ${p.treatmentName}\n`
    + `🏥 *Clínica:* ${p.clinicName}\n`
    + `👨‍⚕️ ${p.doctorName}\n\n`
    + `*Tu progreso:* ${progressBar} ${pct}%\n`
    + `${p.completedSessions} de ${p.totalSessions} sesiones · ${p.remaining} restantes\n`
    + `${contactLine}\n\n`
    + `¡Tu salud nos importa! 💙`;
}
