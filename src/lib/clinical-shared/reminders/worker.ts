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
 * de WhatsApp por reminderType (o payload.subtype si reminderType=other)
 * y encola un row WhatsAppReminder con el type derivado del prefijo.
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
      patient: { select: { firstName: true, phone: true, deletedAt: true } },
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

      // El reminderType viene del enum SQL pero el sub-tipo puede vivir
      // en payload.subtype para los casos `other`.
      const lookupKey = resolveLookupKey(r);
      const tpl = resolveTemplate(lookupKey);
      if (!tpl) {
        summary.skipped++;
        continue;
      }

      const message = `${tpl.prefix}${lookupKey}::${r.id}`;

      const wa = await prisma.whatsAppReminder.create({
        data: {
          clinicId: r.clinic.id,
          patientPhone: r.patient.phone,
          message,
          type: tpl.prefix.replace(/_$/, ""),
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

function resolveLookupKey(r: {
  reminderType: string;
  payload: unknown;
}): string {
  if (r.reminderType !== "other") return r.reminderType;
  if (r.payload && typeof r.payload === "object") {
    const sub = (r.payload as Record<string, unknown>).subtype;
    if (typeof sub === "string") return sub;
  }
  return r.reminderType;
}

function resolveTemplate(key: string): ClinicalReminderTemplate | null {
  if (key in CLINICAL_REMINDER_TEMPLATES) {
    return CLINICAL_REMINDER_TEMPLATES[key as keyof typeof CLINICAL_REMINDER_TEMPLATES];
  }
  return null;
}
