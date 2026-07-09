-- ─────────────────────────────────────────────────────────────────────────────
-- Analítica de primera parte (self-hosted) — panel /admin/analytics.
-- Aplicar en Supabase SQL Editor. Idempotente. Espejo de los modelos Prisma
-- AnalyticsSession / AnalyticsEvent (prisma/schema.prisma).
-- Columnas en camelCase entre comillas (convención del repo). RLS deny-all:
-- Prisma (service-role) bypasa; PostgREST anon/authenticated queda bloqueado.
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================ SESIONES =======================================
CREATE TABLE IF NOT EXISTS "analytics_sessions" (
    "id"               TEXT NOT NULL,
    "visitorId"        TEXT NOT NULL,
    "surface"          TEXT NOT NULL DEFAULT 'public',

    "identityType"     TEXT NOT NULL DEFAULT 'anonymous',
    "clinicId"         TEXT,
    "userId"           TEXT,
    "patientAccountId" TEXT,
    "email"            TEXT,
    "displayName"      TEXT,
    "role"             TEXT,
    "plan"             TEXT,

    "entryPath"        TEXT,
    "exitPath"         TEXT,
    "referrer"         TEXT,
    "referrerHost"     TEXT,
    "referrerType"     TEXT,
    "utmSource"        TEXT,
    "utmMedium"        TEXT,
    "utmCampaign"      TEXT,
    "utmTerm"          TEXT,
    "utmContent"       TEXT,
    "gclid"            TEXT,

    "country"          TEXT,
    "region"           TEXT,
    "city"             TEXT,
    "latitude"         DOUBLE PRECISION,
    "longitude"        DOUBLE PRECISION,
    "ip"               TEXT,

    "device"           TEXT,
    "browser"          TEXT,
    "os"               TEXT,
    "screenW"          INTEGER,
    "screenH"          INTEGER,
    "language"         TEXT,
    "timezone"         TEXT,

    "pageviews"        INTEGER NOT NULL DEFAULT 0,
    "clicks"           INTEGER NOT NULL DEFAULT 0,
    "maxScroll"        INTEGER NOT NULL DEFAULT 0,
    "durationMs"       INTEGER NOT NULL DEFAULT 0,
    "isBounce"         BOOLEAN NOT NULL DEFAULT true,

    "startedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "analytics_sessions_startedAt_idx"                ON "analytics_sessions"("startedAt");
CREATE INDEX IF NOT EXISTS "analytics_sessions_clinicId_startedAt_idx"       ON "analytics_sessions"("clinicId", "startedAt");
CREATE INDEX IF NOT EXISTS "analytics_sessions_surface_startedAt_idx"        ON "analytics_sessions"("surface", "startedAt");
CREATE INDEX IF NOT EXISTS "analytics_sessions_visitorId_idx"               ON "analytics_sessions"("visitorId");
CREATE INDEX IF NOT EXISTS "analytics_sessions_lastSeenAt_idx"              ON "analytics_sessions"("lastSeenAt");
CREATE INDEX IF NOT EXISTS "analytics_sessions_identityType_startedAt_idx"   ON "analytics_sessions"("identityType", "startedAt");
CREATE INDEX IF NOT EXISTS "analytics_sessions_referrerType_startedAt_idx"   ON "analytics_sessions"("referrerType", "startedAt");
CREATE INDEX IF NOT EXISTS "analytics_sessions_country_startedAt_idx"        ON "analytics_sessions"("country", "startedAt");

-- ============================ EVENTOS ========================================
CREATE TABLE IF NOT EXISTS "analytics_events" (
    "id"         TEXT NOT NULL,
    "sessionId"  TEXT NOT NULL,
    "visitorId"  TEXT NOT NULL,
    "clinicId"   TEXT,
    "surface"    TEXT,
    "type"       TEXT NOT NULL,
    "path"       TEXT NOT NULL,
    "title"      TEXT,
    "referrer"   TEXT,
    "name"       TEXT,
    "x"          DOUBLE PRECISION,
    "y"          DOUBLE PRECISION,
    "vw"         INTEGER,
    "vh"         INTEGER,
    "docH"       INTEGER,
    "scrollPct"  INTEGER,
    "selector"   TEXT,
    "text"       TEXT,
    "durationMs" INTEGER,
    "meta"       JSONB,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "analytics_events_sessionId_idx"          ON "analytics_events"("sessionId");
CREATE INDEX IF NOT EXISTS "analytics_events_clinicId_createdAt_idx" ON "analytics_events"("clinicId", "createdAt");
CREATE INDEX IF NOT EXISTS "analytics_events_type_path_createdAt_idx" ON "analytics_events"("type", "path", "createdAt");
CREATE INDEX IF NOT EXISTS "analytics_events_path_createdAt_idx"     ON "analytics_events"("path", "createdAt");
CREATE INDEX IF NOT EXISTS "analytics_events_createdAt_idx"          ON "analytics_events"("createdAt");

-- FK events.sessionId → sessions.id (ADD CONSTRAINT no soporta IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_events_sessionId_fkey') THEN
    ALTER TABLE "analytics_events"
      ADD CONSTRAINT "analytics_events_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "analytics_sessions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ============================ RLS deny-all ===================================
DO $$
DECLARE
  t    text;
  tbls text[] := ARRAY['analytics_sessions', 'analytics_events'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        t || '_deny_anon', t
      );
    END IF;
  END LOOP;
END $$;
