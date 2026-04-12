-- Migration: Procedure catalog for per-clinic pricing

CREATE TABLE IF NOT EXISTS procedure_catalog (
  id text PRIMARY KEY DEFAULT ('c' || replace(gen_random_uuid()::text, '-', '')),
  "clinicId" text NOT NULL,
  name text NOT NULL,
  code text,
  category text NOT NULL DEFAULT 'general',
  "basePrice" double precision NOT NULL,
  duration integer,
  description text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_pc_clinic FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS procedure_catalog_clinic_active ON procedure_catalog("clinicId", "isActive");
