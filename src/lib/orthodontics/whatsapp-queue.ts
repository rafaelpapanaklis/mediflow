// Orthodontics — helper que encola mensajes en whatsapp_reminders. SPEC §8.7.
//
// Patrón heredado de Endodoncia (treatment.ts:419-428):
//   db.whatsAppReminder.create({ data: {
//     clinicId, type: "ENDO" | "ORTHO" | …,
//     status: "PENDING", scheduledFor, message: <template_key>,
//   }})
//
// El campo `message` guarda el IDENTIFICADOR del template (no texto
// literal); el worker de WhatsApp (cuando corra) resuelve la plantilla.
// Para Orto los identificadores son `ORTHO_${OrthoWhatsAppTemplateKey}`.
//
// Idempotencia: usamos `findFirst` por clinicId + type + message +
// scheduledFor + patientPhone para evitar duplicados si el caller
// ejecuta el encolado dos veces.

import type { Prisma, PrismaClient } from "@prisma/client";
import { WA_REMINDER_STATUS } from "@/lib/whatsapp/reminder-status";
import type { OrthoWhatsAppTemplateKey } from "./whatsapp-templates";

type Db = PrismaClient | Prisma.TransactionClient;

export interface EnqueueOrthoWhatsAppInput {
  clinicId: string;
  templateKey: OrthoWhatsAppTemplateKey;
  scheduledFor: Date;
  patientPhone?: string | null;
  /**
   * Argumentos dinámicos del template (installmentNumber, fecha, amountMxn,
   * daysOverdue, pendingMxn…) — `queue-worker.ts` los lee de
   * `WhatsAppReminder.payload` y, sin ellos, cae a 0/"" (el bug de
   * "mensualidad #0 por $0", ws1-t2). Opcional: los templates sin argumentos
   * (APPOINTMENT_REMINDER_24H, PRE_INSTALLATION_INSTRUCTIONS) no lo necesitan.
   */
  payload?: Record<string, unknown>;
}

/**
 * Encola UN reminder. Idempotente: si ya existe uno equivalente para esa
 * clínica + template + fecha + teléfono, lo omite.
 */
// Ola 0 de ortodoncia (ws1-t1, sep-2026) — bloque S13, QUITAR: estos avisos
// salen con números en cero («mensualidad #0 por $0», ver
// recalculatePaymentStatus.ts) o duplican el recordatorio general de la
// Agenda (APPOINTMENT_REMINDER_24H, W1). Se apagan aquí, el único choke
// point que usan los 4 sitios que encolan (createControlAppointment,
// createTreatmentPlan, recalculatePaymentStatus, el cron diario) — nadie más
// tiene que cambiar. Ocultar, no borrar: en `false` la función no encola
// nada, pero se queda intacta por si Acceso/Cobro deciden revivirla ya
// arreglada. Ver bloque S, REPORTE-ws1-t1.md.
const ORTHO_WHATSAPP_ENQUEUE_ENABLED = false;

export async function enqueueOrthoWhatsApp(
  db: Db,
  input: EnqueueOrthoWhatsAppInput,
): Promise<{ enqueued: boolean; reminderId?: string }> {
  if (!ORTHO_WHATSAPP_ENQUEUE_ENABLED) return { enqueued: false };
  if (!input.patientPhone) {
    // Sin teléfono no tiene sentido encolar — el worker fallaría al enviar.
    return { enqueued: false };
  }

  const messageKey = `ORTHO_${input.templateKey}`;
  // Anti-dup: ventana de 1 minuto sobre scheduledFor.
  const windowStart = new Date(input.scheduledFor.getTime() - 60_000);
  const windowEnd = new Date(input.scheduledFor.getTime() + 60_000);

  const existing = await db.whatsAppReminder.findFirst({
    where: {
      clinicId: input.clinicId,
      type: "ORTHO",
      message: messageKey,
      patientPhone: input.patientPhone,
      scheduledFor: { gte: windowStart, lte: windowEnd },
    },
    select: { id: true },
  });
  if (existing) return { enqueued: false, reminderId: existing.id };

  const created = await db.whatsAppReminder.create({
    data: {
      clinicId: input.clinicId,
      type: "ORTHO",
      status: WA_REMINDER_STATUS.PENDING,
      scheduledFor: input.scheduledFor,
      message: messageKey,
      patientPhone: input.patientPhone,
      payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    select: { id: true },
  });
  return { enqueued: true, reminderId: created.id };
}

/**
 * Encola múltiples reminders en una sola transacción. Útil para
 * `createControlAppointment` que dispara hasta 3 (24h reminder +
 * MONTHLY_PROGRESS si milestone + MISSED si NO_SHOW).
 */
export async function enqueueOrthoWhatsAppBatch(
  db: Db,
  inputs: EnqueueOrthoWhatsAppInput[],
): Promise<number> {
  let count = 0;
  for (const input of inputs) {
    const result = await enqueueOrthoWhatsApp(db, input);
    if (result.enqueued) count++;
  }
  return count;
}
