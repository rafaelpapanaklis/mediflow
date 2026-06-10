-- ═══════════════════════════════════════════════════════════════════════
-- Afiliados — Estadísticas y Reportes (clicks + preferencias de email)
--
-- ▶ Aplicar manualmente en el SQL editor de Supabase:
--   https://supabase.com/dashboard/project/_/sql/new
--
-- ADITIVO + IDEMPOTENTE: seguro de re-correr. No toca tablas existentes
-- (affiliates / affiliate_commissions / affiliate_users / clinics quedan
-- intactas — cero riesgo de drift en SELECTs existentes).
--
-- Espeja prisma/schema.prisma (models AffiliateClick y AffiliatePrefs).
-- Nota $$: delimitador único $af$ y NUNCA bloques DO anidados (el parser
-- de Supabase rompe con $$ anidado). Sin CREATE INDEX CONCURRENTLY (las
-- tablas nacen vacías; además CONCURRENTLY requiere un Run propio).
-- ═══════════════════════════════════════════════════════════════════════


-- ── Tabla: affiliate_clicks (espejo de model AffiliateClick) ─────────────
-- "id" lo genera Prisma (cuid) del lado del cliente — sin DEFAULT en BD.
CREATE TABLE IF NOT EXISTS "affiliate_clicks" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "campaign" TEXT,
    "landingPage" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "affiliate_clicks_pkey" PRIMARY KEY ("id")
);


-- ── Tabla: affiliate_prefs (espejo de model AffiliatePrefs) ──────────────
-- "updatedAt" lleva DEFAULT para el INSERT; el @updatedAt de Prisma lo
-- refresca del lado del cliente en cada UPDATE (no requiere trigger).
CREATE TABLE IF NOT EXISTS "affiliate_prefs" (
    "affiliateId" TEXT NOT NULL,
    "notifySignup" BOOLEAN NOT NULL DEFAULT true,
    "notifyConversion" BOOLEAN NOT NULL DEFAULT true,
    "notifyPayout" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "affiliate_prefs_pkey" PRIMARY KEY ("affiliateId")
);


-- ── Índices (espejo de los @@index del schema, nombres estilo Prisma) ────
CREATE INDEX IF NOT EXISTS "affiliate_clicks_affiliateId_createdAt_idx"
  ON "affiliate_clicks"("affiliateId", "createdAt");
CREATE INDEX IF NOT EXISTS "affiliate_clicks_ref_createdAt_idx"
  ON "affiliate_clicks"("ref", "createdAt");


-- ── Foreign keys (idempotentes vía pg_constraint) ────────────────────────
-- ADD CONSTRAINT no soporta IF NOT EXISTS, así que lo envolvemos en un
-- IF NOT EXISTS contra pg_constraint dentro de un único bloque DO.
DO $af$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliate_clicks_affiliateId_fkey') THEN
    ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_affiliateId_fkey"
      FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$af$;

DO $af$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliate_prefs_affiliateId_fkey') THEN
    ALTER TABLE "affiliate_prefs" ADD CONSTRAINT "affiliate_prefs_affiliateId_fkey"
      FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$af$;


-- ── RLS deny-all (defense-in-depth) ──────────────────────────────────────
-- MediFlow accede a estas tablas SOLO vía Prisma + service role (server-side).
-- El cliente nunca hace supabase.from('affiliate_clicks') ni ('affiliate_prefs').
-- Cerramos la puerta a accesos vía PostgREST con una policy RESTRICTIVE
-- deny-all para anon y authenticated. El service role bypassa RLS por diseño.
-- Sigue el patrón de sql/rls-deny-all-policies.sql.
ALTER TABLE "affiliate_clicks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliate_prefs" ENABLE ROW LEVEL SECURITY;

DO $af$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'affiliate_clicks'
      AND policyname = 'affiliate_clicks_deny_anon'
  ) THEN
    CREATE POLICY "affiliate_clicks_deny_anon" ON "affiliate_clicks"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END
$af$;

DO $af$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'affiliate_prefs'
      AND policyname = 'affiliate_prefs_deny_anon'
  ) THEN
    CREATE POLICY "affiliate_prefs_deny_anon" ON "affiliate_prefs"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END
$af$;


-- ═══════════════════════════════════════════════════════════════════════
-- Verificación (opcional):
--
-- a) Policies — debería devolver 2 filas (una por tabla):
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('affiliate_clicks', 'affiliate_prefs');
--
-- b) Conteo de tablas creadas con RLS activo — debería devolver 2:
-- SELECT count(*) FROM pg_tables
-- WHERE schemaname = 'public'
--   AND rowsecurity = true
--   AND tablename IN ('affiliate_clicks', 'affiliate_prefs');
-- ═══════════════════════════════════════════════════════════════════════
