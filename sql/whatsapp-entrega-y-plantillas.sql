-- WhatsApp: estado de entrega REAL + plantillas aprobadas por clínica.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).
-- Aplicar en Supabase (SQL Editor) ANTES de desplegar el código que lo usa:
-- el schema de Prisma ya declara estas columnas y un findMany sin `select`
-- revienta contra una tabla que todavía no las tiene.
--
-- Modelo Prisma: InboxMessage -> tabla "inbox_messages"; Clinic -> "clinics".
-- Campos sin @map => columnas camelCase (con comillas dobles obligatorias).

-- ════════════════════════════════════════════════════════════════════════════
-- A) Entrega real de cada mensaje del Inbox  (M-06, M-10)
--
-- Hasta hoy el Inbox pintaba la doble palomita a partir de "el POST no lanzó",
-- que solo significa que Meta ACEPTÓ el mensaje. La entrega de verdad llega
-- después, por el webhook, en `entry[].changes[].value.statuses[]`.
--
--   deliveryStatus : SENT | DELIVERED | READ | FAILED   (NULL = Meta no ha
--                    reportado nada todavía; NO es lo mismo que "no llegó")
--   deliveredAt    : sello del status `delivered`
--   readAt         : sello del status `read`
--   errorCode      : código NUMÉRICO real de Meta (131047, 190, 131042…). Se
--                    guarda aparte del texto porque el mensaje de Meta cambia
--                    de redacción y de idioma, pero el código no.
--   errorTitle     : errors[0].title tal cual lo manda Meta (para diagnóstico).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE "inbox_messages" ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT;
ALTER TABLE "inbox_messages" ADD COLUMN IF NOT EXISTS "deliveredAt"    TIMESTAMPTZ(3);
ALTER TABLE "inbox_messages" ADD COLUMN IF NOT EXISTS "readAt"         TIMESTAMPTZ(3);
ALTER TABLE "inbox_messages" ADD COLUMN IF NOT EXISTS "errorCode"      INTEGER;
ALTER TABLE "inbox_messages" ADD COLUMN IF NOT EXISTS "errorTitle"     TEXT;

-- Un status de Meta trae el wamid y NADA más: el mensaje se localiza SOLO por
-- "externalId". El @@unique([threadId, externalId]) que ya existe no sirve
-- para esta búsqueda (su columna guía es threadId), así que sin este índice
-- cada status haría un seq scan de toda la tabla de mensajes.
CREATE INDEX IF NOT EXISTS "inbox_messages_externalId_idx"
  ON "inbox_messages" ("externalId");

-- ════════════════════════════════════════════════════════════════════════════
-- B) Plantillas y facturación de la WABA de cada clínica  (M-09, el P0)
--
--   waTemplates : mapa tipo de mensaje -> plantilla aprobada de ESA clínica.
--                 { "reminder":           { "name": "recordatorio_cita",  "lang": "es_MX" },
--                   "booking":            { "name": "confirmacion_cita",  "lang": "es_MX" },
--                   "appointment_change": { "name": "reagendado_cita",    "lang": "es_MX" } }
--                 La clave es un WhatsAppSendKind (src/lib/whatsapp/system-message.ts).
--                 NULL / {} = la clínica no ha configurado ninguna: fuera de la
--                 ventana de 24 h no se envía nada (y se dice por qué), en vez
--                 de mandar texto libre que Meta rechaza en silencio.
--
--   waBillingOk : la WABA de la clínica tiene método de pago válido. Meta le
--                 cobra a ELLA cada plantilla, no a DaleControl. Arranca en
--                 false (= sin confirmar); se pone true cuando una plantilla
--                 sale bien y vuelve a false cuando Meta responde 131042.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "waTemplates" JSONB;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "waBillingOk" BOOLEAN NOT NULL DEFAULT false;
