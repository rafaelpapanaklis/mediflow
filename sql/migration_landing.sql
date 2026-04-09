-- MediFlow — Landing page por clínica
-- Run in: https://supabase.com/dashboard/project/nyvcwjdpwxzqlwjwjimv/sql/new

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS "landingActive"       BOOLEAN   DEFAULT false,
  ADD COLUMN IF NOT EXISTS "landingThemeColor"   TEXT      DEFAULT '#2563eb',
  ADD COLUMN IF NOT EXISTS "landingCoverUrl"     TEXT,
  ADD COLUMN IF NOT EXISTS "landingGallery"      TEXT[]    DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "landingTestimonials" JSONB,
  ADD COLUMN IF NOT EXISTS "landingFaqs"         JSONB,
  ADD COLUMN IF NOT EXISTS "landingServices"     JSONB,
  ADD COLUMN IF NOT EXISTS "landingHours"        JSONB,
  ADD COLUMN IF NOT EXISTS "landingWhatsapp"     TEXT,
  ADD COLUMN IF NOT EXISTS "landingInstagram"    TEXT,
  ADD COLUMN IF NOT EXISTS "landingFacebook"     TEXT,
  ADD COLUMN IF NOT EXISTS "landingTiktok"       TEXT,
  ADD COLUMN IF NOT EXISTS "landingMapEmbed"     TEXT,
  ADD COLUMN IF NOT EXISTS "landingTagline"      TEXT;

-- Ensure slug is unique (should already be, but just in case)
CREATE UNIQUE INDEX IF NOT EXISTS clinics_slug_key ON clinics(slug);
