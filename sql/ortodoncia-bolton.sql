-- Ortodoncia — H58 de la revisión de lógica de uso (ws1-t8, ronda 6):
-- las medidas de Bolton y el espacio de arco se capturaban y se perdían.
-- Un registro por caso; guardar de nuevo lo reemplaza. Aditivo e idempotente,
-- SIN bloques DO. Pégalo tal cual en Supabase → SQL Editor.
--
-- NO lo aplica la terminal. El código tolera que la tabla aún no exista
-- (P2021): mientras no se pegue, el panel de Bolton avisa «no se pudo guardar»
-- en vez de romper la ficha.

CREATE TABLE IF NOT EXISTS "orthodontic_bolton_analyses" (
  "id" TEXT PRIMARY KEY,
  "treatmentPlanId" TEXT NOT NULL REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE,
  "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "widths" JSONB NOT NULL DEFAULT '{}',
  "upperSpaceMm" DOUBLE PRECISION,
  "lowerSpaceMm" DOUBLE PRECISION,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "orthodontic_bolton_analyses_treatmentPlanId_key"
  ON "orthodontic_bolton_analyses" ("treatmentPlanId");
CREATE INDEX IF NOT EXISTS "orthodontic_bolton_analyses_clinicId_idx"
  ON "orthodontic_bolton_analyses" ("clinicId");
CREATE INDEX IF NOT EXISTS "orthodontic_bolton_analyses_patientId_idx"
  ON "orthodontic_bolton_analyses" ("patientId");
