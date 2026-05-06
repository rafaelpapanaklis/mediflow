-- ═══════════════════════════════════════════════════════════════════
-- Implants — catálogo personalizado de marcas/modelos por clínica.
--
-- Cada ImplantCatalogModel cubre una combinación marca+modelo (ej.
-- Straumann SLActive, Zimmer T3, Nobel Replace) con sus dimensiones
-- estándar (diámetros y longitudes disponibles) y plataformas. Sirve
-- como selector al crear un Implant.
--
-- IDEMPOTENTE: usa IF NOT EXISTS, DO $$ guards.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "implant_catalog_models" (
  "id"               TEXT PRIMARY KEY,
  "clinicId"         TEXT NOT NULL,
  "brand"            "ImplantBrand" NOT NULL,
  "brandCustomName"  TEXT,
  "modelName"        TEXT NOT NULL,
  "platforms"        TEXT[] NOT NULL DEFAULT '{}',
  "diametersMm"      DECIMAL(3,1)[] NOT NULL DEFAULT '{}',
  "lengthsMm"        DECIMAL(4,1)[] NOT NULL DEFAULT '{}',
  "surfaceTreatment" "ImplantSurfaceTreatment",
  "connectionType"   "ImplantConnectionType",
  "notes"            TEXT,
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "createdBy"        TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "deletedAt"        TIMESTAMP(3)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'implant_catalog_models_clinicId_fkey'
  ) THEN
    ALTER TABLE "implant_catalog_models"
      ADD CONSTRAINT "implant_catalog_models_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "implant_catalog_models_clinicId_brand_modelName_key"
  ON "implant_catalog_models" ("clinicId", "brand", "modelName");
CREATE INDEX IF NOT EXISTS "implant_catalog_models_clinicId_isActive_idx"
  ON "implant_catalog_models" ("clinicId", "isActive");
