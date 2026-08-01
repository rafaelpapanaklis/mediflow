-- ═══════════════════════════════════════════════════════════════════
-- Afiliados — MOTOR DE COMISIONES CONFIGURABLE (ago 2026)
--
-- Montos fijos por plan y pago único, editables desde /admin/affiliates.
-- El afiliado elige modalidad (recurring | onetime); se congela por clínica.
--
--     https://supabase.com/dashboard/project/_/sql/new
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica datos.
-- Los ALTER agregan columnas con DEFAULT (Postgres 11+ no reescribe la tabla)
-- y NO afectan al código anterior: Prisma selecciona columnas explícitas.
-- Espeja prisma/schema.prisma (AffiliatePayoutConfig, AffiliateClinicTerms).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Config global del motor (fila única id=1). Los 6 montos + reglas.
CREATE TABLE IF NOT EXISTS "affiliate_payout_config" (
  "id"                   integer          NOT NULL,
  "defaultMode"          text             NOT NULL DEFAULT 'fixed',
  "defaultPayoutMode"    text             NOT NULL DEFAULT 'recurring',
  "allowAffiliateChoice" boolean          NOT NULL DEFAULT true,
  "recurringBasicMxn"    double precision NOT NULL DEFAULT 40,
  "recurringProMxn"      double precision NOT NULL DEFAULT 90,
  "recurringClinicMxn"   double precision NOT NULL DEFAULT 250,
  "oneTimeBasicMxn"      double precision NOT NULL DEFAULT 350,
  "oneTimeProMxn"        double precision NOT NULL DEFAULT 650,
  "oneTimeClinicMxn"     double precision NOT NULL DEFAULT 1400,
  "startAtInvoiceNo"     integer          NOT NULL DEFAULT 2,
  "oneTimeAtInvoiceNo"   integer          NOT NULL DEFAULT 2,
  "updatedAt"            timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_payout_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "affiliate_payout_config" ("id") VALUES (1)
ON CONFLICT ("id") DO NOTHING;

-- 2) Términos CONGELADOS por clínica referida (modalidad al momento del alta).
CREATE TABLE IF NOT EXISTS "affiliate_clinic_terms" (
  "id"            text         NOT NULL,
  "clinicId"      text         NOT NULL,
  "affiliateId"   text         NOT NULL,
  "payoutMode"    text         NOT NULL DEFAULT 'recurring',
  "oneTimePaidAt" timestamp(3),
  "createdAt"     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_clinic_terms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_clinic_terms_clinicId_key"
  ON "affiliate_clinic_terms" ("clinicId");
CREATE INDEX IF NOT EXISTS "affiliate_clinic_terms_affiliateId_idx"
  ON "affiliate_clinic_terms" ("affiliateId");

DO $$ BEGIN
  ALTER TABLE "affiliate_clinic_terms"
    ADD CONSTRAINT "affiliate_clinic_terms_affiliateId_fkey"
    FOREIGN KEY ("affiliateId") REFERENCES "affiliates" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "affiliate_clinic_terms"
    ADD CONSTRAINT "affiliate_clinic_terms_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3) Columnas nuevas en tablas existentes (aditivas, con DEFAULT).
ALTER TABLE "affiliates"
  ADD COLUMN IF NOT EXISTS "payoutMode" text NOT NULL DEFAULT 'recurring';

ALTER TABLE "affiliate_commissions"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'pct';
ALTER TABLE "affiliate_commissions"
  ADD COLUMN IF NOT EXISTS "monthsCovered" integer NOT NULL DEFAULT 1;

ALTER TABLE "affiliate_seller_commissions"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'pct';

-- 4) Backfill: términos para las clínicas YA referidas (modalidad recurrente).
INSERT INTO "affiliate_clinic_terms" ("id", "clinicId", "affiliateId", "payoutMode")
SELECT gen_random_uuid()::text, c."id", c."affiliateId", 'recurring'
FROM "clinics" c
WHERE c."affiliateId" IS NOT NULL
ON CONFLICT ("clinicId") DO NOTHING;

-- 5) RLS deny-all en las tablas nuevas (defense-in-depth; Prisma usa el
--    service role y bypassa RLS). Sigue sql/rls-deny-all-policies.sql.
DO $$ BEGIN
  ALTER TABLE "affiliate_payout_config" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_payout_config'
      AND policyname = 'affiliate_payout_config_deny_anon'
  ) THEN
    CREATE POLICY "affiliate_payout_config_deny_anon" ON "affiliate_payout_config"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE "affiliate_clinic_terms" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_clinic_terms'
      AND policyname = 'affiliate_clinic_terms_deny_anon'
  ) THEN
    CREATE POLICY "affiliate_clinic_terms_deny_anon" ON "affiliate_clinic_terms"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación:
-- SELECT * FROM "affiliate_payout_config";
-- SELECT count(*) FROM "affiliate_clinic_terms";
-- ═══════════════════════════════════════════════════════════════════
