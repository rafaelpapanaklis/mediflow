-- ══════════════════════════════════════════════════════════════════════
-- MediFlow — Features 6: Radiografías, WhatsApp bidireccional,
-- Pagos a plazos, Dashboard KPIs, Fotos, Consentimientos
-- Run in: https://supabase.com/dashboard/project/nyvcwjdpwxzqlwjwjimv/sql/new
-- ══════════════════════════════════════════════════════════════════════

-- 1. Upgrade patient_files table
ALTER TABLE patient_files
  ADD COLUMN IF NOT EXISTS "clinicId"    TEXT,
  ADD COLUMN IF NOT EXISTS "uploadedBy"  TEXT,
  ADD COLUMN IF NOT EXISTS "toothNumber" INTEGER,
  ADD COLUMN IF NOT EXISTS "notes"       TEXT,
  ADD COLUMN IF NOT EXISTS "takenAt"     TIMESTAMPTZ;

-- Create FileCategory enum
DO $$ BEGIN
  CREATE TYPE "FileCategory" AS ENUM (
    'XRAY_PERIAPICAL','XRAY_PANORAMIC','XRAY_BITEWING','XRAY_OCCLUSAL',
    'PHOTO_FRONTAL','PHOTO_LATERAL','PHOTO_OCCLUSAL_UPPER','PHOTO_OCCLUSAL_LOWER',
    'PHOTO_INTRAORAL','CONSENT_FORM','OTHER'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE patient_files
  ADD COLUMN IF NOT EXISTS "category" "FileCategory" DEFAULT 'OTHER';

-- 2. WhatsApp bidirectional reply
ALTER TABLE whatsapp_reminders
  ADD COLUMN IF NOT EXISTS "patientReply" TEXT,
  ADD COLUMN IF NOT EXISTS "repliedAt"    TIMESTAMPTZ;

-- 3. Payment plans
CREATE TABLE IF NOT EXISTS payment_plans (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "clinicId"   TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  "patientId"  TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  "invoiceId"  TEXT,
  name         TEXT NOT NULL,
  "totalAmount"  FLOAT NOT NULL,
  "downPayment"  FLOAT NOT NULL DEFAULT 0,
  installments INTEGER NOT NULL DEFAULT 12,
  frequency    TEXT NOT NULL DEFAULT 'MONTHLY',
  "startDate"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_payments (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "planId"    TEXT NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
  installment INTEGER NOT NULL,
  amount      FLOAT NOT NULL,
  "dueDate"   TIMESTAMPTZ NOT NULL,
  "paidAt"    TIMESTAMPTZ,
  method      TEXT,
  notes       TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Consent forms
CREATE TABLE IF NOT EXISTS consent_forms (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "clinicId"     TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  "patientId"    TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  procedure      TEXT NOT NULL,
  content        TEXT NOT NULL,
  "signedAt"     TIMESTAMPTZ,
  "signatureUrl" TEXT,
  token          TEXT NOT NULL UNIQUE,
  "expiresAt"    TIMESTAMPTZ NOT NULL,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_patient_files_patient ON patient_files("patientId");
CREATE INDEX IF NOT EXISTS idx_patient_files_clinic  ON patient_files("clinicId");
CREATE INDEX IF NOT EXISTS idx_payment_plans_patient ON payment_plans("patientId");
CREATE INDEX IF NOT EXISTS idx_payment_plans_clinic  ON payment_plans("clinicId");
CREATE INDEX IF NOT EXISTS idx_plan_payments_plan    ON plan_payments("planId");
CREATE INDEX IF NOT EXISTS idx_consent_forms_patient ON consent_forms("patientId");
CREATE INDEX IF NOT EXISTS idx_consent_forms_token   ON consent_forms(token);
