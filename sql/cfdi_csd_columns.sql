-- CFDI · Feature 1 — Certificados CSD por clínica
-- Agrega el estado del CSD (Certificado de Sello Digital) subido a Facturapi.
-- Aditivo y no destructivo (IF NOT EXISTS). Aplicar en Supabase → SQL Editor.
--
-- Nombres de columna en camelCase citado porque el modelo Prisma Clinic no usa
-- @map en estos campos (igual que "facturApiEnabled").

ALTER TABLE "clinics"
  ADD COLUMN IF NOT EXISTS "csdUploaded"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "csdValidUntil" TIMESTAMP(3);
