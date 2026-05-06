// Clinical-shared — worker que procesa los ClinicalReminder próximos a
// vencer y los encola en WhatsAppReminder con la plantilla apropiada.
//
// Llamado por el cron diario /api/cron/clinical-reminders (06:00 MX).
// Solo encola los que tienen `dueDate <= now + LOOKAHEAD_DAYS` y
// `status = pending`. Los marca como `sent` (status WhatsAppReminder se
// gestiona por el queue-worker).

import { prisma } from "@/lib/prisma";
import {
  CLINICAL_REMINDER_TEMPLATES,
  type ClinicalReminderTemplate,
} from "./templates";

const LOOKAHEAD_DAYS = 7;
const BATCH_SIZE = 200;

export interface ClinicalRemindersSummary {
  picked: number;
  enqueued: number;
  skipped: number;
  errors: Array<{ id: string; reason: string }>;
}

/**
 * Procesa todos los ClinicalReminder con dueDate dentro de
 * [now, now + LOOKAHEAD_DAYS] y status = pending. Resuelve la plantilla
 * de WhatsApp por reminderType y encola un row WhatsAppReminder.
 */
export async function processClinicalReminders(opts?: {
  batchSize?: number;
  now?: Date;
}): Promise<ClinicalRemindersSummary> {
  const summary: ClinicalRemindersSummary = {
    picked: 0,
    enqueued: 0,
    skipped: 0,
    errors: [],
  };
  const now = opts?.now ?? new Date();
  const horizon = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 3600 * 1000);
  const limit = opts?.batchSize ?? BATCH_SIZE;

  const due = await prisma.clinicalReminder.findMany({
    where: {
      status: "pending",
      deletedAt: null,
      dueDate: { lte: horizon },
    },
    orderBy: { dueDate: "asc" },
    take: limit,
    include: {
      patient: {
        select: { firstName: true, phone: true, deletedAt: true },
      },
      clinic: { select: { id: true, name: true, waConnected: true } },
    },
  });

  summary.picked = due.length;

  for (const r of due) {
    try {
      if (!r.patient || r.patient.deletedAt) {
        summary.skipped++;
        continue;
      }
      if (!r.patient.phone) {
        summary.skipped++;
        continue;
      }
      if (!r.clinic.waConnected) {
        summary.skipped++;
        continue;
      }

      const tpl = resolveTemplate(r.reminderType);
      if (!tpl) {
        summary.skipped++;
        continue;
      }

      const message = `${tpl.prefix}${r.reminderType}::${r.id}`;

      const wa = await prisma.whatsAppReminder.create({
        data: {
          clinicId: r.clinic.id,
          patientPhone: r.patient.phone,
          message,
          type: "PED_REMINDER",
          status: "PENDING",
          scheduledFor: r.dueDate,
          payload: (r.payload as object | null) ?? undefined,
        },
        select: { id: true },
      });

      await prisma.clinicalReminder.update({
        where: { id: r.id },
        data: {
          status: "sent",
          triggeredAt: new Date(),
          whatsappReminderId: wa.id,
        },
      });

      summary.enqueued++;
    } catch (e) {
      summary.errors.push({ id: r.id, reason: (e as Error).message });
    }
  }

  return summary;
}

function resolveTemplate(reminderType: string): ClinicalReminderTemplate | null {
  if (reminderType in CLINICAL_REMINDER_TEMPLATES) {
    return CLINICAL_REMINDER_TEMPLATES[reminderType as keyof typeof CLINICAL_REMINDER_TEMPLATES];
  }
  return null;
}
