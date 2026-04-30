-- ═══════════════════════════════════════════════════════════════════
-- Bug Audit — tablas unificadas de runs y dismissed.
-- Idempotente con IF NOT EXISTS. RLS habilitada (solo SUPER_ADMIN).
-- Aplicar via Supabase SQL editor.
--
-- Esta tabla unifica el schema de `bug-audit-report` (Git 1, columnas
-- runAt/triggeredBy/status/duration_ms) con el de `bug-audit-extras`
-- (Git 2, columnas createdAt/clinicId/userId/durationMs/items default).
-- Estilo camelCase consistente con el resto del schema Prisma.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "bug_audit_runs" (
  "id"          TEXT PRIMARY KEY,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- clinicId del SUPER_ADMIN que disparó el run. NULL para runs
  -- programáticos (no debería pasar en la UI actual).
  "clinicId"    TEXT,
  -- userId del actor (FK suave; no enforce a users.id por si se
  -- elimina al usuario después del run).
  "userId"      TEXT,
  "runAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "triggeredBy" TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'completed',
  "durationMs"  INTEGER NOT NULL DEFAULT 0,
  "summary"     JSONB NOT NULL,
  "items"       JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS "bug_audit_runs_runAt_idx"     ON "bug_audit_runs"("runAt"     DESC);
CREATE INDEX IF NOT EXISTS "bug_audit_runs_createdAt_idx" ON "bug_audit_runs"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "bug_audit_runs_clinicId_idx"  ON "bug_audit_runs"("clinicId");

-- bug_audit_dismissed: items marcados como falso positivo. fingerprint
-- es un hash estable del item (category + file + line + title) — si
-- vuelve a aparecer en runs futuros, lo filtramos del UI.
CREATE TABLE IF NOT EXISTS "bug_audit_dismissed" (
  "id"           TEXT PRIMARY KEY,
  "fingerprint"  TEXT NOT NULL UNIQUE,
  "reason"       TEXT,
  "dismissedBy"  TEXT NOT NULL,
  "dismissedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: ambas tablas son globales (la auditoría es de la plataforma
-- entera; clinicId/userId solo registran al actor). Solo SUPER_ADMIN
-- puede leer/escribir, vía endpoints server-side. Habilitamos RLS
-- como defensa en profundidad: si alguien abre la DB con un cliente
-- sin service-role, queda bloqueado por default.
ALTER TABLE "bug_audit_runs"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bug_audit_dismissed" ENABLE ROW LEVEL SECURITY;

-- Policy idempotente: deny-all para anon + authenticated (solo el
-- service-role bypassa RLS, que es el que usan los endpoints server).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='bug_audit_runs' AND policyname='bug_audit_runs_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "bug_audit_runs_deny_anon" ON "bug_audit_runs" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='bug_audit_dismissed' AND policyname='bug_audit_dismissed_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "bug_audit_dismissed_deny_anon" ON "bug_audit_dismissed" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
END $$;
