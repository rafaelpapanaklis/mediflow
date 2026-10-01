-- ws1-t4 · auditoría de seguridad 30-sep-2026, M5 — «Ver como clínica» con sesión de suplantación propia.
--
-- Una fila por cada vez que un admin de plataforma entra como el dueño de una clínica.
-- La sesión de Supabase que se abre queda atada aquí por su session_id: dura 2 h y,
-- vencida o cerrada, el panel la trata como sin sesión aunque el navegador conserve
-- las cookies. Sin esta tabla, «Ver como clínica» contesta 503 y NO abre sesión.
--
-- Plano, idempotente y aditivo (sin bloques DO). No toca ninguna tabla existente.
-- La app entra como postgres (se salta RLS); el RLS cierra la tabla a la llave pública.

CREATE TABLE IF NOT EXISTS "admin_impersonation_sessions" (
  "id"                TEXT PRIMARY KEY,
  "adminUserId"       TEXT NOT NULL,
  "adminEmail"        TEXT NOT NULL,
  "clinicId"          TEXT NOT NULL,
  "targetUserId"      TEXT NOT NULL,
  "targetSupabaseId"  TEXT NOT NULL,
  "supabaseSessionId" TEXT NOT NULL,
  "nota"              TEXT NOT NULL,
  "ip"                TEXT,
  "userAgent"         TEXT,
  "startedAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expiresAt"         TIMESTAMPTZ NOT NULL,
  "endedAt"           TIMESTAMPTZ,
  "endedReason"       TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_impersonation_sessions_supabaseSessionId_key"
  ON "admin_impersonation_sessions" ("supabaseSessionId");

CREATE INDEX IF NOT EXISTS "admin_impersonation_sessions_clinicId_startedAt_idx"
  ON "admin_impersonation_sessions" ("clinicId", "startedAt" DESC);

ALTER TABLE "admin_impersonation_sessions" ENABLE ROW LEVEL SECURITY;

-- Sin políticas para anon/authenticated = nadie con la llave pública la lee ni la escribe.
REVOKE ALL ON TABLE "admin_impersonation_sessions" FROM anon, authenticated;

-- Bitácora de admin de plataforma para «Ver como clínica» (decisión A de Rafael, 1-oct):
-- lo que el admin hace dentro de la clínica va AQUÍ y no a audit_logs de la clínica.
CREATE TABLE IF NOT EXISTS "admin_impersonation_actions" (
  "id"              TEXT PRIMARY KEY,
  "impersonationId" TEXT NOT NULL,
  "adminUserId"     TEXT NOT NULL,
  "adminEmail"      TEXT NOT NULL,
  "clinicId"        TEXT NOT NULL,
  "entityType"      TEXT NOT NULL,
  "entityId"        TEXT NOT NULL,
  "action"          TEXT NOT NULL,
  "changes"         JSONB,
  "patientId"       TEXT,
  "ipAddress"       TEXT,
  "userAgent"       TEXT,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "admin_impersonation_actions_impersonationId_idx"
  ON "admin_impersonation_actions" ("impersonationId", "createdAt");

CREATE INDEX IF NOT EXISTS "admin_impersonation_actions_clinicId_createdAt_idx"
  ON "admin_impersonation_actions" ("clinicId", "createdAt" DESC);

ALTER TABLE "admin_impersonation_actions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "admin_impersonation_actions" FROM anon, authenticated;

-- Comprobación (deben salir 2 filas con rowsecurity = true):
-- SELECT tablename, rowsecurity FROM pg_tables
--  WHERE tablename IN ('admin_impersonation_sessions', 'admin_impersonation_actions');
