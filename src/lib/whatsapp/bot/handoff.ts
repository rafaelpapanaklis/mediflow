import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildSystemExternalId, SYSTEM_EXTERNAL_ID_PREFIX } from "@/lib/whatsapp/system-message";
import type { BotJson } from "./types";

/**
 * Derivar a una persona (#4 de la auditoría del bot, ws1-t5).
 *
 * Antes el handoff era MUDO y PERMANENTE: el paciente no recibía nada y el
 * hilo quedaba con `botActive=false` hasta que alguien lo reactivara a mano,
 * aunque la causa fuera un timeout de Claude o una clínica sin saldo.
 *
 * Ahora:
 *  - el paciente recibe UN aviso corto (lo pone el motor como `reply`);
 *  - el hilo queda pausado con una MARCA en `botState` ({ handoff: { at } });
 *  - el equipo ve en el Inbox una nota interna y la fila «Espera a una persona»;
 *  - si nadie del equipo contesta en 12 h, el siguiente mensaje del paciente
 *    reactiva el bot (`reactivarBotSiVencioHandoff`, lo llama el webhook);
 *  - si alguien del equipo contesta, la pausa ya es suya: solo la quita el
 *    interruptor del hilo (que además borra la marca).
 *
 * La marca vive en `InboxThread.botState` (Json que ya existe): sin SQL.
 */

export const HANDOFF_AVISO = "Te comunico con el equipo de la clínica, en breve te responden. 🙋";

export const HANDOFF_NOTA_INTERNA =
  "🙋 El bot pasó esta conversación a una persona del equipo: el paciente espera respuesta. " +
  "Si nadie le contesta en 12 horas, el bot vuelve a atenderlo.";

/** Decisión de Rafael (1-oct-2026): 12 horas sin respuesta del equipo. */
export const HANDOFF_REACTIVAR_MS = 12 * 60 * 60 * 1000;

export type MotivoHandoff = "modelo" | "sin_respuesta" | "agenda";

/** Lo que el motor guarda en botState al derivar. */
export function marcaDeHandoff(now: Date, motivo: MotivoHandoff): BotJson {
  return { handoff: { at: now.toISOString(), motivo } };
}

/** Fecha del handoff si el botState trae la marca; null si no. */
export function leerHandoff(botState: unknown): Date | null {
  if (!botState || typeof botState !== "object" || Array.isArray(botState)) return null;
  const h = (botState as Record<string, unknown>).handoff;
  if (!h || typeof h !== "object") return null;
  const at = (h as Record<string, unknown>).at;
  if (typeof at !== "string") return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * ¿Este mensaje es una respuesta de una PERSONA del equipo al paciente?
 * Notas internas no. OUT con usuario del panel sí. OUT sin usuario: es una
 * persona si viene del celular de la clínica (eco de coexistence, externalId
 * = wamid crudo); las respuestas del bot y los envíos automáticos llevan
 * externalId null o `sys:…`.
 */
export function esRespuestaDelEquipo(m: {
  direction: string;
  isInternal: boolean;
  sentById: string | null;
  externalId: string | null;
}): boolean {
  if (m.direction !== "OUT" || m.isInternal) return false;
  if (m.sentById) return true;
  return !!m.externalId && !m.externalId.startsWith(SYSTEM_EXTERNAL_ID_PREFIX);
}

/** Decisión pura: ¿se reactiva el bot? */
export function debeReactivar(args: {
  botActive: boolean;
  botState: unknown;
  now: Date;
  equipoContestoDespues: boolean;
}): boolean {
  if (args.botActive) return false;
  const at = leerHandoff(args.botState);
  if (!at) return false; // la pausa no la puso un handoff: la quitó/puso una persona
  if (args.now.getTime() - at.getTime() < HANDOFF_REACTIVAR_MS) return false;
  return !args.equipoContestoDespues;
}

/**
 * Lo llama el webhook con el hilo pausado. Devuelve true si la pausa era un
 * handoff del bot de hace ≥ 12 h sin respuesta del equipo: en ese caso YA dejó
 * el hilo con botActive=true y botState=null, y el webhook sigue al bot. Ante
 * cualquier error devuelve false (el hilo sigue pausado, como antes).
 */
export async function reactivarBotSiVencioHandoff(args: {
  clinicId: string;
  threadId: string;
  botState: unknown;
  now?: Date;
}): Promise<boolean> {
  const now = args.now ?? new Date();
  const at = leerHandoff(args.botState);
  if (!at || now.getTime() - at.getTime() < HANDOFF_REACTIVAR_MS) return false;
  if (!args.clinicId || !args.threadId) return false;
  try {
    const respuesta = await prisma.inboxMessage.findFirst({
      where: {
        threadId: args.threadId,
        thread: { clinicId: args.clinicId },
        direction: "OUT",
        isInternal: false,
        sentAt: { gt: at },
        OR: [
          { sentById: { not: null } },
          { AND: [{ externalId: { not: null } }, { NOT: { externalId: { startsWith: SYSTEM_EXTERNAL_ID_PREFIX } } }] },
        ],
      },
      select: { id: true },
    });
    if (!debeReactivar({ botActive: false, botState: args.botState, now, equipoContestoDespues: !!respuesta })) {
      return false;
    }
    // updateMany con la condición: si otra petición ya lo reactivó (o una
    // persona lo pausó a mano), no se pisa.
    const r = await prisma.inboxThread.updateMany({
      where: { id: args.threadId, clinicId: args.clinicId, botActive: false },
      data: { botActive: true, botState: Prisma.DbNull },
    });
    return r.count > 0;
  } catch (e) {
    console.error("[whatsapp/bot/handoff] no se pudo revisar la reactivación:", e);
    return false;
  }
}

/** Nota interna para el equipo. Best-effort: nunca rompe el webhook. */
export async function anotarHandoffEnInbox(args: { threadId: string }): Promise<void> {
  try {
    await prisma.inboxMessage.create({
      data: {
        threadId: args.threadId,
        direction: "OUT",
        body: HANDOFF_NOTA_INTERNA,
        isInternal: true,
        sentAt: new Date(),
        // `sys:` la saca del tope diario de respuestas del bot.
        externalId: buildSystemExternalId("system"),
      },
    });
  } catch (e) {
    console.error("[whatsapp/bot/handoff] no se pudo anotar el handoff:", e);
  }
}

/** ¿El hilo espera a una persona? (para la lista del Inbox) */
export function esperaPersona(thread: {
  botActive: boolean;
  botState: unknown;
  lastMessage?: { direction: string; isInternal?: boolean; sentById?: string | null; externalId?: string | null } | null;
}): boolean {
  if (thread.botActive || !leerHandoff(thread.botState)) return false;
  const m = thread.lastMessage;
  if (!m) return true;
  return !esRespuestaDelEquipo({
    direction: m.direction,
    isInternal: m.isInternal ?? false,
    sentById: m.sentById ?? null,
    externalId: m.externalId ?? null,
  });
}
