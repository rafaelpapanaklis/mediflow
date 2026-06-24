-- ═══════════════════════════════════════════════════════════════════════
-- Centro de notificaciones del paciente (portal) — WS1-T10 — 2026-06-23
-- ⚠️  PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase
--     ANTES del deploy. Prisma usa estas estructuras; sin ellas:
--       · el cron de recordatorios sigue funcionando (inserción in-app es
--         best-effort, se ignora si falta la tabla), y
--       · las páginas/endpoints del portal degradan a "sin notificaciones".
--     Aplicarlo activa el centro de notificaciones de verdad.
--
-- QUÉ
--   1. Tabla patient_notifications: historial de notificaciones del paciente
--      (recordatorios de cita, resoluciones de cambio de cita, mensajes).
--   2. Columna patient_accounts.notifPrefs (JSONB): preferencias de recordatorio
--      del paciente { channel, leadMinutes }. null = usar config de la clínica.
--
-- AISLAMIENTO POR CLÍNICA = Prisma-side (where patientId IN links de la sesión),
-- igual que el resto del portal. La RLS deny-all solo blinda la API REST de
-- Supabase (anon/authenticated); el service role (Prisma) la bypasea por diseño.
--
-- IDEMPOTENTE: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, FKs con guard
-- sobre pg_constraint, policy con guard sobre pg_policies. Re-ejecutable.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Tabla de notificaciones ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "patient_notifications" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "accountId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_notifications_pkey" PRIMARY KEY ("id")
);

-- Idempotencia del cron de recordatorios: 1 notificación por (paciente, cita+
-- momento). NULLs en dedupeKey son distintos en Postgres → los eventos únicos
-- (cambios de cita, mensajes) jamás colisionan. createMany skipDuplicates usa
-- este índice (ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS "patient_notifications_patientId_dedupeKey_key"
    ON "patient_notifications"("patientId", "dedupeKey");

-- Listado del portal: por paciente, recientes primero.
CREATE INDEX IF NOT EXISTS "patient_notifications_patientId_createdAt_idx"
    ON "patient_notifications"("patientId", "createdAt" DESC);

-- Conteo de no leídas (campana del shell).
CREATE INDEX IF NOT EXISTS "patient_notifications_accountId_readAt_idx"
    ON "patient_notifications"("accountId", "readAt");

-- FKs (ADD CONSTRAINT no soporta IF NOT EXISTS → guard sobre pg_constraint).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_notifications_clinicId_fkey') THEN
    ALTER TABLE "patient_notifications"
      ADD CONSTRAINT "patient_notifications_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_notifications_patientId_fkey') THEN
    ALTER TABLE "patient_notifications"
      ADD CONSTRAINT "patient_notifications_patientId_fkey"
      FOREIGN KEY ("patientId") REFERENCES "patients"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_notifications_accountId_fkey') THEN
    ALTER TABLE "patient_notifications"
      ADD CONSTRAINT "patient_notifications_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "patient_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. Preferencias de notificación en patient_accounts (JSONB nullable) ────
ALTER TABLE "patient_accounts" ADD COLUMN IF NOT EXISTS "notifPrefs" JSONB;

-- 3. RLS deny-all (mismo patrón que patient_credits / rls-deny-all-policies):
--    niega todo a anon/authenticated; el service role (Prisma) la sigue usando.
DO $$
DECLARE
  t    text;
  tbls text[] := ARRAY['patient_notifications'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = t
        AND policyname = t || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        t || '_deny_anon', t
      );
    END IF;
  END LOOP;
END $$;
