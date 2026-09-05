-- ═══════════════════════════════════════════════════════════════════
-- Asistente IA Clínico — historial en la BASE, por clínica y por persona
--   ai_conversations         ⇄ AiConversation
--   ai_conversation_messages ⇄ AiConversationMessage
-- (los dos al final de prisma/schema.prisma).
--
--     https://supabase.com/dashboard/project/_/sql/new
--
-- ⚠️  PENDIENTE DE APLICAR. Lo pega Rafael en el editor de Supabase ANTES de
--     integrar la rama a producción. Es ADITIVO e IDEMPOTENTE: re-correrlo es
--     un no-op. No toca ninguna tabla existente.
--
-- QUÉ ARREGLA: hasta hoy el historial del Asistente IA vivía SOLO en el
-- localStorage del navegador, bajo la clave global "mf:ai-conversations:v1",
-- sin usuario ni clínica. Eso fallaba en tres frentes:
--   1. No se veía desde otra máquina y se perdía al limpiar caché.
--   2. En un equipo compartido, quien abriera el panel veía las conversaciones
--      clínicas de otro; y al cambiar de sede quedaban visibles en la clínica
--      equivocada.
--   3. Notas clínicas que solo viven en un navegador no son conservables.
--
-- SIN ESTE SQL el panel NO se cae: /api/ai-assistant devuelve 503
-- storage_unavailable, la página pinta un aviso y el chat sigue funcionando —
-- lo que no hay es dónde guardarlo (fail-open, mismo criterio que addAiTokens).
--
-- Columnas en camelCase entrecomilladas: Prisma mapea el nombre del campo tal
-- cual (sin @map) → la columna DEBE llamarse igual. Ojo con "groupKey": el campo
-- se llama así, y no "group", justamente porque GROUP es palabra reservada de
-- SQL y una columna con ese nombre obliga a entrecomillar en todo DDL a mano.
--
-- Delimitadores $ac$ (NUNCA $$ pelado — el editor de Supabase rompe el parser
-- con $$ y no admite bloques DO anidados).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Conversaciones ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ai_conversations" (
  "id"        text         NOT NULL,
  "clinicId"  text         NOT NULL,
  "userId"    text         NOT NULL,
  "title"     text         NOT NULL,
  "groupKey"  text         NOT NULL DEFAULT 'clinico',
  -- id que la conversación tenía en localStorage cuando llegó por la migración
  -- de una sola vez. NULL en todo lo nacido ya en la base.
  "legacyId"  text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- 2) Turnos de la conversación ───────────────────────────────────────
--    clinicId/userId van DENORMALIZADOS aposta: son defensa en profundidad,
--    para que una lectura de mensajes pueda llevar el filtro de tenant sin
--    depender de que quien la escriba pase por la conversación.
CREATE TABLE IF NOT EXISTS "ai_conversation_messages" (
  "id"             text         NOT NULL,
  "conversationId" text         NOT NULL,
  "clinicId"       text         NOT NULL,
  "userId"         text         NOT NULL,
  "role"           text         NOT NULL,   -- 'user' | 'assistant'
  "content"        text         NOT NULL,
  "createdAt"      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_conversation_messages_pkey" PRIMARY KEY ("id")
);

-- 3) Índices ─────────────────────────────────────────────────────────
-- Listado de la barra lateral: las mías, de esta clínica, por actividad reciente.
CREATE INDEX IF NOT EXISTS "ai_conversations_clinicId_userId_updatedAt_idx"
  ON "ai_conversations" ("clinicId", "userId", "updatedAt");

-- Idempotencia de la migración desde localStorage. NULL no colisiona con NULL
-- en Postgres, así que las conversaciones nacidas en la base (legacyId NULL) no
-- se estorban entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS "ai_conversations_clinicId_userId_legacyId_key"
  ON "ai_conversations" ("clinicId", "userId", "legacyId");

-- Lectura de una conversación, en orden.
CREATE INDEX IF NOT EXISTS "ai_conversation_messages_conversationId_createdAt_idx"
  ON "ai_conversation_messages" ("conversationId", "createdAt");

-- Barridos por clínica (soporte, borrado, métricas) sin pasar por la conversación.
CREATE INDEX IF NOT EXISTS "ai_conversation_messages_clinicId_createdAt_idx"
  ON "ai_conversation_messages" ("clinicId", "createdAt");

-- 4) Llaves foráneas (idempotentes vía pg_constraint) ────────────────
--    Borrar la clínica se lleva su historial, igual que el resto del esquema.
--    Se declaran AQUÍ y no con @relation en Prisma: es el mismo patrón de la
--    familia Ai* del monedero (ai_wallets, ai_usage_events, ai_topups…), que
--    evita añadir back-relations al modelo Clinic.
DO $ac$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversations_clinicId_fkey'
  ) THEN
    ALTER TABLE "ai_conversations"
      ADD CONSTRAINT "ai_conversations_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla referenciada inexistente — FK saltada (deploy parcial)';
END
$ac$;

DO $ac$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversation_messages_clinicId_fkey'
  ) THEN
    ALTER TABLE "ai_conversation_messages"
      ADD CONSTRAINT "ai_conversation_messages_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla referenciada inexistente — FK saltada (deploy parcial)';
END
$ac$;

DO $ac$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversation_messages_conversationId_fkey'
  ) THEN
    ALTER TABLE "ai_conversation_messages"
      ADD CONSTRAINT "ai_conversation_messages_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla referenciada inexistente — FK saltada (deploy parcial)';
END
$ac$;

-- NOTA sobre "users": NO se pone FK de "userId" → "users"("id") a propósito.
-- Es el mismo criterio que ai_quota_usage."userId": una persona puede dejar la
-- clínica y su fila de users desactivarse o desaparecer, y el historial del
-- asistente no debe irse con ella ni bloquear la baja. El aislamiento efectivo
-- lo pone el where de cada query (src/lib/ai-assistant/conversations.ts), que
-- SIEMPRE lleva clinicId + userId.

-- 5) Defense-in-depth: RLS deny-all para anon y authenticated (patrón
--    sql/rls-deny-all-policies.sql). DaleControl accede solo vía Prisma +
--    service role (bypassa RLS); el navegador nunca toca estas tablas. Esto
--    cierra PostgREST si se filtrara el anon key — y aquí importa el doble,
--    porque lo que hay dentro son notas de apoyo clínico.
DO $ac$
BEGIN
  EXECUTE 'ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_conversations'
      AND policyname = 'ai_conversations_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "ai_conversations_deny_anon" ON "ai_conversations" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'ai_conversations no existe — RLS saltada';
END
$ac$;

DO $ac$
BEGIN
  EXECUTE 'ALTER TABLE "ai_conversation_messages" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_conversation_messages'
      AND policyname = 'ai_conversation_messages_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "ai_conversation_messages_deny_anon" ON "ai_conversation_messages" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'ai_conversation_messages no existe — RLS saltada';
END
$ac$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación:
--   SELECT "clinicId", "userId", COUNT(*) AS conversaciones
--     FROM "ai_conversations"
--    GROUP BY 1, 2 ORDER BY 3 DESC;
--
--   SELECT c."title", COUNT(m."id") AS turnos, c."updatedAt"
--     FROM "ai_conversations" c
--     LEFT JOIN "ai_conversation_messages" m ON m."conversationId" = c."id"
--    WHERE c."clinicId" = '<clinic_id>' AND c."userId" = '<user_id>'
--    GROUP BY c."id" ORDER BY c."updatedAt" DESC;
--
--   SELECT conname FROM pg_constraint
--    WHERE conname LIKE 'ai_conversation%';
--
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public' AND tablename LIKE 'ai_conversation%';
-- ═══════════════════════════════════════════════════════════════════
