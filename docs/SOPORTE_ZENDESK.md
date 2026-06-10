# Soporte Técnico → integración Zendesk (pendiente de activar)

## Qué hay hoy

El soporte funciona 100% con el sistema propio: `src/lib/support/service.ts` + Prisma
(modelos `SupportTicket` / `SupportMessage` en `prisma/schema.prisma`). Zendesk está
preparado pero apagado:

- `SupportTicket.externalId` — campo reservado para el id del ticket en Zendesk.
- `src/lib/support/zendesk-adapter.ts` — stub con la interfaz `ExternalSupportAdapter`;
  cada método lanza 501 y su doc-comment ya trae el endpoint y payload exactos.
- `src/app/api/webhooks/zendesk/route.ts` — webhook de entrada, responde 501.
- Los puntos de conexión en `service.ts` están marcados con comentarios `ZENDESK:`.

## Pasos para activar

1. **Cuenta Zendesk** — crea una en zendesk.com; el plan Support Team basta.
2. **API token** — Admin Center → Apps and integrations → Zendesk API → habilita
   *Token access* y genera un token.
3. **Envs en Vercel**:
   - `ZENDESK_SUBDOMAIN` (ej. `dalecontrol` si la URL es dalecontrol.zendesk.com)
   - `ZENDESK_EMAIL` (email del admin dueño del token)
   - `ZENDESK_API_TOKEN`
4. **Webhook + Trigger**:
   - Admin Center → Apps and integrations → Webhooks → crea uno apuntando a
     `{baseUrl}/api/webhooks/zendesk` (POST, JSON). Guarda el **signing secret**
     que genera Zendesk como env `ZENDESK_WEBHOOK_SECRET`.
   - Crea un Trigger "Comment added by agent" (comentario público + autor agente)
     que invoque ese webhook con el JSON
     `{ "ticket_id", "comment_body", "comment_author", "ticket_status" }`
     (placeholders exactos en el comentario de `route.ts`).
5. **Código** — implementa los 3 métodos de `zendesk-adapter.ts` (cada doc-comment
   ya dice endpoint, payload y mapeos de prioridad/estado) y conecta las llamadas
   en los puntos `ZENDESK:` de `service.ts`. En el webhook: verifica la firma
   HMAC-SHA256, busca el ticket por `externalId`, crea el mensaje vía
   `addSupportMessage` (sin volver a llamar a Zendesk — evita el eco) y responde 200.
6. **Prueba end-to-end** — crea un ticket desde el panel → verifica `externalId`
   guardado en `support_tickets` → responde en Zendesk como agente → el mensaje
   debe aparecer en el hilo del ticket en DaleControl.

## Alternativa: Freshdesk

Misma interfaz `ExternalSupportAdapter` y mismos puntos de conexión `ZENDESK:` en
`service.ts`; solo cambian los endpoints: `POST https://{dominio}.freshdesk.com/api/v2/tickets`
con auth Basic usando el API key como usuario y `X` como contraseña. Decisión
pendiente de pricing.
