// Marcado de los mensajes de WhatsApp que DaleControl envía SOLO (recordatorios,
// invitaciones a reseña, recetas, avisos de sistema…) dentro del Inbox.
//
// Módulo PURO a propósito: lo importan tanto el servidor (send-and-log, webhook)
// como el cliente del Inbox (inbox-client.tsx) para pintar la etiqueta. No debe
// importar prisma, "server-only" ni nada de Node.
//
// El origen del envío viaja en `InboxMessage.externalId` con el formato
// `sys:<kind>:<wamid|uuid>`. Se eligió el externalId porque el schema NO tiene
// columna para el origen y esta tarea no agrega migraciones: el prefijo es
// estable, filtrable en SQL (LIKE 'sys:%') y ya viaja al cliente en el contrato
// actual de GET /api/inbox/threads/[id]/messages y /api/inbox/since.

/** Origen de un envío automático de WhatsApp (etiqueta, no texto libre). */
export type WhatsAppSendKind =
  | "reminder"            // recordatorio de cita (cola)
  | "review"              // invitación a reseña tras la cita
  | "prescription"        // receta enviada al paciente
  | "booking"             // confirmación/solicitud de cita
  | "appointment_change"  // resolución de un cambio de cita
  | "system"              // avisos de la plataforma (saldo IA, pagos…)
  | "manual_api";         // recordatorio disparado a mano desde el panel

export const WHATSAPP_SEND_KINDS: readonly WhatsAppSendKind[] = [
  "reminder",
  "review",
  "prescription",
  "booking",
  "appointment_change",
  "system",
  "manual_api",
];

/** Prefijo de `externalId` que marca un envío automático de la plataforma. */
export const SYSTEM_EXTERNAL_ID_PREFIX = "sys:";

/**
 * `sys:<kind>:<wamid>`. Sin wamid (Meta no lo devolvió) se usa un sufijo
 * aleatorio: `externalId` es @@unique([threadId, externalId]) y dos avisos del
 * mismo tipo en el mismo hilo chocarían con un sufijo fijo.
 */
export function buildSystemExternalId(kind: WhatsAppSendKind, wamid?: string | null): string {
  const suffix = wamid && wamid.length > 0 ? wamid : randomSuffix();
  return `${SYSTEM_EXTERNAL_ID_PREFIX}${kind}:${suffix}`;
}

/** Devuelve el `kind` de un envío automático, o null si el mensaje no lo es. */
export function parseSystemKind(externalId: string | null | undefined): WhatsAppSendKind | null {
  if (!externalId || !externalId.startsWith(SYSTEM_EXTERNAL_ID_PREFIX)) return null;
  const kind = externalId.slice(SYSTEM_EXTERNAL_ID_PREFIX.length).split(":")[0];
  return (WHATSAPP_SEND_KINDS as readonly string[]).includes(kind)
    ? (kind as WhatsAppSendKind)
    : null;
}

function randomSuffix(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback sin dependencias (runtimes sin webcrypto): suficiente para
  // desempatar dentro de un mismo hilo.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
