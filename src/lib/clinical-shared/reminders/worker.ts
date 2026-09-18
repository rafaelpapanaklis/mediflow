// Clinical-shared — worker que procesa los ClinicalReminder próximos a
// vencer y los encola en WhatsAppReminder con la plantilla apropiada.
//
// Llamado por el cron diario /api/cron/clinical-reminders (06:00 MX).
// Solo encola los que tienen `dueDate <= now + LOOKAHEAD_DAYS` y
// `status = pending`. Los marca como `sent` (status WhatsAppReminder se
// gestiona por el queue-worker).

import { prisma } from "@/lib/prisma";
import { WA_REMINDER_STATUS } from "@/lib/whatsapp/reminder-status";
import {
  ENQUEUEABLE_TYPES,
  oldestEnqueueableDueDate,
  planClinicalReminder,
} from "./plan";

const LOOKAHEAD_DAYS = 7;
const BATCH_SIZE = 200;

export interface ClinicalRemindersSummary {
  picked: number;
  enqueued: number;
  skipped: number;
  /**
   * Pendientes ya exigibles que este encolador NO va a tocar: tipos sin
   * plantilla renderizable y atrasos de más de MAX_OVERDUE_DAYS. Antes esto no
   * se veía en ningún sitio, y por eso el cron pasó meses sin encolar nada.
   */
  unsupported: number;
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
    unsupported: 0,
    errors: [],
  };
  const now = opts?.now ?? new Date();
  const oldest = oldestEnqueueableDueDate(now);
  const horizon = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 3600 * 1000);
  const limit = opts?.batchSize ?? BATCH_SIZE;

  const due = await prisma.clinicalReminder.findMany({
    where: {
      status: "pending",
      deletedAt: null,
      // Solo lo que se puede encolar de verdad (ver plan.ts). Lo demás no se
      // lee: una fila que se salta sin cambiar de estado volvería a salir la
      // primera cada día y acabaría taponando el lote.
      reminderType: { in: [...ENQUEUEABLE_TYPES] },
      dueDate: { gte: oldest, lte: horizon },
      clinic: { waConnected: true },
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

      const plan = planClinicalReminder(r);
      if (plan.action === "skip") {
        summary.skipped++;
        continue;
      }

      // Atómico: sin transacción, un crash entre create y update dejaría el
      // ClinicalReminder en pending con el WhatsAppReminder ya creado →
      // se encolaría OTRO mensaje en la corrida del día siguiente.
      await prisma.$transaction(async (tx) => {
        const wa = await tx.whatsAppReminder.create({
          data: {
            clinicId: r.clinic.id,
            patientPhone: r.patient.phone,
            message: plan.message,
            type: plan.type,
            status: WA_REMINDER_STATUS.PENDING,
            scheduledFor: r.dueDate,
            payload: { ...plan.payload, sourceClinicalReminderId: r.id },
          },
          select: { id: true },
        });

        await tx.clinicalReminder.update({
          where: { id: r.id },
          data: {
            status: "sent",
            triggeredAt: new Date(),
            whatsappReminderId: wa.id,
          },
        });
      });

      summary.enqueued++;
    } catch (e) {
      summary.errors.push({ id: r.id, reason: (e as Error).message });
    }
  }

  // Lo que se queda fuera, contado y a la vista en el log de Vercel.
  summary.unsupported = await prisma.clinicalReminder.count({
    where: {
      status: "pending",
      deletedAt: null,
      dueDate: { lte: horizon },
      OR: [
        { reminderType: { notIn: [...ENQUEUEABLE_TYPES] } },
        { dueDate: { lt: oldest } },
      ],
    },
  });
  if (summary.unsupported > 0) {
    console.warn(
      `[clinical-reminders] ${summary.unsupported} recordatorios pendientes NO se encolan ` +
        "(tipo sin plantilla en la cola, o vencidos hace más de 7 días)",
    );
  }

  return summary;
}
