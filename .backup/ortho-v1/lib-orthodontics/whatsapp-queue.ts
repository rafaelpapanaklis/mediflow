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
import type { OrthoWhatsAppTemplateKey } from "./whatsapp-templates";

type Db = PrismaClient | Prisma.TransactionClient;

export interface EnqueueOrthoWhatsAppInput {
  clinicId: string;
  templateKey: OrthoWhatsAppTemplateKey;
  scheduledFor: Date;
  patientPhone?: string | null;
}

/**
 * Encola UN reminder. Idempotente: si ya existe uno equivalente para esa
 * clínica + template + fecha + teléfono, lo omite.
 */
export async function enqueueOrthoWhatsApp(
  db: Db,
  input: EnqueueOrthoWhatsAppInput,
): Promise<{ enqueued: boolean; reminderId?: string }> {
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
      status: "PENDING",
      scheduledFor: input.scheduledFor,
      message: messageKey,
      patientPhone: input.patientPhone,
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
