-- Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t10, hallazgo H19 de la
-- revisión en vivo ws1-t9). Análisis facial en fotos (línea E, ángulo
-- nasolabial, línea media): un registro por caso+vista (perfil/frente),
-- reemplazable al volver a marcar. Aditivo e idempotente. SIN bloques DO
-- (el editor SQL de Rafael no los acepta). Pégalo tal cual en Supabase →
-- SQL Editor.
--
-- NO lo aplica la terminal. El código tolera que esta tabla todavía no
-- exista (P2021/P2022): mientras no se pegue, el panel de fotos con líneas
-- muestra "aún no guardado" en vez de romper la ficha del paciente.

CREATE TABLE IF NOT EXISTS "orthodontic_facial_analyses" (
  "id" TEXT PRIMARY KEY,
  "treatmentPlanId" TEXT NOT NULL REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE,
  "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "view" TEXT NOT NULL,
  "points" JSONB NOT NULL DEFAULT '{}',
  "imageWidth" INTEGER,
  "imageHeight" INTEGER,
  "measurements" JSONB NOT NULL DEFAULT '{}',
  "calibrationPxPerMm" DOUBLE PRECISION,
  "photoFileId" TEXT REFERENCES "patient_files"("id") ON DELETE SET NULL,
  "createdByUserId" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "orthodontic_facial_analyses_treatmentPlanId_view_key"
  ON "orthodontic_facial_analyses" ("treatmentPlanId", "view");
CREATE INDEX IF NOT EXISTS "orthodontic_facial_analyses_clinicId_idx"
  ON "orthodontic_facial_analyses" ("clinicId");
CREATE INDEX IF NOT EXISTS "orthodontic_facial_analyses_patientId_idx"
  ON "orthodontic_facial_analyses" ("patientId");

ALTER TABLE "orthodontic_facial_analyses"
  DROP CONSTRAINT IF EXISTS "orthodontic_facial_analyses_view_check";
ALTER TABLE "orthodontic_facial_analyses"
  ADD CONSTRAINT "orthodontic_facial_analyses_view_check"
  CHECK ("view" IN ('PERFIL', 'FRENTE'));
