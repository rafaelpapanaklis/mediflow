-- ═══════════════════════════════════════════════════════════════════
-- Bot de WhatsApp configurable — fundación (T1)
--
-- ⚠️  CORRER EN SUPABASE (SQL Editor) ANTES / AL MOMENTO DEL DEPLOY.
--     Agrega inbox_threads."botActive" / "botState" y las tablas
--     whatsapp_bot_configs / whatsapp_bot_faqs, que Prisma incluye en sus
--     SELECT. Si NO se corre, el webhook de WhatsApp y el Inbox responden
--     500 (mismo problema que pasó con CRM / afiliados).
--     Ver MEMORY: lesson_ortho_schema_drift.
--
--     https://supabase.com/dashboard/project/_/sql/new
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica datos.
-- Espeja prisma/schema.prisma (models WhatsAppBotConfig, WhatsAppBotFaq y los
-- campos InboxThread.botActive / botState).
--
-- Nota sobre $$: un único delimitador `$wabot$`, sin bloques DO anidados
-- (el parser SQL de Supabase rompe con $$ anidado).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Tabla whatsapp_bot_configs (1:1 con clinics)
CREATE TABLE IF NOT EXISTS "whatsapp_bot_configs" (
  "id"                  text         NOT NULL,
  "clinicId"            text         NOT NULL,
  "enabled"             boolean      NOT NULL DEFAULT false,
  "botName"             text         NOT NULL DEFAULT 'Asistente',
  "persona"             text,
  "greeting"            text,
  "businessHours"       jsonb,
  "afterHoursMsg"       text,
  "canAnswerFaq"        boolean      NOT NULL DEFAULT true,
  "canBookAppointments" boolean      NOT NULL DEFAULT false,
  "fallbackToHuman"     boolean      NOT NULL DEFAULT true,
  "createdAt"           timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_bot_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_bot_configs_clinicId_key"
  ON "whatsapp_bot_configs" ("clinicId");

-- FK whatsapp_bot_configs.clinicId → clinics.id (idempotente)
DO $wabot$ BEGIN
  ALTER TABLE "whatsapp_bot_configs"
    ADD CONSTRAINT "whatsapp_bot_configs_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $wabot$;

-- 2) Tabla whatsapp_bot_faqs (N:1 con whatsapp_bot_configs)
CREATE TABLE IF NOT EXISTS "whatsapp_bot_faqs" (
  "id"        text         NOT NULL,
  "clinicId"  text         NOT NULL,
  "configId"  text         NOT NULL,
  "question"  text         NOT NULL,
  "answer"    text         NOT NULL,
  "enabled"   boolean      NOT NULL DEFAULT true,
  "order"     integer      NOT NULL DEFAULT 0,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_bot_faqs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_bot_faqs_clinicId_idx"
  ON "whatsapp_bot_faqs" ("clinicId");
CREATE INDEX IF NOT EXISTS "whatsapp_bot_faqs_configId_enabled_order_idx"
  ON "whatsapp_bot_faqs" ("configId", "enabled", "order");

-- FK whatsapp_bot_faqs.configId → whatsapp_bot_configs.id (idempotente)
DO $wabot$ BEGIN
  ALTER TABLE "whatsapp_bot_faqs"
    ADD CONSTRAINT "whatsapp_bot_faqs_configId_fkey"
    FOREIGN KEY ("configId") REFERENCES "whatsapp_bot_configs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $wabot$;

-- 3) Columnas nuevas en inbox_threads (control del bot por hilo)
ALTER TABLE "inbox_threads" ADD COLUMN IF NOT EXISTS "botActive" boolean NOT NULL DEFAULT true;
ALTER TABLE "inbox_threads" ADD COLUMN IF NOT EXISTS "botState"  jsonb;

-- 4) RLS deny-all en las 2 tablas nuevas (defense-in-depth). Prisma usa el
--    service role y bypassa RLS; el cliente nunca toca estas tablas.
--    Sigue sql/rls-deny-all-policies.sql.
DO $wabot$ BEGIN
  ALTER TABLE "whatsapp_bot_configs" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'whatsapp_bot_configs'
      AND policyname = 'whatsapp_bot_configs_deny_anon'
  ) THEN
    CREATE POLICY "whatsapp_bot_configs_deny_anon" ON "whatsapp_bot_configs"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $wabot$;

DO $wabot$ BEGIN
  ALTER TABLE "whatsapp_bot_faqs" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'whatsapp_bot_faqs'
      AND policyname = 'whatsapp_bot_faqs_deny_anon'
  ) THEN
    CREATE POLICY "whatsapp_bot_faqs_deny_anon" ON "whatsapp_bot_faqs"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $wabot$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación:
--   SELECT "clinicId","enabled","canBookAppointments" FROM "whatsapp_bot_configs";
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'inbox_threads' AND column_name IN ('botActive','botState');
-- ═══════════════════════════════════════════════════════════════════
