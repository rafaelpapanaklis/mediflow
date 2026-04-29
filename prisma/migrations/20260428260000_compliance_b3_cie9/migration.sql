-- ═══════════════════════════════════════════════════════════════════
-- Compliance Fase B · Commit 3 — CIE-9-MC procedimientos clínicos
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "cie9_codes" (
  "code"        VARCHAR(8)  PRIMARY KEY,
  "description" VARCHAR(500) NOT NULL,
  "category"    VARCHAR(120) NOT NULL
);

CREATE INDEX IF NOT EXISTS "cie9_codes_category_idx"
  ON "cie9_codes"("category");

ALTER TABLE "procedure_catalog"
  ADD COLUMN IF NOT EXISTS "cieCode" VARCHAR(8);

CREATE INDEX IF NOT EXISTS "procedure_catalog_cieCode_idx"
  ON "procedure_catalog"("cieCode");

-- FK opcional (cieCode nullable, no enforced para no romper datos legacy)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'procedure_catalog_cieCode_fkey'
  ) THEN
    ALTER TABLE "procedure_catalog"
      ADD CONSTRAINT "procedure_catalog_cieCode_fkey"
      FOREIGN KEY ("cieCode") REFERENCES "cie9_codes"("code")
      ON DELETE SET NULL;
  END IF;
END$$;
