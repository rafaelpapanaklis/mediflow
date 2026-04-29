-- ═══════════════════════════════════════════════════════════════════
-- Compliance Fase B · Commit 1 — CIE-10 catalog + diagnostics FK
--
-- - cie10_codes: catálogo OMS, tabla GLOBAL (sin clinicId).
-- - medical_record_diagnoses: dx estructurados con FK a CIE-10.
--   Multi-tenant via relation medical_records.clinicId.
-- - El campo legacy medical_records.diagnoses Json? queda intacto.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "cie10_codes" (
  "code"        VARCHAR(8)  PRIMARY KEY,
  "description" VARCHAR(500) NOT NULL,
  "chapter"     VARCHAR(120) NOT NULL
);

CREATE INDEX IF NOT EXISTS "cie10_codes_chapter_idx"
  ON "cie10_codes"("chapter");

CREATE TABLE IF NOT EXISTS "medical_record_diagnoses" (
  "id"              TEXT          PRIMARY KEY,
  "medicalRecordId" TEXT          NOT NULL,
  "cie10Code"       VARCHAR(8)    NOT NULL,
  "isPrimary"       BOOLEAN       NOT NULL DEFAULT FALSE,
  "note"            VARCHAR(500),
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "medical_record_diagnoses_medicalRecordId_fkey"
    FOREIGN KEY ("medicalRecordId") REFERENCES "medical_records"("id") ON DELETE CASCADE,
  CONSTRAINT "medical_record_diagnoses_cie10Code_fkey"
    FOREIGN KEY ("cie10Code") REFERENCES "cie10_codes"("code")
);

CREATE INDEX IF NOT EXISTS "medical_record_diagnoses_medicalRecordId_idx"
  ON "medical_record_diagnoses"("medicalRecordId");
CREATE INDEX IF NOT EXISTS "medical_record_diagnoses_cie10Code_idx"
  ON "medical_record_diagnoses"("cie10Code");
