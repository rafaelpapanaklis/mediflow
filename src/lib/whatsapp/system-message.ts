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
  | "manual_api"          // recordatorio disparado a mano desde el panel
  | "payment_notice"      // aviso de saldo pendiente de una factura
  // ws1-t4 (8c) — PLANTILLAS del aviso de saldo según el estado de la nota: «pago por
  // realizar» (sin vencer) y «saldo vencido». Solo eligen la plantilla: el envío se
  // registra siempre como `payment_notice` (así lo cuenta el tope de un aviso al día).
  | "payment_due"
  | "payment_overdue"
  // ws1-t6 — «Enviar la factura» al crearla o desde su ficha: la NOTA (folio, monto y,
  // si se cobra por Mercado Pago, su link). Plantilla dc_factura_lista. Antes salía
  // como `payment_notice` y fuera de ventana el paciente recibía «Tienes un saldo pendiente».
  | "invoice_ready"
  | "quote_ready"         // presupuesto listo con su liga pública
  | "consent"             // carta de consentimiento informado para firmar
  // ws1-t3 fase 1 — link (o, desde fase 2, datos bancarios) del anticipo
  // pedido desde la cita o la factura. Desde fase 3 SÍ tiene spec
  // (dc_anticipo_cita en templates-catalog.ts), pero OPCIONAL: apagada por
  // defecto, la enciende la clínica en Configuración → Anticipos.
  | "deposit_request"
  // ws1-t3 fase 3 — «Enviar recibo»: confirma un pago YA recibido (cualquier
  // método, no solo anticipo). Plantilla dc_recibo_pago, también opcional.
  // Nunca automático: solo al pulsar el botón.
  | "payment_receipt";

export const WHATSAPP_SEND_KINDS: readonly WhatsAppSendKind[] = [
  "reminder",
  "review",
  "prescription",
  "booking",
  "appointment_change",
  "system",
  "manual_api",
  "payment_notice",
  "invoice_ready",
  "deposit_request",
  "payment_receipt",
  "quote_ready",
  "consent",
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

/**
 * ws1-t3 (auditoría del bot, #7) — prefijo de las RESPUESTAS DEL BOT. Antes se
 * guardaban con externalId null: el wamid se perdía y los estados de Meta
 * (entregado / leído / falló) nunca llegaban a ellas. `sys:bot:<wamid>`:
 *  · NO es un WhatsAppSendKind (no tiene plantilla ni etiqueta propia; el
 *    Inbox las sigue pintando con la etiqueta genérica, como antes);
 *  · empieza por `sys:`, así que nadie la confunde con una persona del equipo
 *    (bot/handoff.ts) ni con un eco del celular;
 *  · SÍ cuenta para el tope diario del bot (webhook: `BOT_REPLY_EXTERNAL_ID_PREFIX`).
 */
export const BOT_REPLY_EXTERNAL_ID_PREFIX = `${SYSTEM_EXTERNAL_ID_PREFIX}bot:`;

export function buildBotReplyExternalId(wamid?: string | null): string {
  const suffix = wamid && wamid.length > 0 ? wamid : randomSuffix();
  return `${BOT_REPLY_EXTERNAL_ID_PREFIX}${suffix}`;
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
