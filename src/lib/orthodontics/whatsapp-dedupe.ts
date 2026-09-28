// Ortodoncia — Paciente y WhatsApp (ws1-t2): candado de doble envío para
// sendMensualidadReminder/sendControlInstructions.
//
// Revisión cruzada (REPORTE-ws1-t1.md, «## Revisión cruzada», menor): el
// estado "enviado" de esos botones vive solo en memoria del cliente — un
// doble clic tras refrescar la página manda el mismo WhatsApp dos veces. Este
// archivo pregunta al LOG real de WhatsApp (InboxMessage) si ya salió un
// envío de ESE `kind` a ese teléfono en las últimas horas, antes de mandar
// otro.
//
// No usa `findThreadByPhone` (privada de inbox-log.ts): reutiliza
// `findWhatsAppThreadsForPhone`, que sí es pública, y el mismo formato de
// `externalId` que `buildSystemExternalId` — "sys:<kind>:<wamid|uuid>" — deja
// en cada mensaje de sistema (system-message.ts).

import { prisma } from "@/lib/prisma";
import { findWhatsAppThreadsForPhone } from "@/lib/whatsapp/inbox-log";
import { SYSTEM_EXTERNAL_ID_PREFIX, type WhatsAppSendKind } from "@/lib/whatsapp/system-message";

/**
 * ¿Ya se mandó un WhatsApp de este `kind` a este teléfono dentro de las
 * últimas `windowHours` horas? `null` = no (o no se pudo saber: no bloquea).
 * Devuelve cuándo fue, para el mensaje al staff.
 */
export async function lastSentOfKind(
  clinicId: string,
  phone: string,
  kind: WhatsAppSendKind,
  ahora: Date = new Date(),
  windowHours = 24,
): Promise<Date | null> {
  const threads = await findWhatsAppThreadsForPhone(clinicId, phone);
  if (threads.length === 0) return null;

  const desde = new Date(ahora.getTime() - windowHours * 60 * 60 * 1000);
  const ultimo = await prisma.inboxMessage.findFirst({
    where: {
      threadId: { in: threads.map((t) => t.id) },
      direction: "OUT",
      externalId: { startsWith: `${SYSTEM_EXTERNAL_ID_PREFIX}${kind}:` },
      sentAt: { gte: desde },
    },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  return ultimo?.sentAt ?? null;
}
