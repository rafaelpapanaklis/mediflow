-- ═══════════════════════════════════════════════════════════
-- Mi Clínica Visual — layout isométrico + modo público En Vivo
-- ═══════════════════════════════════════════════════════════
-- Cada clínica tiene 1 layout (1:1) con elementos isométricos. Los sillones
-- del layout SON Resources de tipo CHAIR existentes (1 source of truth) —
-- en el JSON.elements el item con type='chair' contiene resourceId que
-- apunta al Resource real. Para otros tipos (paredes, puertas, lavabos),
-- resourceId es null.
--
-- También agregamos 4 columnas a clinics para exponer una URL pública
-- /live/<slug> con password opcional + toggle de privacidad.
--
-- Idempotente: seguro de correr múltiples veces.

-- ─── 1. Columnas live mode en clinics ──────────────────────
ALTER TABLE "clinics"
  ADD COLUMN IF NOT EXISTS "liveModeSlug"             TEXT,
  ADD COLUMN IF NOT EXISTS "liveModePassword"         TEXT,
  ADD COLUMN IF NOT EXISTS "liveModeEnabled"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "liveModeShowPatientNames" BOOLEAN NOT NULL DEFAULT false;

-- Unique index sobre liveModeSlug (Postgres permite múltiples NULL en UNIQUE).
CREATE UNIQUE INDEX IF NOT EXISTS "clinics_liveModeSlug_key"
  ON "clinics"("liveModeSlug");

-- ─── 2. ClinicLayout ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "clinic_layouts" (
  "id"        TEXT         NOT NULL,
  "clinicId"  TEXT         NOT NULL,
  "name"      VARCHAR(120) NOT NULL DEFAULT 'Layout principal',
  "elements"  JSONB        NOT NULL DEFAULT '[]'::jsonb,
  "metadata"  JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "clinic_layouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "clinic_layouts_clinicId_key"
  ON "clinic_layouts"("clinicId");

DO $$ BEGIN
  ALTER TABLE "clinic_layouts"
    ADD CONSTRAINT "clinic_layouts_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
