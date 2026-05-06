// Implants — cron diario que dispara ClinicalReminder programados.
//
// Ejecutado por Vercel Cron (vercel.json) — autenticado vía CRON_SECRET
// header. Para cada ClinicalReminder con (module=implants, status=pending,
// dueDate <= today + 24h):
//   1) Encola WhatsAppReminder con la plantilla correspondiente
//   2) Marca el ClinicalReminder como sent + triggeredAt
//
// El worker de WhatsApp (api/cron/whatsapp-queue) procesa el envío
// efectivo. Aquí solo se programa el mensaje.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  IMPLANT_REMINDER_RULES,
  renderImplantReminderMessage,
} from "@/lib/clinical-shared/reminder-rules";
import type { ImplantReminderRuleKey } from "@/lib/clinical-shared/types";

export const dynamic = "force-dynamic";

const WINDOW_AHEAD_HOURS = 24;

interface CronReport {
  found: number;
  enqueued: number;
  errors: number;
  examples: Array<{ id: string; reminderType: string; dueDate: string }>;
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + WINDOW_AHEAD_HOURS * 3600 * 1000);

  const due = await prisma.clinicalReminder.findMany({
    where: {
      module: "implants",
      status: "pending",
      deletedAt: null,
      dueDate: { lte: horizon },
    },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      reminderType: true,
      dueDate: true,
      payload: true,
      patient: { select: { firstName: true, phone: true } },
      clinic: { select: { waReminderActive: true } },
    },
    take: 500, // safety
  });

  const report: CronReport = {
    found: due.length,
    enqueued: 0,
    errors: 0,
    examples: [],
  };

  for (const r of due) {
    if (!r.clinic.waReminderActive) continue;
    if (!r.patient.phone) continue;

    // Resolvemos el ruleKey desde reminderType (set v2). Si es legacy
    // (implant_followup_*), saltamos — esos vienen de pediatrics base
    // y se manejan con templates genéricos en otro flow.
    const ruleKey = inferRuleKeyFromReminderType(r.reminderType);
    if (!ruleKey) continue;

    const payload = (r.payload as Record<string, unknown>) ?? {};
    const message = renderImplantReminderMessage(ruleKey, {
      patientName: r.patient.firstName ?? "",
      toothFdi: typeof payload.toothFdi === "number" ? payload.toothFdi : "",
    });

    try {
      const wa = await prisma.whatsAppReminder.create({
        data: {
          clinicId: r.clinicId,
          patientPhone: r.patient.phone,
          message,
          payload: {
            ...(payload as Record<string, unknown>),
            implantReminderRuleKey: ruleKey,
            sourceClinicalReminderId: r.id,
          },
          type: "IMPLANT",
          scheduledFor: r.dueDate,
        },
        select: { id: true },
      });
      await prisma.clinicalReminder.update({
        where: { id: r.id },
        data: {
          status: "sent",
          triggeredAt: now,
          whatsappReminderId: wa.id,
        },
      });
      report.enqueued += 1;
      if (report.examples.length < 5) {
        report.examples.push({
          id: r.id,
          reminderType: r.reminderType,
          dueDate: r.dueDate.toISOString(),
        });
      }
    } catch (err) {
      report.errors += 1;
      console.error("[cron/implants-reminders] error", err);
    }
  }

  return NextResponse.json(report);
}

function inferRuleKeyFromReminderType(
  reminderType: string,
): ImplantReminderRuleKey | null {
  const map: Record<string, ImplantReminderRuleKey> = {
    implant_cicatrizacion_7d: "control_cicatrizacion_7d",
    implant_retiro_sutura_10d: "retiro_sutura_10d",
    implant_oseointegracion_4m: "control_oseointegracion_4m",
    implant_control_anual: "control_anual_implante",
    implant_peri_implantitis_6m: "control_peri_implantitis_6m",
  };
  return map[reminderType] ?? null;
}

// Sanity check: cada rule en IMPLANT_REMINDER_RULES tiene mapeo inverso
void IMPLANT_REMINDER_RULES;
