-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — ws1-t9 · «SERVICIOS AL AGENDAR» EN CONFIGURAR BOT.
--
-- Una columna nueva en "whatsapp_bot_configs" con las casillas de las tres
-- opciones genéricas del menú del bot al agendar (Consulta o valoración,
-- Limpieza, Urgencia o dolor). DEFAULT = las tres activas, que es lo que
-- hace el bot hoy. Sin UPDATE: Postgres llena las filas existentes con el
-- DEFAULT.
--
-- No se declara en prisma/schema.prisma a propósito (mismo motivo que
-- sql/ws1-t3-bot-precios.sql): el código la lee y escribe por SQL crudo y,
-- mientras esto no se pegue, da por activas las tres sin errores.
--
-- ORDEN: da igual. RLS: la tabla ya tiene RLS y su política deny_anon; la
-- columna nueva la hereda.
-- IDEMPOTENTE. CERO DROP, CERO UPDATE.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.whatsapp_bot_configs
  ADD COLUMN IF NOT EXISTS "botGenericas" JSONB NOT NULL
  DEFAULT '{"consulta": true, "limpieza": true, "urgencia": true}'::jsonb;

-- Comprobación 1 (solo lee): jsonb, NOT NULL, con su DEFAULT.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'whatsapp_bot_configs' AND column_name = 'botGenericas';

-- Comprobación 2 (solo lee): nadie quedó con algo apagado. Debe salir 0.
SELECT count(*) AS con_alguna_apagada
FROM public.whatsapp_bot_configs
WHERE NOT (("botGenericas"->>'consulta')::boolean AND ("botGenericas"->>'limpieza')::boolean AND ("botGenericas"->>'urgencia')::boolean);
