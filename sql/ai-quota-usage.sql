-- ═══════════════════════════════════════════════════════════════════
-- Desglose del cupo mensual de IA — tabla ai_quota_usage ⇄ AiQuotaUsage
-- (final de prisma/schema.prisma).
--
-- ⚠️  YA APLICADA EN SUPABASE (2026-07-27). Este archivo queda como rastro
--     del DDL: es ADITIVO e IDEMPOTENTE, así que re-correrlo es un no-op.
--     Hasta que exista la tabla, cualquier ruta que toque
--     prisma.aiQuotaUsage falla — pero el cobro de IA NO se cae: el insert
--     del desglose es fail-open dentro de addAiTokens() (@/lib/ai-tokens).
--
--     https://supabase.com/dashboard/project/_/sql/new
--
-- Una fila por cobro de tokens contra clinics."aiTokensUsed". Misma bolsa que
-- el cupo del plan, con detalle por feature (chat, xray_analysis, dictation,
-- consult_assist, contraindications, homeopathy, ai_insight,
-- no_show_prediction, clinic_layout, other).
--
-- NO confundir con ai_usage_events (sql/ai-billing.sql): ese es el monedero
-- prepago en MXN del bot de WhatsApp, otra bolsa distinta.
--
-- Columnas en camelCase entrecomilladas: Prisma mapea el nombre del campo tal
-- cual (sin @map) → la columna DEBE llamarse igual.
--
-- Delimitadores $aq$ (NUNCA $$ pelado — el editor de Supabase rompe el parser
-- con $$ y no admite bloques DO anidados).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Tabla ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ai_quota_usage" (
  "id"        text         NOT NULL,
  "clinicId"  text         NOT NULL,
  "feature"   text         NOT NULL,
  "tokens"    integer      NOT NULL,
  "userId"    text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_quota_usage_pkey" PRIMARY KEY ("id")
);

-- 2) Índice de consulta: desglose del mes en curso por clínica ───────
CREATE INDEX IF NOT EXISTS "ai_quota_usage_clinicId_createdAt_idx"
  ON "ai_quota_usage" ("clinicId", "createdAt");

-- 3) Llave foránea → clinics (idempotente vía pg_constraint) ─────────
DO $aq$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_quota_usage_clinicId_fkey'
  ) THEN
    ALTER TABLE "ai_quota_usage"
      ADD CONSTRAINT "ai_quota_usage_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla referenciada inexistente — FK saltada (deploy parcial)';
END
$aq$;

-- 4) Defense-in-depth: RLS deny-all para anon y authenticated (patrón
--    sql/rls-deny-all-policies.sql). MediFlow accede solo vía Prisma +
--    service role (bypassa RLS); el cliente nunca toca esta tabla. Esto
--    cierra PostgREST si se filtrara el anon key.
DO $aq$
BEGIN
  EXECUTE 'ALTER TABLE "ai_quota_usage" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_quota_usage'
      AND policyname = 'ai_quota_usage_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "ai_quota_usage_deny_anon" ON "ai_quota_usage" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'ai_quota_usage no existe — RLS saltada';
END
$aq$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación:
--   SELECT "feature", SUM("tokens") AS tokens
--     FROM "ai_quota_usage"
--    WHERE "clinicId" = '<clinic_id>'
--      AND "createdAt" >= date_trunc('month', now())
--    GROUP BY "feature" ORDER BY tokens DESC;
--
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'ai_quota_usage';
-- ═══════════════════════════════════════════════════════════════════
