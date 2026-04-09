-- MediFlow — Audit Log + Google Reviews + Portal mejorado
-- https://supabase.com/dashboard/project/nyvcwjdpwxzqlwjwjimv/sql/new

-- 1. Audit log table
CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "clinicId"   TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  "userId"     TEXT NOT NULL REFERENCES users(id),
  "entityType" TEXT NOT NULL,
  "entityId"   TEXT NOT NULL,
  action       TEXT NOT NULL,
  changes      JSONB,
  "ipAddress"  TEXT,
  "userAgent"  TEXT,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_clinic_entity ON audit_logs("clinicId", "entityType", "entityId");
CREATE INDEX IF NOT EXISTS idx_audit_clinic_date   ON audit_logs("clinicId", "createdAt" DESC);

-- 2. Google Place ID on clinics
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS "googlePlaceId" TEXT;
