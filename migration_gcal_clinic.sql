-- ══════════════════════════════════════════════════════════════════
-- MediFlow — Clinic-level Google Calendar
-- Run in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS "googleCalendarToken"    TEXT,
  ADD COLUMN IF NOT EXISTS "googleRefreshToken"     TEXT,
  ADD COLUMN IF NOT EXISTS "googleCalendarEmail"    TEXT,
  ADD COLUMN IF NOT EXISTS "googleCalendarEnabled"  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "googleClinicCalendarId" TEXT;
