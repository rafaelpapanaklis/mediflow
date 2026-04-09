-- ══════════════════════════════════════════════════════════════════════
-- MediFlow — Features 8: Periodontal, Odontograma infantil, Portal pago,
-- Recordatorio anual, Admin dashboard, Churn, Onboarding, Suscripciones
-- Run in: https://supabase.com/dashboard/project/nyvcwjdpwxzqlwjwjimv/sql/new
-- ══════════════════════════════════════════════════════════════════════

-- 1. Patient: add isChild flag
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS "isChild" BOOLEAN DEFAULT false;

-- 2. Clinic: subscription + recall fields
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS "subscriptionStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "subscriptionId"     TEXT,
  ADD COLUMN IF NOT EXISTS "nextBillingDate"    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "monthlyPrice"       FLOAT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "recallMonths"       INTEGER DEFAULT 6,
  ADD COLUMN IF NOT EXISTS "recallActive"       BOOLEAN DEFAULT false;

-- 3. Periodontal records
CREATE TABLE IF NOT EXISTS periodontal_records (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "patientId"    TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  "clinicId"     TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  "doctorId"     TEXT NOT NULL REFERENCES users(id),
  "recordedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  measurements   JSONB NOT NULL DEFAULT '{}',
  "plaquIndex"   FLOAT,
  "bleedingIndex" FLOAT,
  notes          TEXT,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Subscription invoices
CREATE TABLE IF NOT EXISTS subscription_invoices (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "clinicId"     TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  amount         FLOAT NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'MXN',
  status         TEXT NOT NULL DEFAULT 'pending',
  method         TEXT,
  reference      TEXT,
  "periodStart"  TIMESTAMPTZ NOT NULL,
  "periodEnd"    TIMESTAMPTZ NOT NULL,
  "paidAt"       TIMESTAMPTZ,
  notes          TEXT,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_periodontal_patient ON periodontal_records("patientId");
CREATE INDEX IF NOT EXISTS idx_periodontal_clinic  ON periodontal_records("clinicId");
CREATE INDEX IF NOT EXISTS idx_sub_invoices_clinic ON subscription_invoices("clinicId", status);

-- Add lastLogin to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "lastLogin" TIMESTAMPTZ;

-- Add patientPhone, message, type default to whatsapp_reminders
ALTER TABLE whatsapp_reminders
  ADD COLUMN IF NOT EXISTS "patientPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "message"      TEXT;

-- Make appointmentId nullable (if it exists as NOT NULL)
ALTER TABLE whatsapp_reminders
  ALTER COLUMN "appointmentId" DROP NOT NULL;

-- Make scheduledFor have a default value
ALTER TABLE whatsapp_reminders
  ALTER COLUMN "scheduledFor" SET DEFAULT NOW();

-- Add type default if column exists
UPDATE whatsapp_reminders SET type = 'APPOINTMENT' WHERE type IS NULL;
