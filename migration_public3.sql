-- ══════════════════════════════════════════════════════════════════
-- MediFlow — Public Directory + Doctor Services
-- Run in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- Clinic: add isPublic flag and description
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS "isPublic"    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS description   TEXT;

-- User: add services array (treatments/procedures the doctor performs)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS services TEXT[] DEFAULT '{}';

-- Index for fast public clinic search
CREATE INDEX IF NOT EXISTS clinics_public_idx    ON clinics("isPublic");
CREATE INDEX IF NOT EXISTS clinics_specialty_idx ON clinics(specialty);
CREATE INDEX IF NOT EXISTS clinics_city_idx      ON clinics(city);
