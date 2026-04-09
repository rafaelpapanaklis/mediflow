-- ============================================================================
-- Migration: Multi-Category Schema + New Models
-- Description: Adds ClinicCategory enum, new clinic/patient fields,
--              and 7 new tables for multi-category support
-- ============================================================================

-- ── 1. Create ClinicCategory enum ──────────────────────────────────────────
CREATE TYPE clinic_category AS ENUM (
  'DENTAL', 'MEDICINE', 'NUTRITION', 'PSYCHOLOGY', 'DERMATOLOGY',
  'AESTHETIC_MEDICINE', 'HAIR_RESTORATION', 'BEAUTY_CENTER', 'BROW_LASH',
  'MASSAGE', 'LASER_HAIR_REMOVAL', 'HAIR_SALON', 'ALTERNATIVE_MEDICINE',
  'NAIL_SALON', 'SPA', 'PHYSIOTHERAPY', 'PODIATRY', 'OTHER'
);

-- ── 2. Add category column to clinics ──────────────────────────────────────
ALTER TABLE clinics ADD COLUMN category clinic_category DEFAULT 'OTHER';

-- ── 3. Backfill category from existing specialty field ─────────────────────
UPDATE clinics SET category = CASE
  WHEN lower(specialty) LIKE '%dental%' OR lower(specialty) LIKE '%odonto%' THEN 'DENTAL'::clinic_category
  WHEN lower(specialty) LIKE '%medic%' THEN 'MEDICINE'::clinic_category
  WHEN lower(specialty) LIKE '%nutri%' THEN 'NUTRITION'::clinic_category
  WHEN lower(specialty) LIKE '%psic%' OR lower(specialty) LIKE '%psych%' THEN 'PSYCHOLOGY'::clinic_category
  WHEN lower(specialty) LIKE '%derma%' THEN 'DERMATOLOGY'::clinic_category
  ELSE 'OTHER'::clinic_category
END;

-- ── 4. Add new patient fields ──────────────────────────────────────────────
ALTER TABLE patients ADD COLUMN skin_phototype VARCHAR;
ALTER TABLE patients ADD COLUMN hair_type VARCHAR;
ALTER TABLE patients ADD COLUMN nail_condition VARCHAR;
ALTER TABLE patients ADD COLUMN pain_areas JSONB;
ALTER TABLE patients ADD COLUMN mobility_notes VARCHAR;
ALTER TABLE patients ADD COLUMN diabetic_risk VARCHAR;
ALTER TABLE patients ADD COLUMN dosha_type VARCHAR;
ALTER TABLE patients ADD COLUMN preferred_pressure INTEGER;

-- ── 5. Create before_after_photos table ────────────────────────────────────
CREATE TABLE before_after_photos (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  category TEXT NOT NULL,       -- "before" | "after"
  angle TEXT NOT NULL,          -- "front", "left", "right", "top"
  session_id TEXT,
  url TEXT NOT NULL,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

CREATE INDEX idx_before_after_photos_patient_category ON before_after_photos(patient_id, category);
CREATE INDEX idx_before_after_photos_clinic ON before_after_photos(clinic_id);

-- ── 6. Create service_packages table ───────────────────────────────────────
CREATE TABLE service_packages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  total_sessions INTEGER NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  valid_days INTEGER NOT NULL DEFAULT 365,
  body_zone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_service_packages_clinic ON service_packages(clinic_id);

-- ── 7. Create package_redemptions table ────────────────────────────────────
CREATE TABLE package_redemptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  package_id TEXT NOT NULL REFERENCES service_packages(id),
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  clinic_id TEXT NOT NULL,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  sessions_used INTEGER NOT NULL DEFAULT 0,
  total_sessions INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE INDEX idx_package_redemptions_patient ON package_redemptions(patient_id);
CREATE INDEX idx_package_redemptions_clinic ON package_redemptions(clinic_id);

-- ── 8. Create formula_records table ────────────────────────────────────────
CREATE TABLE formula_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  type TEXT NOT NULL,            -- "hair_color", "lash_extension", "brow_tint", "herbal"
  formula JSONB NOT NULL,
  notes TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by TEXT
);

CREATE INDEX idx_formula_records_patient_type ON formula_records(patient_id, type);
CREATE INDEX idx_formula_records_clinic ON formula_records(clinic_id);

-- ── 9. Create body_map_annotations table ───────────────────────────────────
CREATE TABLE body_map_annotations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  record_id TEXT,
  map_type TEXT NOT NULL,        -- "full_body", "face", "scalp", "feet_dorsal", "feet_plantar"
  annotations JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_body_map_annotations_patient ON body_map_annotations(patient_id);
CREATE INDEX idx_body_map_annotations_clinic ON body_map_annotations(clinic_id);

-- ── 10. Create walk_in_queue table ─────────────────────────────────────────
CREATE TABLE walk_in_queue (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id TEXT,
  patient_name TEXT NOT NULL,
  service TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'WAITING',
  assigned_to TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_walk_in_queue_clinic_status ON walk_in_queue(clinic_id, status);

-- ── 11. Create resource_bookings table ─────────────────────────────────────
CREATE TABLE resource_bookings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id TEXT,
  resource_type TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_resource_bookings_clinic_type_time ON resource_bookings(clinic_id, resource_type, start_time);
