-- prescription-ai-check.sql
-- IA de contraindicaciones al recetar (WS1-T3, 2026-06-11).
-- Aplicar tras el push:  psql "$DATABASE_URL" -f sql/prescription-ai-check.sql
-- Idempotente: seguro de re-ejecutar.

-- 1) Evidencia del chequeo IA guardada al emitir la receta.
--    NUNCA se expone en la verificación pública (el endpoint /verify no la
--    selecciona). Prisma: Prescription.aiCheck Json?
ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS "aiCheck" jsonb;

-- 2) Cache de chequeos IA — evita cobrar dos veces el mismo análisis cuando se
--    revisa el mismo paciente con la misma lista de medicamentos.
--    Key = SHA256(clinicId + patientId + contexto clínico normalizado + meds).
--    Prisma: model PrescriptionAiCheck @@map("prescription_ai_checks")
CREATE TABLE IF NOT EXISTS prescription_ai_checks (
  "hash"      varchar(64)  PRIMARY KEY,
  "clinicId"  text         NOT NULL,
  "patientId" text         NOT NULL,
  "result"    jsonb        NOT NULL,
  "model"     varchar(60)  NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "prescription_ai_checks_clinicId_idx"
  ON prescription_ai_checks ("clinicId");
