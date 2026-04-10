-- Migration: Telemedicine support (Daily.co video + Stripe Connect payments)

-- 1. Create AppointmentMode enum
DO $$ BEGIN
  CREATE TYPE "AppointmentMode" AS ENUM ('IN_PERSON', 'TELECONSULTATION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add telemedicine fields to appointments
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS mode "AppointmentMode" NOT NULL DEFAULT 'IN_PERSON';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "teleRoomId" text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "teleRoomUrl" text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "teleDoctorToken" text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "telePatientToken" text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "teleRecordingUrl" text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "paymentStatus" text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "paymentAmount" double precision;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "stripePaymentId" text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "stripeSessionId" text;

-- 3. Add Stripe Connect fields to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS "stripeAccountId" text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "stripeOnboarded" boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "teleconsultPrice" double precision;

-- 4. Add telemedicine fields to clinics
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS "teleEnabled" boolean NOT NULL DEFAULT false;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS "teleCommissionPct" double precision NOT NULL DEFAULT 15;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS "dailyApiKey" text;
