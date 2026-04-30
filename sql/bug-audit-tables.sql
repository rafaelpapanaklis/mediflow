-- ═══════════════════════════════════════════════════════════════════
-- Bug Audit — tablas de runs y dismissed.
-- Idempotente. RLS habilitada. Aplicar via Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════

-- bug_audit_runs: cada ejecución del scanner deja un registro con el
-- summary agregado y el array completo de items. items es JSONB
-- (cada item incluye category, severity, file, line, title, description,
-- suggestion, code_snippet, fingerprint).
CREATE TABLE IF NOT EXISTS "bug_audit_runs" (
  "id"          TEXT PRIMARY KEY,
  "runAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "triggeredBy" TEXT NOT NULL,
  "duration_ms" INTEGER,
  "status"      TEXT NOT NULL,
  "summary"     JSONB NOT NULL,
  "items"       JSONB NOT NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "bug_audit_runs_runAt_idx" ON "bug_audit_runs"("runAt" DESC);

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

-- RLS: ambas tablas son globales (no multi-tenant — la auditoría es
-- de la plataforma entera). Solo SUPER_ADMIN puede leer/escribir, y
-- la lógica de quien-puede vive en el handler de /api/admin/bug-audit/*.
-- Aún así, habilitamos RLS para que cualquier consulta directa quede
-- bloqueada por default si alguien abre la DB con un cliente sin la
-- service role key.
ALTER TABLE "bug_audit_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bug_audit_dismissed" ENABLE ROW LEVEL SECURITY;

-- Policy explícita: deny-all para anon + authenticated. Solo service
-- role (que la API server usa) bypassa RLS.
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
