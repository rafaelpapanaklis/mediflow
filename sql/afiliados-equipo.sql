-- ═══════════════════════════════════════════════════════════════════
-- Afiliados — EQUIPOS DE VENDEDORES (vendedores de un afiliado)
--
-- ⚠️  CORRER EN SUPABASE (SQL Editor) tras el deploy de feat/afiliados-equipo.
--     3 tablas NUEVAS + 2 columnas nullable (affiliate_links.sellerId,
--     affiliate_coupons.sellerId). Si no se corre, NADA existente se rompe:
--     la gestión de equipo muestra "pendiente de activar", el webhook sigue
--     pagando el 100% al afiliado (sin split) y la atribución de vendedor se
--     omite en silencio (ver lesson_ortho_schema_drift).
--
--     https://supabase.com/dashboard/project/_/sql/new
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica datos.
-- Espeja prisma/schema.prisma (models AffiliateSeller,
-- AffiliateSellerAttribution, AffiliateSellerCommission + columnas sellerId).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Vendedores de un afiliado (login propio + datos de pago + % asignado)
CREATE TABLE IF NOT EXISTS "affiliate_sellers" (
  "id"            text             NOT NULL,
  "affiliateId"   text             NOT NULL,
  "supabaseId"    text,
  "name"          text             NOT NULL,
  "email"         text             NOT NULL,
  "phone"         text,
  "commissionPct" double precision NOT NULL DEFAULT 0,
  "isActive"      boolean          NOT NULL DEFAULT true,
  "payoutMethod"  text,
  "payoutDetails" text,
  "createdAt"     timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_sellers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_sellers_supabaseId_key"
  ON "affiliate_sellers" ("supabaseId");
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_sellers_affiliateId_email_key"
  ON "affiliate_sellers" ("affiliateId", "email");
CREATE INDEX IF NOT EXISTS "affiliate_sellers_affiliateId_idx"
  ON "affiliate_sellers" ("affiliateId");

DO $$ BEGIN
  ALTER TABLE "affiliate_sellers"
    ADD CONSTRAINT "affiliate_sellers_affiliateId_fkey"
    FOREIGN KEY ("affiliateId") REFERENCES "affiliates" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) Atribución clínica → vendedor (1 por clínica; % congelado al alta).
--    La clínica sigue ligada al PADRE por clinics."affiliateId".
CREATE TABLE IF NOT EXISTS "affiliate_seller_attributions" (
  "id"          text             NOT NULL,
  "clinicId"    text             NOT NULL,
  "sellerId"    text             NOT NULL,
  "affiliateId" text             NOT NULL,
  "sellerPct"   double precision NOT NULL,
  "createdAt"   timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_seller_attributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_seller_attributions_clinicId_key"
  ON "affiliate_seller_attributions" ("clinicId");
CREATE INDEX IF NOT EXISTS "affiliate_seller_attributions_sellerId_idx"
  ON "affiliate_seller_attributions" ("sellerId");
CREATE INDEX IF NOT EXISTS "affiliate_seller_attributions_affiliateId_idx"
  ON "affiliate_seller_attributions" ("affiliateId");

DO $$ BEGIN
  ALTER TABLE "affiliate_seller_attributions"
    ADD CONSTRAINT "affiliate_seller_attributions_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "affiliate_sellers" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "affiliate_seller_attributions"
    ADD CONSTRAINT "affiliate_seller_attributions_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "affiliate_seller_attributions"
    ADD CONSTRAINT "affiliate_seller_attributions_affiliateId_fkey"
    FOREIGN KEY ("affiliateId") REFERENCES "affiliates" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3) Comisión del vendedor por factura (sidecar de affiliate_commissions).
--    Idempotente por stripeInvoiceId (igual que la del padre).
CREATE TABLE IF NOT EXISTS "affiliate_seller_commissions" (
  "id"              text             NOT NULL,
  "sellerId"        text             NOT NULL,
  "affiliateId"     text             NOT NULL,
  "clinicId"        text             NOT NULL,
  "stripeInvoiceId" text             NOT NULL,
  "amountMxn"       double precision NOT NULL,
  "commissionMxn"   double precision NOT NULL,
  "status"          text             NOT NULL DEFAULT 'pending',
  "createdAt"       timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt"          timestamp(3),
  CONSTRAINT "affiliate_seller_commissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_seller_commissions_stripeInvoiceId_key"
  ON "affiliate_seller_commissions" ("stripeInvoiceId");
CREATE INDEX IF NOT EXISTS "affiliate_seller_commissions_sellerId_status_idx"
  ON "affiliate_seller_commissions" ("sellerId", "status");
CREATE INDEX IF NOT EXISTS "affiliate_seller_commissions_affiliateId_idx"
  ON "affiliate_seller_commissions" ("affiliateId");

DO $$ BEGIN
  ALTER TABLE "affiliate_seller_commissions"
    ADD CONSTRAINT "affiliate_seller_commissions_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "affiliate_sellers" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "affiliate_seller_commissions"
    ADD CONSTRAINT "affiliate_seller_commissions_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "affiliate_seller_commissions"
    ADD CONSTRAINT "affiliate_seller_commissions_affiliateId_fkey"
    FOREIGN KEY ("affiliateId") REFERENCES "affiliates" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4) Columna sellerId en links/cupones existentes (vendedor dueño; null = del
--    afiliado). ADD COLUMN IF NOT EXISTS → idempotente y aditivo.
ALTER TABLE "affiliate_links"   ADD COLUMN IF NOT EXISTS "sellerId" text;
ALTER TABLE "affiliate_coupons" ADD COLUMN IF NOT EXISTS "sellerId" text;

CREATE INDEX IF NOT EXISTS "affiliate_links_sellerId_idx"
  ON "affiliate_links" ("sellerId");
CREATE INDEX IF NOT EXISTS "affiliate_coupons_sellerId_idx"
  ON "affiliate_coupons" ("sellerId");

-- Si un vendedor se elimina, su link/cupón queda huérfano del vendedor pero
-- sigue atribuyendo al afiliado padre → ON DELETE SET NULL.
DO $$ BEGIN
  ALTER TABLE "affiliate_links"
    ADD CONSTRAINT "affiliate_links_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "affiliate_sellers" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "affiliate_coupons"
    ADD CONSTRAINT "affiliate_coupons_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "affiliate_sellers" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 5) RLS deny-all en las 3 tablas nuevas (defense-in-depth; Prisma usa el
--    service role y bypassa RLS). Sigue sql/rls-deny-all-policies.sql.
DO $$ BEGIN
  ALTER TABLE "affiliate_sellers" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_sellers'
      AND policyname = 'affiliate_sellers_deny_anon'
  ) THEN
    CREATE POLICY "affiliate_sellers_deny_anon" ON "affiliate_sellers"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE "affiliate_seller_attributions" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_seller_attributions'
      AND policyname = 'affiliate_seller_attributions_deny_anon'
  ) THEN
    CREATE POLICY "affiliate_seller_attributions_deny_anon" ON "affiliate_seller_attributions"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE "affiliate_seller_commissions" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_seller_commissions'
      AND policyname = 'affiliate_seller_commissions_deny_anon'
  ) THEN
    CREATE POLICY "affiliate_seller_commissions_deny_anon" ON "affiliate_seller_commissions"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación:
-- SELECT count(*) FROM "affiliate_sellers";
-- SELECT count(*) FROM "affiliate_seller_attributions";
-- SELECT count(*) FROM "affiliate_seller_commissions";
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name IN ('affiliate_links','affiliate_coupons') AND column_name='sellerId';
-- ═══════════════════════════════════════════════════════════════════
