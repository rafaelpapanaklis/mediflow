-- Tabla compartida con Git 1 (branch bug-audit-report). Idempotente con
-- IF NOT EXISTS para que el primero en correr cree la tabla y los demás
-- queden no-op. RLS habilitado: solo SUPER_ADMIN lee/escribe via la API.
--
-- summary.source distingue origen del run:
--   - 'extras' → este branch (webhooks, crons, AI, ARCO, a11y, etc.)
--   - 'main'   → branch bug-audit-report (lint, types, build, perf)

CREATE TABLE IF NOT EXISTS "bug_audit_runs" (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- clinicId del SUPER_ADMIN que ejecutó el run. NULL solo si el run fue
  -- programático (no debería pasar en la UI actual).
  "clinicId"  TEXT,
  -- userId del actor (super-admin). FK soft (no enforce a users.id por si
  -- el user se elimina luego del run).
  "userId"    TEXT,
  summary     JSONB NOT NULL,
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Duración total (ms) — útil para detectar scans que se ralentizan.
  "durationMs" INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "bug_audit_runs_createdAt_idx"
  ON "bug_audit_runs" ("createdAt" DESC);

CREATE INDEX IF NOT EXISTS "bug_audit_runs_clinicId_idx"
  ON "bug_audit_runs" ("clinicId");

-- RLS: solo SUPER_ADMIN. Los reads y writes pasan por endpoints
-- server-side que usan service-role, así que esta policy aplica al usuario
-- autenticado de Supabase Auth (defensa adicional contra cliente directo).
ALTER TABLE "bug_audit_runs" ENABLE ROW LEVEL SECURITY;

-- Policy idempotente: drop+create para garantizar consistencia.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bug_audit_runs'
      AND policyname = 'bug_audit_runs_super_admin_only'
  ) THEN
    DROP POLICY "bug_audit_runs_super_admin_only" ON "bug_audit_runs";
  END IF;
END $$;

CREATE POLICY "bug_audit_runs_super_admin_only" ON "bug_audit_runs"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users."supabaseId" = auth.uid()::text
        AND users.role = 'SUPER_ADMIN'
        AND users."isActive" = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users."supabaseId" = auth.uid()::text
        AND users.role = 'SUPER_ADMIN'
        AND users."isActive" = true
    )
  );
