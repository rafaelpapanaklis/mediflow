-- ═══════════════════════════════════════════════════════════════════
-- AI token billing — fundación (T1)
--
-- ⚠️  CORRER EN SUPABASE (SQL Editor) ANTES / AL MOMENTO DEL DEPLOY.
--     Crea los enums + tablas ai_wallets / ai_usage_events /
--     ai_wallet_transactions / ai_topups / ai_pricing_configs /
--     anthropic_recharges, que Prisma incluye en sus queries. Si NO se corre,
--     el metering del bot y el panel de IA responden 500 (mismo problema que
--     pasó con CRM / afiliados). Ver MEMORY: lesson_ortho_schema_drift.
--
--     https://supabase.com/dashboard/project/_/sql/new
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica datos.
-- Espeja prisma/schema.prisma (models AiWallet, AiUsageEvent,
-- AiWalletTransaction, AiTopup, AiPricingConfig, AnthropicRecharge).
--
-- Cobro del BOT DE WHATSAPP: MediFlow paga Anthropic (USD) y cobra a la clínica
-- en MXN (centavos) con fee OCULTO. NO confundir con el cupo
-- clinics."aiTokensUsed"/"aiTokensLimit" (otro concepto: asistente / rayos X).
--
-- Nota sobre $$: un único delimitador `$aibill$`, sin bloques DO anidados
-- (el parser SQL de Supabase rompe con $$ anidado).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Enums (idempotentes vía pg_type) ──────────────────────────────
DO $aibill$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiWalletStatus') THEN
    CREATE TYPE "AiWalletStatus" AS ENUM ('ACTIVE', 'PAUSED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiWalletTxType') THEN
    CREATE TYPE "AiWalletTxType" AS ENUM ('TOPUP', 'CHARGE', 'REFUND', 'ADJUSTMENT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiWalletTxSource') THEN
    CREATE TYPE "AiWalletTxSource" AS ENUM ('STRIPE', 'MERCADOPAGO', 'SPEI', 'USAGE', 'ADMIN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiTopupMethod') THEN
    CREATE TYPE "AiTopupMethod" AS ENUM ('STRIPE', 'MERCADOPAGO', 'SPEI');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiTopupStatus') THEN
    CREATE TYPE "AiTopupStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REJECTED');
  END IF;
END
$aibill$;

-- 2) Tablas (IF NOT EXISTS). Columnas camelCase entrecomilladas (espejo Prisma).
CREATE TABLE IF NOT EXISTS "ai_wallets" (
  "id"                         text             NOT NULL,
  "clinicId"                   text             NOT NULL,
  "balanceCents"               integer          NOT NULL DEFAULT 0,
  "autoRecharge"               boolean          NOT NULL DEFAULT false,
  "autoRechargeThresholdCents" integer          NOT NULL DEFAULT 0,
  "autoRechargeAmountCents"    integer          NOT NULL DEFAULT 0,
  "stripePaymentMethodId"      text,
  "status"                     "AiWalletStatus" NOT NULL DEFAULT 'ACTIVE',
  "lowBalanceNotifiedAt"       timestamp(3),
  "createdAt"                  timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                  timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_wallets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_wallets_clinicId_key" ON "ai_wallets" ("clinicId");

CREATE TABLE IF NOT EXISTS "ai_usage_events" (
  "id"            text             NOT NULL,
  "clinicId"      text             NOT NULL,
  "feature"       text             NOT NULL DEFAULT 'whatsapp_bot',
  "model"         text             NOT NULL,
  "inputTokens"   integer          NOT NULL,
  "outputTokens"  integer          NOT NULL,
  "cacheTokens"   integer          NOT NULL DEFAULT 0,
  "costUsdMicros" integer          NOT NULL,
  "fxRate"        double precision NOT NULL,
  "feePct"        double precision NOT NULL,
  "billedCents"   integer          NOT NULL,
  "threadId"      text,
  "createdAt"     timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_usage_events_clinicId_createdAt_idx"
  ON "ai_usage_events" ("clinicId", "createdAt");

CREATE TABLE IF NOT EXISTS "ai_wallet_transactions" (
  "id"                text               NOT NULL,
  "clinicId"          text               NOT NULL,
  "type"              "AiWalletTxType"   NOT NULL,
  "amountCents"       integer            NOT NULL,
  "balanceAfterCents" integer            NOT NULL,
  "source"            "AiWalletTxSource" NOT NULL,
  "reference"         text,
  "note"              text,
  "createdAt"         timestamp(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_wallet_transactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_wallet_transactions_clinicId_createdAt_idx"
  ON "ai_wallet_transactions" ("clinicId", "createdAt");

CREATE TABLE IF NOT EXISTS "ai_topups" (
  "id"          text            NOT NULL,
  "clinicId"    text            NOT NULL,
  "amountCents" integer         NOT NULL,
  "method"      "AiTopupMethod" NOT NULL,
  "status"      "AiTopupStatus" NOT NULL DEFAULT 'PENDING',
  "gatewayRef"  text,
  "proofUrl"    text,
  "confirmedBy" text,
  "createdAt"   timestamp(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt"      timestamp(3),
  CONSTRAINT "ai_topups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_topups_clinicId_idx" ON "ai_topups" ("clinicId");

CREATE TABLE IF NOT EXISTS "ai_pricing_configs" (
  "id"                   text             NOT NULL,
  "inputUsdPerMtok"      double precision NOT NULL DEFAULT 3,
  "outputUsdPerMtok"     double precision NOT NULL DEFAULT 15,
  "cacheWriteUsdPerMtok" double precision NOT NULL DEFAULT 3.75,
  "cacheReadUsdPerMtok"  double precision NOT NULL DEFAULT 0.3,
  "usdToMxnRate"         double precision NOT NULL DEFAULT 19.5,
  "feePct"               double precision NOT NULL DEFAULT 8,
  "updatedAt"            timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_pricing_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "anthropic_recharges" (
  "id"             text         NOT NULL,
  "amountUsdCents" integer      NOT NULL,
  "note"           text,
  "createdAt"      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "anthropic_recharges_pkey" PRIMARY KEY ("id")
);

-- 3) Foreign keys → clinics (idempotentes vía pg_constraint) ────────
DO $aibill$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_wallets_clinicId_fkey') THEN
    ALTER TABLE "ai_wallets" ADD CONSTRAINT "ai_wallets_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_events_clinicId_fkey') THEN
    ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_wallet_transactions_clinicId_fkey') THEN
    ALTER TABLE "ai_wallet_transactions" ADD CONSTRAINT "ai_wallet_transactions_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_topups_clinicId_fkey') THEN
    ALTER TABLE "ai_topups" ADD CONSTRAINT "ai_topups_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$aibill$;

-- 4) Seed: fila global de precios id='default'. No pisa cambios del admin.
INSERT INTO "ai_pricing_configs" ("id", "updatedAt")
VALUES ('default', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- 5) RLS deny-all (defense-in-depth). Prisma usa service role y bypassa RLS;
--    el cliente nunca toca estas tablas. Sigue sql/rls-deny-all-policies.sql.
DO $aibill$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ai_wallets', 'ai_usage_events', 'ai_wallet_transactions',
    'ai_topups', 'ai_pricing_configs', 'anthropic_recharges'
  ]
  LOOP
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
END
$aibill$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación:
--   SELECT "id","feePct","usdToMxnRate" FROM "ai_pricing_configs";
--   SELECT tablename, policyname FROM pg_policies
--     WHERE schemaname='public' AND tablename LIKE 'ai\_%' ESCAPE '\'
--     ORDER BY tablename;
-- ═══════════════════════════════════════════════════════════════════
