// ═══════════════════════════════════════════════════════════════════════════
// Adapter de Zendesk — STUB DOCUMENTADO (NO funcional aún).
//
// Cada método documenta abajo el endpoint REAL de Zendesk, el payload exacto
// y el mapeo de campos: implementar la integración es rellenar cada método
// siguiendo su propio doc-comment y conectar las llamadas en los puntos
// marcados "ZENDESK:" de src/lib/support/service.ts. Pasos de activación y
// alternativa Freshdesk en docs/SOPORTE_ZENDESK.md.
// Mientras tanto cada método lanza SupportError 501 — NO cambiar a funcional
// sin las envs configuradas.
//
// Diseño: src/lib/support/service.ts es la única capa que llamaría estos
// métodos (puntos marcados "ZENDESK:" allí). La dirección inversa
// (Zendesk → DaleControl, respuestas de agentes) entra por el webhook
// src/app/api/webhooks/zendesk/route.ts (hoy responde 501).
//
// Base URL:        https://{ZENDESK_SUBDOMAIN}.zendesk.com
// Autenticación:   HTTP Basic con API token en TODAS las llamadas salientes:
//                  Authorization: Basic base64("{ZENDESK_EMAIL}/token:{ZENDESK_API_TOKEN}")
// Envs previstas:  ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN
//                  (+ ZENDESK_WEBHOOK_SECRET para la firma del webhook de entrada).
// ═══════════════════════════════════════════════════════════════════════════

import { SupportError, type SupportAttachment } from "./types";

/** Forma del adapter externo. La implementa Zendesk hoy (stub) y podría
 *  implementarla Freshdesk mañana con la misma interfaz. */
export interface ExternalSupportAdapter {
  /**
   * Crea el ticket externo y devuelve su id; service.ts (createTicket, punto
   * "ZENDESK:") lo persiste en `SupportTicket.externalId`.
   *
   * Implementación real (Requests API):
   *   POST https://{ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/requests.json
   *   Body:
   *   {
   *     request: {
   *       subject: `[#DC-XXXX] ${subject}`,   // formatFolio(folio) + asunto
   *       comment: { body },                  // primer mensaje de la clínica
   *       requester: { name: clinicName, email: requesterEmail },
   *       priority,                           // BAJA→"low" · NORMAL→"normal" · ALTA→"high" · URGENTE→"urgent"
   *       custom_fields / tags                // folio y categoría (BUG/DUDA/FACTURACION/SUGERENCIA)
   *     }
   *   }
   *   Respuesta: { request: { id, ... } } → devolver String(request.id) como
   *   externalId (request.id es numérico; la columna es String?).
   *   Nota: `attachments` requiere paso previo POST /api/v2/uploads.json y
   *   pasar los tokens en comment.uploads (opcional, puede quedar fase 2).
   */
  createTicket(input: {
    folio: number;
    subject: string;
    body: string;
    clinicName: string;
    requesterEmail: string | null;
    category: string;
    priority: string;
    attachments?: SupportAttachment[];
  }): Promise<{ externalId: string }>;

  /**
   * Agrega un comentario al ticket externo (externalId de SupportTicket).
   *
   * Implementación real:
   *   PUT https://{ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/requests/{externalId}.json
   *   Body: { request: { comment: { body } } }
   *
   *   Para internalNote=true usar la Tickets API (la Requests API solo crea
   *   comentarios públicos):
   *   PUT /api/v2/tickets/{externalId}.json
   *   Body: { ticket: { comment: { body, public: false } } }
   */
  addMessage(externalId: string, input: {
    body: string;
    authorType: "clinic" | "support";
    internalNote?: boolean;
  }): Promise<void>;

  /**
   * Espeja un cambio de estado hacia el sistema externo (Tickets API):
   *   PUT https://{ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/{externalId}.json
   *   Body: { ticket: { status } } con el mapeo estados propios → Zendesk:
   *   ABIERTO → "open" · EN_PROGRESO → "open" · ESPERANDO_RESPUESTA → "pending"
   *   RESUELTO → "solved" · CERRADO → "closed"
   */
  changeStatus(externalId: string, status: string): Promise<void>;
}

/** ¿Está configurada la integración? (hoy siempre false → no se llama nada). */
export function isZendeskEnabled(): boolean {
  return Boolean(
    process.env.ZENDESK_SUBDOMAIN &&
      process.env.ZENDESK_EMAIL &&
      process.env.ZENDESK_API_TOKEN,
  );
}

export const zendeskAdapter: ExternalSupportAdapter = {
  async createTicket() {
    throw new SupportError("Integración Zendesk no habilitada", 501);
  },
  async addMessage() {
    throw new SupportError("Integración Zendesk no habilitada", 501);
  },
  async changeStatus() {
    throw new SupportError("Integración Zendesk no habilitada", 501);
  },
};
