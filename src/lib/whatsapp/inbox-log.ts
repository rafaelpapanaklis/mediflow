// Piezas COMPARTIDAS del registro de WhatsApp en el Inbox.
//
// Antes vivían duplicadas dentro de src/app/api/whatsapp/webhook/route.ts (una
// copia para los mensajes entrantes y otra para los echoes de coexistence).
// Ahora las consumen ese webhook y el helper de envíos automáticos
// (src/lib/whatsapp/send-and-log.ts), para que TODOS los mensajes de un mismo
// contacto caigan en el MISMO hilo con el mismo criterio.
//
// Multi-tenant: el clinicId siempre lo pasa el caller desde su contexto de
// servidor (sesión, cron o phone_number_id resuelto); nunca sale de un body.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { normalizeLast10 } from "@/lib/whatsapp/bot/booking-parse";

/**
 * Empareja al paciente por teléfono comparando los últimos 10 dígitos
 * NORMALIZADOS en ambos lados (no `contains` crudo, que da falsos positivos
 * cuando esos 10 dígitos aparecen como substring de otro número). El `contains`
 * solo pre-filtra en la BD; el match real lo hace normalizeLast10.
 */
export async function findPatientByWhatsAppPhone(
  clinicId: string,
  phone: string,
): Promise<{ id: string; phone: string | null } | null> {
  const last10 = normalizeLast10(phone);
  if (last10.length !== 10) return null;
  const candidates = await prisma.patient.findMany({
    where: { clinicId, phone: { contains: last10 } },
    select: { id: true, phone: true },
    take: 25,
  });
  return candidates.find((p) => normalizeLast10(p.phone ?? "") === last10) ?? null;
}

export interface WhatsAppThreadRef {
  id: string;
  botActive: boolean;
  botState: Prisma.JsonValue | null;
  patientId: string | null;
}

export interface UpsertWhatsAppThreadArgs {
  clinicId: string;
  /** externalId del hilo = teléfono del contacto (mismo criterio que el webhook). */
  externalId: string;
  now: Date;
  /** Asunto SOLO al crear; un hilo existente conserva el suyo. */
  createSubject: string;
  /** Estado SOLO al crear. */
  createStatus: "UNREAD" | "READ";
  /** Paciente ya resuelto; se vincula al crear y también si el hilo no lo tenía. */
  patientId?: string | null;
  /** true = el hilo pasa a UNREAD (llegó algo del paciente). */
  markUnread?: boolean;
  /** true = pausa el bot del hilo, al crear y al actualizar (un humano contesta). */
  pauseBot?: boolean;
  /**
   * true = si no hay match exacto de externalId, busca por los últimos 10
   * dígitos. Necesario en los ENVÍOS: el teléfono guardado del paciente casi
   * nunca viene con el mismo formato que el wa_id que manda Meta ("5512345678"
   * vs "5215512345678"), y sin esto cada aviso automático abriría un hilo nuevo.
   */
  matchByLast10?: boolean;
}

/**
 * Busca (o crea) el hilo de WhatsApp de un contacto y le actualiza
 * lastMessageAt. Reproduce el patrón del webhook tal cual: create con captura
 * de P2002 (carrera entre reintentos de Meta, @@unique [clinicId, channel,
 * externalId]) → re-findFirst, y vinculación perezosa del paciente.
 *
 * Devuelve el hilo TAL COMO ESTABA antes del update (igual que el webhook, que
 * lee botActive/botState del findFirst previo).
 */
export async function upsertWhatsAppThread(
  args: UpsertWhatsAppThreadArgs,
): Promise<WhatsAppThreadRef> {
  const { clinicId, externalId, now, patientId = null } = args;
  const select = { id: true, botActive: true, botState: true, patientId: true } as const;

  let thread = await prisma.inboxThread.findFirst({
    where: { clinicId, channel: "WHATSAPP", externalId },
    select,
  });

  // Fallback por últimos 10 dígitos (solo envíos): el hilo puede existir con el
  // wa_id de Meta, que no coincide carácter a carácter con el teléfono guardado.
  if (!thread && args.matchByLast10) {
    const last10 = normalizeLast10(externalId);
    if (last10.length === 10) {
      const candidates = await prisma.inboxThread.findMany({
        where: {
          clinicId,
          channel: "WHATSAPP",
          externalId: { contains: last10 },
        },
        orderBy: { lastMessageAt: "desc" },
        take: 10,
        select: { ...select, externalId: true },
      });
      // El `contains` solo pre-filtra: el match real es exacto por los 10
      // dígitos normalizados (nunca un hilo de otro número que los contenga).
      const match = candidates.find((t) => normalizeLast10(t.externalId ?? "") === last10);
      if (match) {
        thread = {
          id: match.id,
          botActive: match.botActive,
          botState: match.botState,
          patientId: match.patientId,
        };
      }
    }
  }

  if (!thread) {
    try {
      return await prisma.inboxThread.create({
        data: {
          clinicId,
          channel: "WHATSAPP",
          externalId,
          patientId,
          subject: args.createSubject,
          status: args.createStatus,
          lastMessageAt: now,
          ...(args.pauseBot ? { botActive: false } : {}),
        },
        select,
      });
    } catch (err) {
      // Carrera: otro request creó el hilo entre el findFirst y el create.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        thread = await prisma.inboxThread.findFirst({
          where: { clinicId, channel: "WHATSAPP", externalId },
          select,
        });
      }
      if (!thread) throw err;
      return thread;
    }
  }

  await prisma.inboxThread.update({
    where: { id: thread.id },
    data: {
      lastMessageAt: now,
      ...(args.markUnread ? { status: "UNREAD" as const } : {}),
      ...(args.pauseBot ? { botActive: false } : {}),
      // si identificamos al paciente y el hilo no lo tenía, lo vinculamos.
      ...(patientId && !thread.patientId ? { patientId } : {}),
    },
  });
  return thread;
}
