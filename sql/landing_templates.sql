-- Plantillas de landing pública (T1 — fundación)
-- ADITIVO y seguro de re-ejecutar (IF NOT EXISTS).
-- OJO: el modelo Prisma `Clinic` usa @@map("clinics"); la tabla real es "clinics".
ALTER TABLE "clinics"
  ADD COLUMN IF NOT EXISTS "landingTemplate" TEXT DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS "landingYearsExperience" INTEGER,
  ADD COLUMN IF NOT EXISTS "landingPatients" TEXT;
