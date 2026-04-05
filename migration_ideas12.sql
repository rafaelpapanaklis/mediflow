-- ══════════════════════════════════════════════════════════════════
-- MediFlow — Idea 1 + 2: Treatment Plans + Public Booking
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- Treatment status enum
DO $$ BEGIN
  CREATE TYPE "TreatmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED', 'PAUSED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Treatment plans table
CREATE TABLE IF NOT EXISTS treatment_plans (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "clinicId"            TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  "patientId"           TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  "doctorId"            TEXT NOT NULL REFERENCES users(id),
  name                  TEXT NOT NULL,
  description           TEXT,
  "totalSessions"       INTEGER NOT NULL DEFAULT 1,
  "sessionIntervalDays" INTEGER NOT NULL DEFAULT 30,
  "totalCost"           FLOAT NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'ACTIVE',
  "startDate"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "endDate"             TIMESTAMPTZ,
  "lastFollowUpSent"    TIMESTAMPTZ,
  "nextExpectedDate"    TIMESTAMPTZ,
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Treatment sessions table
CREATE TABLE IF NOT EXISTS treatment_sessions (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "treatmentId"   TEXT NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  "sessionNumber" INTEGER NOT NULL,
  notes           TEXT,
  "completedAt"   TIMESTAMPTZ,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS treatment_plans_clinic_idx  ON treatment_plans("clinicId");
CREATE INDEX IF NOT EXISTS treatment_plans_patient_idx ON treatment_plans("patientId");
CREATE INDEX IF NOT EXISTS treatment_plans_doctor_idx  ON treatment_plans("doctorId");
CREATE INDEX IF NOT EXISTS treatment_plans_status_idx  ON treatment_plans(status);
CREATE INDEX IF NOT EXISTS treatment_plans_next_idx    ON treatment_plans("nextExpectedDate");
CREATE INDEX IF NOT EXISTS treatment_sessions_plan_idx ON treatment_sessions("treatmentId");
