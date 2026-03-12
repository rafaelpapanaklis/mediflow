-- MediFlow — Supabase SQL Setup
-- Ejecuta esto en Supabase > SQL Editor > New query
-- ================================================

-- ENUMS
CREATE TYPE IF NOT EXISTS "Plan"             AS ENUM ('BASIC', 'PRO', 'CLINIC');
CREATE TYPE IF NOT EXISTS "Role"             AS ENUM ('SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'READONLY');
CREATE TYPE IF NOT EXISTS "Gender"           AS ENUM ('M', 'F', 'OTHER');
CREATE TYPE IF NOT EXISTS "PatientStatus"    AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE IF NOT EXISTS "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
CREATE TYPE IF NOT EXISTS "InvoiceStatus"    AS ENUM ('DRAFT', 'PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED');

-- CLINICS
CREATE TABLE IF NOT EXISTS clinics (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  specialty     TEXT NOT NULL,
  country       TEXT NOT NULL DEFAULT 'MX',
  city          TEXT,
  address       TEXT,
  phone         TEXT,
  email         TEXT,
  "logoUrl"     TEXT,
  "taxId"       TEXT,
  plan          "Plan" NOT NULL DEFAULT 'PRO',
  "trialEndsAt" TIMESTAMPTZ,
  "createdAt"   TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ DEFAULT NOW()
);

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "supabaseId" TEXT UNIQUE NOT NULL,
  "clinicId"   TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  "firstName"  TEXT NOT NULL,
  "lastName"   TEXT NOT NULL,
  role         "Role" NOT NULL DEFAULT 'DOCTOR',
  specialty    TEXT,
  "avatarUrl"  TEXT,
  phone        TEXT,
  "isActive"   BOOLEAN DEFAULT TRUE,
  "createdAt"  TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"  TIMESTAMPTZ DEFAULT NOW()
);

-- PATIENTS
CREATE TABLE IF NOT EXISTS patients (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "clinicId"           TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  "patientNumber"      TEXT NOT NULL,
  "firstName"          TEXT NOT NULL,
  "lastName"           TEXT NOT NULL,
  email                TEXT,
  phone                TEXT,
  dob                  TIMESTAMPTZ,
  gender               "Gender" NOT NULL DEFAULT 'OTHER',
  "bloodType"          TEXT,
  address              TEXT,
  "insuranceProvider"  TEXT,
  "insurancePolicy"    TEXT,
  allergies            TEXT[] DEFAULT '{}',
  "chronicConditions"  TEXT[] DEFAULT '{}',
  "currentMedications" TEXT[] DEFAULT '{}',
  tags                 TEXT[] DEFAULT '{}',
  notes                TEXT,
  status               "PatientStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt"          TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE ("clinicId", "patientNumber")
);

-- APPOINTMENTS
CREATE TABLE IF NOT EXISTS appointments (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "clinicId"     TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  "patientId"    TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  "doctorId"     TEXT NOT NULL REFERENCES users(id),
  type           TEXT NOT NULL,
  date           TIMESTAMPTZ NOT NULL,
  "startTime"    TEXT NOT NULL,
  "endTime"      TEXT NOT NULL,
  "durationMins" INT NOT NULL DEFAULT 30,
  room           TEXT,
  status         "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
  notes          TEXT,
  "reminderSent" BOOLEAN DEFAULT FALSE,
  "confirmedAt"  TIMESTAMPTZ,
  "cancelledAt"  TIMESTAMPTZ,
  "cancelReason" TEXT,
  "createdAt"    TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ DEFAULT NOW()
);

-- MEDICAL RECORDS
CREATE TABLE IF NOT EXISTS medical_records (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "clinicId"     TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  "patientId"    TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  "doctorId"     TEXT NOT NULL REFERENCES users(id),
  "visitDate"    TIMESTAMPTZ DEFAULT NOW(),
  subjective     TEXT,
  objective      TEXT,
  assessment     TEXT,
  plan           TEXT,
  diagnoses      JSONB,
  vitals         JSONB,
  "specialtyData" JSONB,
  "isPrivate"    BOOLEAN DEFAULT FALSE,
  "createdAt"    TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ DEFAULT NOW()
);

-- INVOICES
CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "clinicId"      TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  "patientId"     TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  "appointmentId" TEXT UNIQUE REFERENCES appointments(id),
  "invoiceNumber" TEXT NOT NULL,
  items           JSONB NOT NULL,
  subtotal        FLOAT NOT NULL,
  discount        FLOAT NOT NULL DEFAULT 0,
  total           FLOAT NOT NULL,
  paid            FLOAT NOT NULL DEFAULT 0,
  balance         FLOAT NOT NULL,
  status          "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
  "paymentMethod" TEXT,
  notes           TEXT,
  "dueDate"       TIMESTAMPTZ,
  "paidAt"        TIMESTAMPTZ,
  "createdAt"     TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE ("clinicId", "invoiceNumber")
);

-- PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "invoiceId" TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount      FLOAT NOT NULL,
  method      TEXT NOT NULL,
  reference   TEXT,
  notes       TEXT,
  "paidAt"    TIMESTAMPTZ DEFAULT NOW()
);

-- CLINIC SCHEDULES
CREATE TABLE IF NOT EXISTS clinic_schedules (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "clinicId"   TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  "dayOfWeek"  INT NOT NULL,
  enabled      BOOLEAN DEFAULT TRUE,
  "openTime"   TEXT DEFAULT '09:00',
  "closeTime"  TEXT DEFAULT '18:00',
  UNIQUE ("clinicId", "dayOfWeek")
);

-- PATIENT FILES
CREATE TABLE IF NOT EXISTS patient_files (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "patientId" TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  size        INT,
  "mimeType"  TEXT,
  category    TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- AUTO-UPDATE updatedAt triggers
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW."updatedAt" = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['clinics','users','patients','appointments','medical_records','invoices'])
  LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
      CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;

-- Done!
SELECT 'MediFlow tables created successfully' AS status;
