-- ═══════════════════════════════════════════════════════════════════
-- Afiliados — HERRAMIENTAS DE VENTA (multi-links, cupón propio, niveles)
--
-- ⚠️  CORRER EN SUPABASE (SQL Editor) tras el deploy de feat/afiliados-ventas.
--     Son SOLO tablas nuevas (cero ALTER a tablas existentes): si no se corre,
--     NADA existente se rompe; las herramientas nuevas muestran un aviso de
--     "pendiente de activar" y el cálculo de comisión sigue en modo legacy
--     (Affiliate.commissionPct). Al correrlo se activan niveles 10/12/15.
--
--     https://supabase.com/dashboard/project/_/sql/new
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica datos.
-- Espeja prisma/schema.prisma (models AffiliateLink, AffiliateConversion,
-- AffiliateCoupon, AffiliateProgramConfig).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Links nombrados con campaña ("Facebook", "Expo dental", ...)
CREATE TABLE IF NOT EXISTS "affiliate_links" (
  "id"          text         NOT NULL,
  "affiliateId" text         NOT NULL,
  "name"        text         NOT NULL,
  "campaign"    text         NOT NULL,
  "clicks"      integer      NOT NULL DEFAULT 0,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_links_affiliateId_campaign_key"
  ON "affiliate_links" ("affiliateId", "campaign");
CREATE INDEX IF NOT EXISTS "affiliate_links_affiliateId_idx"
  ON "affiliate_links" ("affiliateId");

DO $$ BEGIN
  ALTER TABLE "affiliate_links"
    ADD CONSTRAINT "affiliate_links_affiliateId_fkey"
    FOREIGN KEY ("affiliateId") REFERENCES "affiliates" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) Conversiones atribuidas (sidecar de analytics; 1 por clínica).
--    La atribución REAL para comisiones sigue siendo clinics."affiliateId".
CREATE TABLE IF NOT EXISTS "affiliate_conversions" (
  "id"          text         NOT NULL,
  "affiliateId" text         NOT NULL,
  "clinicId"    text         NOT NULL,
  "campaign"    text,
  "source"      text         NOT NULL DEFAULT 'link',
  "couponId"    text,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_conversions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_conversions_clinicId_key"
  ON "affiliate_conversions" ("clinicId");
CREATE INDEX IF NOT EXISTS "affiliate_conversions_affiliateId_campaign_idx"
  ON "affiliate_conversions" ("affiliateId", "campaign");

DO $$ BEGIN
  ALTER TABLE "affiliate_conversions"
    ADD CONSTRAINT "affiliate_conversions_affiliateId_fkey"
    FOREIGN KEY ("affiliateId") REFERENCES "affiliates" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- FK a clinics SIN relación Prisma (mismo patrón que affiliate_commissions)
DO $$ BEGIN
  ALTER TABLE "affiliate_conversions"
    ADD CONSTRAINT "affiliate_conversions_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3) Puente cupón ↔ afiliado (el cupón vive en "coupons", sistema existente)
CREATE TABLE IF NOT EXISTS "affiliate_coupons" (
  "id"          text         NOT NULL,
  "affiliateId" text         NOT NULL,
  "couponId"    text         NOT NULL,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_coupons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_coupons_couponId_key"
  ON "affiliate_coupons" ("couponId");
CREATE INDEX IF NOT EXISTS "affiliate_coupons_affiliateId_idx"
  ON "affiliate_coupons" ("affiliateId");

DO $$ BEGIN
  ALTER TABLE "affiliate_coupons"
    ADD CONSTRAINT "affiliate_coupons_affiliateId_fkey"
    FOREIGN KEY ("affiliateId") REFERENCES "affiliates" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "affiliate_coupons"
    ADD CONSTRAINT "affiliate_coupons_couponId_fkey"
    FOREIGN KEY ("couponId") REFERENCES "coupons" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4) Config global del programa (fila única id=1; defaults 10/12/15 y
--    umbrales 3/10 clínicas activas). Editable desde /admin/affiliates.
CREATE TABLE IF NOT EXISTS "affiliate_program_config" (
  "id"              integer          NOT NULL,
  "bronzePct"       double precision NOT NULL DEFAULT 10,
  "silverPct"       double precision NOT NULL DEFAULT 12,
  "goldPct"         double precision NOT NULL DEFAULT 15,
  "silverMinActive" integer          NOT NULL DEFAULT 3,
  "goldMinActive"   integer          NOT NULL DEFAULT 10,
  "updatedAt"       timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_program_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "affiliate_program_config" ("id") VALUES (1)
ON CONFLICT ("id") DO NOTHING;

-- 5) RLS deny-all en las 4 tablas nuevas (defense-in-depth; Prisma usa el
--    service role y bypassa RLS). Sigue sql/rls-deny-all-policies.sql.
DO $$ BEGIN
  ALTER TABLE "affiliate_links" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_links'
      AND policyname = 'affiliate_links_deny_anon'
  ) THEN
    CREATE POLICY "affiliate_links_deny_anon" ON "affiliate_links"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE "affiliate_conversions" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_conversions'
      AND policyname = 'affiliate_conversions_deny_anon'
  ) THEN
    CREATE POLICY "affiliate_conversions_deny_anon" ON "affiliate_conversions"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE "affiliate_coupons" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_coupons'
      AND policyname = 'affiliate_coupons_deny_anon'
  ) THEN
    CREATE POLICY "affiliate_coupons_deny_anon" ON "affiliate_coupons"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE "affiliate_program_config" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_program_config'
      AND policyname = 'affiliate_program_config_deny_anon'
  ) THEN
    CREATE POLICY "affiliate_program_config_deny_anon" ON "affiliate_program_config"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación:
-- SELECT * FROM "affiliate_program_config";
-- SELECT count(*) FROM "affiliate_links";
-- SELECT count(*) FROM "affiliate_conversions";
-- SELECT count(*) FROM "affiliate_coupons";
-- ═══════════════════════════════════════════════════════════════════
