-- ws6-t1 · 16-nov-2026 — «Ver como barbería» desde /admin/barberias (el «Ver como clínica» del dental).
--
-- Una fila por cada vez que un admin de plataforma entra al panel /barber como el dueño de una
-- barbería. La sesión de Supabase que se abre queda atada aquí por su session_id: dura 2 h (igual
-- que el dental) y, vencida o cerrada, el panel /barber la trata como SIN sesión aunque el
-- navegador conserve las cookies. Sin esta tabla, «Ver como barbería» contesta 503 y NO abre nada.
--
-- Por qué una tabla PROPIA y no admin_impersonation_sessions (la del dental): esa tabla exige
-- "clinicId" NOT NULL y todo lo que la lee (la barra «Estás viendo…», «Salir y volver a /admin»,
-- «Cerrar sesión» del dental) da por hecho que ese id es una clínica. Una barbería ahí dentro
-- rompería esas pantallas. Esta tabla no la lee nada del dental.
--
-- Plano, idempotente y aditivo (sin bloques DO). No toca ninguna tabla existente.
-- La app entra como postgres (se salta RLS); el RLS cierra la tabla a la llave pública.

CREATE TABLE IF NOT EXISTS "barber_admin_impersonation_sessions" (
  "id"                 TEXT PRIMARY KEY,
  "adminUserId"        TEXT NOT NULL,
  "adminEmail"         TEXT NOT NULL,
  "barbershopId"       TEXT NOT NULL,
  "targetBarberUserId" TEXT NOT NULL,
  "targetSupabaseId"   TEXT NOT NULL,
  "supabaseSessionId"  TEXT NOT NULL,
  "nota"               TEXT NOT NULL,
  "ip"                 TEXT,
  "userAgent"          TEXT,
  "startedAt"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expiresAt"          TIMESTAMPTZ NOT NULL,
  "endedAt"            TIMESTAMPTZ,
  "endedReason"        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "barber_admin_impersonation_sessions_supabaseSessionId_key"
  ON "barber_admin_impersonation_sessions" ("supabaseSessionId");

CREATE INDEX IF NOT EXISTS "barber_admin_impersonation_sessions_barbershopId_startedAt_idx"
  ON "barber_admin_impersonation_sessions" ("barbershopId", "startedAt" DESC);

ALTER TABLE "barber_admin_impersonation_sessions" ENABLE ROW LEVEL SECURITY;

-- Sin políticas para anon/authenticated = nadie con la llave pública la lee ni la escribe.
REVOKE ALL ON TABLE "barber_admin_impersonation_sessions" FROM anon, authenticated;

-- Comprobación (debe salir 1 fila con rowsecurity = true):
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'barber_admin_impersonation_sessions';
