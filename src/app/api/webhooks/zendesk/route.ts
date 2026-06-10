import { NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════════════════
// Webhook de Zendesk — STUB (501 mientras la integración esté apagada).
//
// Sentido del flujo: Zendesk → DaleControl. Espeja las respuestas de agentes
// de Zendesk como SupportMessage en el hilo propio. La dirección inversa
// (DaleControl → Zendesk) vive en src/lib/support/zendesk-adapter.ts.
//
// CONFIGURACIÓN EN ZENDESK (al activar — guía en docs/SOPORTE_ZENDESK.md):
// 1. Admin Center → Apps and integrations → Webhooks → crear un Webhook
//    apuntando a {baseUrl}/api/webhooks/zendesk (POST, formato JSON).
//    Guardar el signing secret que genera Zendesk → env ZENDESK_WEBHOOK_SECRET.
// 2. Crear un Trigger "Comment added by agent" (condiciones: comentario
//    público + autor es agente) cuya acción "Notify active webhook" lo
//    invoque con un body JSON:
//      {
//        "ticket_id": "{{ticket.id}}",
//        "comment_body": "{{ticket.latest_public_comment}}",
//        "comment_author": "{{ticket.latest_comment_author.name}}",
//        "ticket_status": "{{ticket.status}}"
//      }
//
// QUÉ DEBE HACER ESTE HANDLER cuando se active la integración:
// 1. Verificar la firma: headers X-Zendesk-Webhook-Signature y
//    X-Zendesk-Webhook-Signature-Timestamp. La firma es HMAC-SHA256 de
//    (timestamp + raw body) con el signing secret, codificada en base64;
//    comparar con crypto.timingSafeEqual y responder 401 si no coincide.
// 2. Buscar el SupportTicket por externalId = String(ticket_id). Si no
//    existe → 200 silencioso (ticket creado a mano en Zendesk, no espejado).
// 3. Crear el mensaje con authorType "support" vía addSupportMessage() de
//    src/lib/support/service.ts (authorName = comment_author). IMPORTANTE:
//    en este camino NO llamar a zendeskAdapter de vuelta — evitar el eco
//    webhook → adapter → trigger → webhook…
// 4. Responder 200 rápido (Zendesk reintenta los no-2xx y termina
//    desactivando webhooks que fallan persistentemente); cualquier trabajo
//    extra va después de persistir el mensaje.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { error: "Integración Zendesk no habilitada. Ver docs/SOPORTE_ZENDESK.md" },
    { status: 501 },
  );
}
