-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — ws1-t3 · EL BOT DE WHATSAPP PUEDE DAR PRECIOS.
--
-- Dos interruptores nuevos en «Configurar bot»: «Dar precios de
-- Procedimientos» y «Dar precios de Ortodoncia». APAGADOS en todas las
-- clínicas, nuevas y existentes: Postgres llena las columnas nuevas con su
-- DEFAULT false en todas las filas que ya existen. Sin UPDATE ni backfill.
--
-- Contenido: DOS columnas nuevas en "whatsapp_bot_configs":
--   "canQuoteProcedurePrices" BOOLEAN NOT NULL DEFAULT false
--   "canQuoteOrthoPrices"     BOOLEAN NOT NULL DEFAULT false
--
-- No se declaran en prisma/schema.prisma a propósito (ver
-- src/lib/whatsapp/bot/precios-bot.ts): el código las lee y escribe por SQL
-- crudo y, mientras esto no se pegue, las da por APAGADAS sin errores.
--
-- ORDEN: da igual. El código de hoy no las conoce y sigue igual con ellas
-- puestas; el código nuevo funciona sin ellas (interruptores apagados y
-- deshabilitados en la pantalla, con el aviso «Todavía no está activo»).
--
-- RLS: "whatsapp_bot_configs" ya tiene RLS encendido y la política
-- RESTRICTIVE "whatsapp_bot_configs_deny_anon" (sql/whatsapp-bot.sql). Una
-- columna nueva hereda la política de su tabla: no hace falta otra. La
-- consulta 2 de abajo lo comprueba.
--
-- IDEMPOTENTE: correrlo varias veces no da errores ni cambia nada. CERO DROP,
-- CERO UPDATE.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.whatsapp_bot_configs
  ADD COLUMN IF NOT EXISTS "canQuoteProcedurePrices" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.whatsapp_bot_configs
  ADD COLUMN IF NOT EXISTS "canQuoteOrthoPrices" BOOLEAN NOT NULL DEFAULT false;

-- Comprobación 1 (solo lee): las dos columnas, boolean, NOT NULL, DEFAULT false.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'whatsapp_bot_configs'
  AND column_name IN ('canQuoteProcedurePrices', 'canQuoteOrthoPrices');

-- Comprobación 2 (solo lee): RLS encendido y la política deny_anon presente.
-- Debe salir rls = true y una fila con la política.
SELECT c.relrowsecurity AS rls, p.policyname, p.permissive, p.roles
FROM pg_class c
LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
WHERE c.relname = 'whatsapp_bot_configs' AND c.relnamespace = 'public'::regnamespace;

-- Comprobación 3 (solo lee): nadie quedó encendido. Debe salir 0 y 0.
SELECT
  count(*) FILTER (WHERE "canQuoteProcedurePrices") AS procedimientos_encendidos,
  count(*) FILTER (WHERE "canQuoteOrthoPrices")     AS ortodoncia_encendidos
FROM public.whatsapp_bot_configs;
