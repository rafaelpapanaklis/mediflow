-- ═══════════════════════════════════════════════════════════════════
-- Afiliados / Referidos — fundación (modelo afiliado-referido)
--
-- ⚠️  CORRER EN SUPABASE (SQL Editor) ANTES / AL MOMENTO DEL DEPLOY.
--     Agrega clinics."affiliateId", que Prisma incluye en cada SELECT de
--     Clinic. Si NO se corre, TODO el panel responde 500 (mismo problema
--     que pasó con CRM). Ver MEMORY: lesson_ortho_schema_drift.
--
--     https://supabase.com/dashboard/project/_/sql/new
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica datos.
-- Espeja prisma/schema.prisma (models Affiliate, AffiliateCommission,
-- Clinic.affiliateId).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Enum AffiliateStatus (Prisma lo mapea a un tipo nativo). Idempotente.
DO $$ BEGIN
  CREATE TYPE "AffiliateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) Tabla affiliates
CREATE TABLE IF NOT EXISTS "affiliates" (
  "id"            text              NOT NULL,
  "name"          text              NOT NULL,
  "slug"          text              NOT NULL,
  "email"         text              NOT NULL,
  "status"        "AffiliateStatus" NOT NULL DEFAULT 'PENDING',
  "approvedAt"    timestamp(3),
  "referralCode"  text              NOT NULL,
  "commissionPct" double precision  NOT NULL DEFAULT 20,
  "payoutMethod"  text,
  "payoutDetails" text,
  "createdAt"     timestamp(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     timestamp(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliates_slug_key"         ON "affiliates" ("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "affiliates_email_key"        ON "affiliates" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "affiliates_referralCode_key" ON "affiliates" ("referralCode");
CREATE INDEX        IF NOT EXISTS "affiliates_status_idx"       ON "affiliates" ("status");

-- 3) Tabla affiliate_commissions
CREATE TABLE IF NOT EXISTS "affiliate_commissions" (
  "id"              text             NOT NULL,
  "affiliateId"     text             NOT NULL,
  "clinicId"        text             NOT NULL,
  "stripeInvoiceId" text             NOT NULL,
  "amountMxn"       double precision NOT NULL,
  "commissionMxn"   double precision NOT NULL,
  "status"          text             NOT NULL DEFAULT 'pending',
  "createdAt"       timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt"          timestamp(3),
  CONSTRAINT "affiliate_commissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_commissions_stripeInvoiceId_key"
  ON "affiliate_commissions" ("stripeInvoiceId");
CREATE INDEX IF NOT EXISTS "affiliate_commissions_affiliateId_status_idx"
  ON "affiliate_commissions" ("affiliateId", "status");

-- FK affiliate_commissions.affiliateId → affiliates.id (idempotente)
DO $$ BEGIN
  ALTER TABLE "affiliate_commissions"
    ADD CONSTRAINT "affiliate_commissions_affiliateId_fkey"
    FOREIGN KEY ("affiliateId") REFERENCES "affiliates" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4) clinics.affiliateId — CRÍTICO (Prisma lo SELECTea en cada query de Clinic)
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "affiliateId" text;

CREATE INDEX IF NOT EXISTS "clinics_affiliateId_idx" ON "clinics" ("affiliateId");

-- FK clinics.affiliateId → affiliates.id (idempotente; SET NULL al borrar afiliado)
DO $$ BEGIN
  ALTER TABLE "clinics"
    ADD CONSTRAINT "clinics_affiliateId_fkey"
    FOREIGN KEY ("affiliateId") REFERENCES "affiliates" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 5) RLS deny-all en las 2 tablas nuevas (defense-in-depth). Prisma usa el
--    service role y bypassa RLS; el cliente nunca toca estas tablas.
--    Sigue sql/rls-deny-all-policies.sql.
DO $$ BEGIN
  ALTER TABLE "affiliates" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliates'
      AND policyname = 'affiliates_deny_anon'
  ) THEN
    CREATE POLICY "affiliates_deny_anon" ON "affiliates"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE "affiliate_commissions" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_commissions'
      AND policyname = 'affiliate_commissions_deny_anon'
  ) THEN
    CREATE POLICY "affiliate_commissions_deny_anon" ON "affiliate_commissions"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- Alta manual del primer afiliado (ejemplo — ajusta valores y descomenta).
-- No hay panel de afiliado todavía; así se crea el referralCode a repartir:
--
-- INSERT INTO "affiliates"
--   ("id","name","slug","email","status","approvedAt","referralCode","commissionPct")
-- VALUES
--   (gen_random_uuid()::text, 'Juan Pérez', 'juan-perez', 'juan@example.com',
--    'APPROVED', now(), 'JUANPER1', 20);
--
-- Luego el link de referido es:  https://mediflow.../registro?ref=JUANPER1
--
-- Verificación:
-- SELECT id, name, "referralCode", status, "commissionPct" FROM "affiliates";
-- ═══════════════════════════════════════════════════════════════════
