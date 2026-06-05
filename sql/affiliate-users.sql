-- ═══════════════════════════════════════════════════════════════════════
-- Affiliate users (Fase 2 del módulo de Afiliados/Referidos)
--
-- Agrega SOLO la tabla `affiliate_users` que Prisma SELECTea desde
-- getAffiliateContext(). Las tablas `affiliates` y `affiliate_commissions`
-- (fundación) ya viven en Supabase — este script NO las toca.
--
-- ▶ Aplicar manualmente en el SQL editor de Supabase:
--   https://supabase.com/dashboard/project/_/sql/new
--
-- ADITIVO + IDEMPOTENTE: cada bloque comprueba existencia antes de crear,
-- así que correrlo varias veces no produce errores ni duplicados.
--
-- Nota sobre $$: usamos un único delimitador `$af$` y NUNCA bloques DO
-- anidados (el parser SQL de Supabase rompe con $$ anidado).
--
-- ⚠️ SIN esta tabla, el panel de afiliados (/afiliados) truena al hacer
--    login: getAffiliateContext() hace prisma.affiliateUser.findFirst().
-- ═══════════════════════════════════════════════════════════════════════


-- ── Tabla ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "affiliate_users" (
    "id" TEXT NOT NULL,
    "supabaseId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "affiliate_users_pkey" PRIMARY KEY ("id")
);


-- ── Índices ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_users_supabaseId_key" ON "affiliate_users"("supabaseId");
CREATE INDEX IF NOT EXISTS "affiliate_users_affiliateId_idx" ON "affiliate_users"("affiliateId");


-- ── Foreign key (idempotente vía pg_constraint) ─────────────────────────
-- ADD CONSTRAINT no soporta IF NOT EXISTS, así que lo envolvemos en un
-- IF NOT EXISTS contra pg_constraint dentro de un único bloque DO.
DO $af$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliate_users_affiliateId_fkey') THEN
    ALTER TABLE "affiliate_users" ADD CONSTRAINT "affiliate_users_affiliateId_fkey"
      FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$af$;


-- ── RLS deny-all (defense-in-depth) ─────────────────────────────────────
-- MediFlow accede a esta tabla SOLO vía Prisma + service role (server-side).
-- El cliente nunca hace supabase.from('affiliate_users'). Cerramos la puerta
-- a accesos vía PostgREST con una policy RESTRICTIVE deny-all para anon y
-- authenticated. El service role bypassa RLS por diseño.
-- Sigue el patrón de sql/rls-deny-all-policies.sql.
ALTER TABLE "affiliate_users" ENABLE ROW LEVEL SECURITY;

DO $af$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'affiliate_users'
      AND policyname = 'affiliate_users_deny_anon'
  ) THEN
    CREATE POLICY "affiliate_users_deny_anon" ON "affiliate_users"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END
$af$;


-- ═══════════════════════════════════════════════════════════════════════
-- Verificación (opcional): debería devolver 1 fila.
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'affiliate_users';
-- ═══════════════════════════════════════════════════════════════════════
