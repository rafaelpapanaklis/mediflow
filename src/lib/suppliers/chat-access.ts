import { prisma } from "@/lib/prisma";
import { getSupplierContext } from "@/lib/supplier-auth";
import { getAuthContext } from "@/lib/auth-context";
import type { SupplierChatSender } from "@prisma/client";

// ═══════════════════════════════════════════════════════════════════════
// Acceso compartido del chat de proveedores (server-only).
//
// El chat es bilateral y comparte endpoints entre clínica y proveedor; el
// ROL SIEMPRE se resuelve desde la sesión, NUNCA desde el body/params del
// request (multi-tenant). NO importar desde componentes "use client": este
// módulo arrastra prisma + auth de servidor. Los tipos JSON viven en
// src/lib/suppliers/types.ts (contrato compartido).
// ═══════════════════════════════════════════════════════════════════════

export type ChatCaller =
  | { side: "CLINIC"; clinicId: string; senderId: string }
  | { side: "SUPPLIER"; supplierId: string; senderId: string };

/**
 * Resuelve la identidad del que llama. Orden: primero proveedor
 * (getSupplierContext) y, si no hay sesión de proveedor, sesión de clínica
 * (getAuthContext). Devuelve null si no hay ninguna sesión válida.
 */
export async function resolveChatCaller(): Promise<ChatCaller | null> {
  const supplier = await getSupplierContext();
  if (supplier) {
    return { side: "SUPPLIER", supplierId: supplier.supplierId, senderId: supplier.supplierUserId };
  }
  const clinic = await getAuthContext();
  if (clinic) {
    return { side: "CLINIC", clinicId: clinic.clinicId, senderId: clinic.userId };
  }
  return null;
}

/**
 * Carga un hilo SOLO si pertenece al que llama (clínica → su clinicId,
 * proveedor → su supplierId). Devuelve null si no existe o no es suyo, así
 * el caller responde 404 sin revelar la existencia de hilos ajenos.
 */
export async function loadOwnedThread(threadId: string, caller: ChatCaller) {
  const thread = await prisma.supplierChatThread.findUnique({
    where: { id: threadId },
    select: { id: true, clinicId: true, supplierId: true },
  });
  if (!thread) return null;
  if (caller.side === "CLINIC" && thread.clinicId !== caller.clinicId) return null;
  if (caller.side === "SUPPLIER" && thread.supplierId !== caller.supplierId) return null;
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
//    hilo incluye el contraparte (supplier para la clínica, clinic para el
//    proveedor) para que cada lado pinte nombre/logo sin queries extra. ──

export function serializeMessage(m: {
  id: string;
  threadId: string;
  sender: SupplierChatSender;
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
    supplierId: t.supplierId,
    lastMessageAt: t.lastMessageAt.toISOString(),
    clinicUnread: t.clinicUnread,
    supplierUnread: t.supplierUnread,
    createdAt: t.createdAt.toISOString(),
    supplier: t.supplier
      ? { id: t.supplier.id, businessName: t.supplier.businessName, logoUrl: t.supplier.logoUrl ?? null }
      : undefined,
    clinic: t.clinic
      ? { id: t.clinic.id, name: t.clinic.name, logoUrl: t.clinic.logoUrl ?? null }
      : undefined,
    messages: Array.isArray(t.messages) ? t.messages.map(serializeMessage) : undefined,
  };
}
