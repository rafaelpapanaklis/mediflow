import { prisma } from "@/lib/prisma";
import { getDentalLabContext } from "@/lib/lab-auth";
import { getAuthContext } from "@/lib/auth-context";
import type { DentalLabChatSender } from "@prisma/client";

// ═══════════════════════════════════════════════════════════════════════
// Acceso compartido del chat de laboratorios (server-only).
//
// El chat es bilateral y comparte endpoints entre clínica y laboratorio; el
// ROL SIEMPRE se resuelve desde la sesión, NUNCA desde el body/params del
// request (multi-tenant). NO importar desde componentes "use client": este
// módulo arrastra prisma + auth de servidor. Los tipos JSON viven en
// src/lib/laboratorios/types.ts (contrato compartido).
// ═══════════════════════════════════════════════════════════════════════

export type LabChatCaller =
  | { side: "CLINIC"; clinicId: string; senderId: string }
  | { side: "LAB"; labId: string; senderId: string };

/**
 * Resuelve la identidad del que llama. Orden: primero laboratorio
 * (getDentalLabContext) y, si no hay sesión de laboratorio, sesión de clínica
 * (getAuthContext). Devuelve null si no hay ninguna sesión válida.
 */
export async function resolveLabChatCaller(): Promise<LabChatCaller | null> {
  const lab = await getDentalLabContext();
  if (lab) {
    return { side: "LAB", labId: lab.labId, senderId: lab.labUserId };
  }
  const clinic = await getAuthContext();
  if (clinic) {
    return { side: "CLINIC", clinicId: clinic.clinicId, senderId: clinic.userId };
  }
  return null;
}

/**
 * Carga un hilo SOLO si pertenece al que llama (clínica → su clinicId,
 * laboratorio → su labId). Devuelve null si no existe o no es suyo, así
 * el caller responde 404 sin revelar la existencia de hilos ajenos.
 */
export async function loadOwnedThread(threadId: string, caller: LabChatCaller) {
  const thread = await prisma.dentalLabChatThread.findUnique({
    where: { id: threadId },
    select: { id: true, clinicId: true, labId: true },
  });
  if (!thread) return null;
  if (caller.side === "CLINIC" && thread.clinicId !== caller.clinicId) return null;
  if (caller.side === "LAB" && thread.labId !== caller.labId) return null;
  return thread;
}

// ── Include reutilizable: solo el último mensaje (preview de la bandeja). ──
export const lastMessageInclude = {
  take: 1,
  orderBy: { createdAt: "desc" as const },
  select: {
    id: true,
    threadId: true,
    sender: true,
    senderId: true,
    body: true,
    createdAt: true,
  },
} as const;

// ── Serializadores → forma JSON (superset del contrato de types.ts). El
//    hilo incluye el contraparte (lab para la clínica, clinic para el
//    laboratorio) para que cada lado pinte nombre/logo sin queries extra. ──

export function serializeMessage(m: {
  id: string;
  threadId: string;
  sender: DentalLabChatSender;
  senderId: string;
  body: string;
  createdAt: Date;
}) {
  return {
    id: m.id,
    threadId: m.threadId,
    sender: m.sender,
    senderId: m.senderId,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  };
}

export function serializeThread(t: any) {
  return {
    id: t.id,
    clinicId: t.clinicId,
    labId: t.labId,
    orderId: t.orderId ?? null,
    lastMessageAt: t.lastMessageAt.toISOString(),
    clinicUnread: t.clinicUnread,
    labUnread: t.labUnread,
    createdAt: t.createdAt.toISOString(),
    lab: t.lab
      ? { id: t.lab.id, name: t.lab.name, logoUrl: t.lab.logoUrl ?? null }
      : undefined,
    clinic: t.clinic
      ? { id: t.clinic.id, name: t.clinic.name, logoUrl: t.clinic.logoUrl ?? null }
      : undefined,
    messages: Array.isArray(t.messages) ? t.messages.map(serializeMessage) : undefined,
  };
}
