-- ═══════════════════════════════════════════════════════════════════════
-- Ortodoncia · Rediseño completo Fase 1.5 — Mayo 2026
--
-- Cubre las secciones del mockup que no entraron en Fase 1:
--   - Sección E: 2 vistas faciales adicionales (NORMAL + SONRISA) → 10 total
--   - Sección F: Quote scenarios (G5) + Sign@Home packages (G6)
--   - Sección G: Retention regimen (G9) + retainer checkups
--   - Sección H: NPS schedule (G11) + Referral codes (G12 placeholder)
--
-- IDEMPOTENTE: usa CREATE TYPE en DO $$ guards, IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, ADD CONSTRAINT en DO $$ guards.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. ENUMS NUEVOS ──────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "OrthoQuoteScenarioStatus" AS ENUM ('DRAFT', 'PRESENTED', 'ACCEPTED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoQuoteScenarioPaymentMode" AS ENUM ('CONTADO', 'ENGANCHE_MENSUALIDADES', 'ENGANCHE_MSI');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoSignAtHomeStatus" AS ENUM ('PENDING', 'SENT', 'SIGNED', 'PAID', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoRetainerType" AS ENUM ('HAWLEY_SUP', 'HAWLEY_INF', 'ESSIX_SUP', 'ESSIX_INF', 'FIXED_LINGUAL_3_3', 'NONE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoRetainerArchwireGauge" AS ENUM ('G_0175', 'G_0195', 'G_021');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoRetainerCheckupStatus" AS ENUM ('PROGRAMMED', 'COMPLETED', 'MISSED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoNpsType" AS ENUM ('POST_DEBOND_3D', 'POST_DEBOND_6M', 'POST_DEBOND_12M');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoNpsStatus" AS ENUM ('SCHEDULED', 'SENT', 'RESPONDED', 'EXPIRED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. ALTER TABLE ortho_photo_sets — 2 vistas faciales adicionales ─────

ALTER TABLE "ortho_photo_sets"
  ADD COLUMN IF NOT EXISTS "photoFaceFrontId" TEXT,
  ADD COLUMN IF NOT EXISTS "photoFaceSmileId" TEXT;

DO $$ BEGIN
  ALTER TABLE "ortho_photo_sets"
    ADD CONSTRAINT "ortho_photo_sets_photoFaceFrontId_fkey"
    FOREIGN KEY ("photoFaceFrontId") REFERENCES "patient_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_photo_sets"
    ADD CONSTRAINT "ortho_photo_sets_photoFaceSmileId_fkey"
    FOREIGN KEY ("photoFaceSmileId") REFERENCES "patient_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. CREATE TABLES NUEVAS ─────────────────────────────────────────────

-- 3.1 ortho_quote_scenarios (G5 Open Choice)
CREATE TABLE IF NOT EXISTS "ortho_quote_scenarios" (
  "id"              TEXT NOT NULL,
  "treatmentPlanId" TEXT NOT NULL,
  "clinicId"        TEXT NOT NULL,
  "label"           TEXT NOT NULL,
  "paymentMode"     "OrthoQuoteScenarioPaymentMode" NOT NULL,
  "downPayment"     DECIMAL(10,2) NOT NULL,
  "monthlyAmount"   DECIMAL(10,2) NOT NULL DEFAULT 0,
  "monthsCount"     INTEGER NOT NULL DEFAULT 0,
  "totalAmount"     DECIMAL(10,2) NOT NULL,
  "discountPct"     INTEGER,
  "badge"           TEXT,
  "includes"        TEXT[] NOT NULL DEFAULT '{}',
  "notes"           TEXT,
  "status"          "OrthoQuoteScenarioStatus" NOT NULL DEFAULT 'DRAFT',
  "presentedAt"     TIMESTAMP(3),
  "acceptedAt"      TIMESTAMP(3),
  "rejectedAt"      TIMESTAMP(3),
  "createdById"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ortho_quote_scenarios_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ortho_quote_scenarios_treatmentPlanId_status_idx"
  ON "ortho_quote_scenarios" ("treatmentPlanId", "status");
CREATE INDEX IF NOT EXISTS "ortho_quote_scenarios_clinicId_status_idx"
  ON "ortho_quote_scenarios" ("clinicId", "status");

-- 3.2 ortho_sign_at_home_packages (G6 Sign@Home WhatsApp)
CREATE TABLE IF NOT EXISTS "ortho_sign_at_home_packages" (
  "id"                       TEXT NOT NULL,
  "treatmentPlanId"          TEXT NOT NULL,
  "patientId"                TEXT NOT NULL,
  "clinicId"                 TEXT NOT NULL,
  "token"                    TEXT NOT NULL,
  "expiresAt"                TIMESTAMP(3) NOT NULL,
  "status"                   "OrthoSignAtHomeStatus" NOT NULL DEFAULT 'PENDING',
  "selectedQuoteScenarioId"  TEXT,
  "downPaymentAmount"        DECIMAL(10,2),
  "contractDocId"            TEXT,
  "consentDocIds"            TEXT[] NOT NULL DEFAULT '{}',
  "paymentMethod"            "OrthoPaymentMethod",
  "sentAt"                   TIMESTAMP(3),
  "signedAt"                 TIMESTAMP(3),
  "paidAt"                   TIMESTAMP(3),
  "cfdiUuid"                 TEXT,
  "createdById"              TEXT NOT NULL,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ortho_sign_at_home_packages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ortho_sign_at_home_packages_token_key"
  ON "ortho_sign_at_home_packages" ("token");
CREATE INDEX IF NOT EXISTS "ortho_sign_at_home_packages_clinicId_status_expiresAt_idx"
  ON "ortho_sign_at_home_packages" ("clinicId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "ortho_sign_at_home_packages_patientId_createdAt_idx"
  ON "ortho_sign_at_home_packages" ("patientId", "createdAt" DESC);

-- 3.3 ortho_retention_regimens (G9)
CREATE TABLE IF NOT EXISTS "ortho_retention_regimens" (
  "id"                  TEXT NOT NULL,
  "treatmentPlanId"     TEXT NOT NULL,
  "clinicId"            TEXT NOT NULL,
  "upperRetainer"       "OrthoRetainerType",
  "upperDescription"    TEXT,
  "lowerRetainer"       "OrthoRetainerType",
  "lowerDescription"    TEXT,
  "fixedLingualPresent" BOOLEAN NOT NULL DEFAULT false,
  "fixedLingualGauge"   "OrthoRetainerArchwireGauge",
  "regimenDescription"  TEXT NOT NULL DEFAULT '24/7 año 1 · nocturno años 2-5',
  "preSurveyEnabled"    BOOLEAN NOT NULL DEFAULT true,
  "debondedAt"          TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ortho_retention_regimens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ortho_retention_regimens_treatmentPlanId_key"
  ON "ortho_retention_regimens" ("treatmentPlanId");

-- 3.4 ortho_retainer_checkups (G9 auto-schedule 3/6/12/24/36)
CREATE TABLE IF NOT EXISTS "ortho_retainer_checkups" (
  "id"                TEXT NOT NULL,
  "regimenId"         TEXT NOT NULL,
  "clinicId"          TEXT NOT NULL,
  "monthsFromDebond"  INTEGER NOT NULL,
  "scheduledDate"     TIMESTAMP(3) NOT NULL,
  "performedAt"       TIMESTAMP(3),
  "status"            "OrthoRetainerCheckupStatus" NOT NULL DEFAULT 'PROGRAMMED',
  "notes"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ortho_retainer_checkups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ortho_retainer_checkups_regimenId_monthsFromDebond_key"
  ON "ortho_retainer_checkups" ("regimenId", "monthsFromDebond");
CREATE INDEX IF NOT EXISTS "ortho_retainer_checkups_clinicId_scheduledDate_status_idx"
  ON "ortho_retainer_checkups" ("clinicId", "scheduledDate", "status");

-- 3.5 ortho_nps_schedules (G11)
CREATE TABLE IF NOT EXISTS "ortho_nps_schedules" (
  "id"                    TEXT NOT NULL,
  "treatmentPlanId"       TEXT NOT NULL,
  "patientId"             TEXT NOT NULL,
  "clinicId"              TEXT NOT NULL,
  "npsType"               "OrthoNpsType" NOT NULL,
  "scheduledAt"           TIMESTAMP(3) NOT NULL,
  "status"                "OrthoNpsStatus" NOT NULL DEFAULT 'SCHEDULED',
  "sentAt"                TIMESTAMP(3),
  "respondedAt"           TIMESTAMP(3),
  "npsScore"              INTEGER,
  "patientComment"        TEXT,
  "googleReviewTriggered" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ortho_nps_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ortho_nps_schedules_treatmentPlanId_npsType_key"
  ON "ortho_nps_schedules" ("treatmentPlanId", "npsType");
CREATE INDEX IF NOT EXISTS "ortho_nps_schedules_clinicId_status_scheduledAt_idx"
  ON "ortho_nps_schedules" ("clinicId", "status", "scheduledAt");

-- 3.6 ortho_referral_codes (G12 placeholder programa referidos)
CREATE TABLE IF NOT EXISTS "ortho_referral_codes" (
  "id"              TEXT NOT NULL,
  "treatmentPlanId" TEXT NOT NULL,
  "patientId"       TEXT NOT NULL,
  "clinicId"        TEXT NOT NULL,
  "code"            TEXT NOT NULL,
  "referralCount"   INTEGER NOT NULL DEFAULT 0,
  "rewardLabel"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ortho_referral_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ortho_referral_codes_treatmentPlanId_key"
  ON "ortho_referral_codes" ("treatmentPlanId");
CREATE UNIQUE INDEX IF NOT EXISTS "ortho_referral_codes_clinicId_code_key"
  ON "ortho_referral_codes" ("clinicId", "code");
CREATE INDEX IF NOT EXISTS "ortho_referral_codes_clinicId_referralCount_idx"
  ON "ortho_referral_codes" ("clinicId", "referralCount" DESC);

-- ── 4. FOREIGN KEYS ─────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "ortho_quote_scenarios"
    ADD CONSTRAINT "ortho_quote_scenarios_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_quote_scenarios"
    ADD CONSTRAINT "ortho_quote_scenarios_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_quote_scenarios"
    ADD CONSTRAINT "ortho_quote_scenarios_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_sign_at_home_packages"
    ADD CONSTRAINT "ortho_sign_at_home_packages_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_sign_at_home_packages"
    ADD CONSTRAINT "ortho_sign_at_home_packages_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_sign_at_home_packages"
    ADD CONSTRAINT "ortho_sign_at_home_packages_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_sign_at_home_packages"
    ADD CONSTRAINT "ortho_sign_at_home_packages_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_retention_regimens"
    ADD CONSTRAINT "ortho_retention_regimens_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_retention_regimens"
    ADD CONSTRAINT "ortho_retention_regimens_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_retainer_checkups"
    ADD CONSTRAINT "ortho_retainer_checkups_regimenId_fkey"
    FOREIGN KEY ("regimenId") REFERENCES "ortho_retention_regimens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_retainer_checkups"
    ADD CONSTRAINT "ortho_retainer_checkups_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_nps_schedules"
    ADD CONSTRAINT "ortho_nps_schedules_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_nps_schedules"
    ADD CONSTRAINT "ortho_nps_schedules_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_nps_schedules"
    ADD CONSTRAINT "ortho_nps_schedules_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_referral_codes"
    ADD CONSTRAINT "ortho_referral_codes_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_referral_codes"
    ADD CONSTRAINT "ortho_referral_codes_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_referral_codes"
    ADD CONSTRAINT "ortho_referral_codes_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
