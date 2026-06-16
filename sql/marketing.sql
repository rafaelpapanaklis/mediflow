-- ═══════════════════════════════════════════════════════════════════
-- Módulo Marketing (WS-MKT-T1 foundation)
-- Tablas social_accounts / marketing_posts / marketing_templates ⇄ modelos
-- Prisma SocialAccount / MarketingPost / MarketingTemplate (al final de
-- prisma/schema.prisma). Columnas camelCase 1:1 con los campos Prisma.
--
-- IDEMPOTENTE: CREATE ... IF NOT EXISTS + bloques DO con guardas. Seguro de
-- re-correr. Delimitadores $mkt$ (NUNCA $$ pelado — el editor de Supabase
-- rompe el parser con $$).
--
-- APLICAR A MANO en el SQL editor de Supabase. NO `prisma migrate`. Hasta
-- aplicarlo, cualquier ruta que toque prisma.socialAccount / marketingPost /
-- marketingTemplate revienta en runtime.
--
-- RLS OBLIGATORIO: ninguna tabla en `public` sin RLS. Se habilita RLS y se
-- crea una policy deny-all RESTRICTIVE para anon+authenticated (patrón
-- sql/rls-deny-all-policies.sql). MediFlow accede solo vía Prisma + service
-- role (bypassa RLS); esto cierra PostgREST si se filtra el anon key.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 1) social_accounts — redes conectadas por clínica (token CIFRADO).
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "social_accounts" (
  "id"             TEXT NOT NULL,
  "clinicId"       TEXT NOT NULL,
  "provider"       TEXT NOT NULL,
  "externalId"     TEXT NOT NULL,
  "name"           TEXT,
  "accessTokenEnc" TEXT NOT NULL,
  "igBusinessId"   TEXT,
  "scope"          TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "connected"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "social_accounts_clinicId_provider_externalId_key"
  ON "social_accounts" ("clinicId", "provider", "externalId");
CREATE INDEX IF NOT EXISTS "social_accounts_clinicId_idx"
  ON "social_accounts" ("clinicId");

-- ───────────────────────────────────────────────────────────────────
-- 2) marketing_posts — posts (borrador / programado / publicado).
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "marketing_posts" (
  "id"           TEXT NOT NULL,
  "clinicId"     TEXT NOT NULL,
  "channel"      TEXT NOT NULL,
  "caption"      TEXT NOT NULL,
  "mediaUrls"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"       TEXT NOT NULL DEFAULT 'DRAFT',
  "scheduledFor" TIMESTAMP(3),
  "publishedAt"  TIMESTAMP(3),
  "externalIds"  JSONB,
  "errorMsg"     TEXT,
  "aiGenerated"  BOOLEAN NOT NULL DEFAULT false,
  "createdById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_posts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "marketing_posts_clinicId_status_idx"
  ON "marketing_posts" ("clinicId", "status");
CREATE INDEX IF NOT EXISTS "marketing_posts_scheduledFor_idx"
  ON "marketing_posts" ("scheduledFor");

-- ───────────────────────────────────────────────────────────────────
-- 3) marketing_templates — plantillas (globales si clinicId IS NULL).
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "marketing_templates" (
  "id"        TEXT NOT NULL,
  "clinicId"  TEXT,
  "specialty" TEXT,
  "kind"      TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "tags"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "marketing_templates_clinicId_idx"
  ON "marketing_templates" ("clinicId");

-- ───────────────────────────────────────────────────────────────────
-- 4) Foreign keys → clinics(id) ON DELETE CASCADE. Idempotentes; si la
--    tabla referenciada no existe (deploy parcial) se saltan con NOTICE.
-- ───────────────────────────────────────────────────────────────────
DO $mkt$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_accounts_clinicId_fkey') THEN
    ALTER TABLE "social_accounts"
      ADD CONSTRAINT "social_accounts_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_posts_clinicId_fkey') THEN
    ALTER TABLE "marketing_posts"
      ADD CONSTRAINT "marketing_posts_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_templates_clinicId_fkey') THEN
    ALTER TABLE "marketing_templates"
      ADD CONSTRAINT "marketing_templates_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla referenciada inexistente — FKs de marketing saltadas (deploy parcial)';
END
$mkt$;

-- ───────────────────────────────────────────────────────────────────
-- 5) RLS deny-all (REGLA CRÍTICA: nada en public sin RLS). Habilita RLS y
--    crea policy RESTRICTIVE que niega lectura y escritura a anon+auth.
--    Prisma (service role) bypassa RLS, así que la app sigue funcionando.
-- ───────────────────────────────────────────────────────────────────
DO $mkt$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['social_accounts', 'marketing_posts', 'marketing_templates']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = tbl
        AND policyname = tbl || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        tbl || '_deny_anon', tbl
      );
    END IF;
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla de marketing inexistente — RLS saltada (deploy parcial)';
END
$mkt$;

-- ALTER TABLE social_accounts     ENABLE ROW LEVEL SECURITY;  (lo hace el bloque 5)
-- ALTER TABLE marketing_posts     ENABLE ROW LEVEL SECURITY;  (lo hace el bloque 5)
-- ALTER TABLE marketing_templates ENABLE ROW LEVEL SECURITY;  (lo hace el bloque 5)
