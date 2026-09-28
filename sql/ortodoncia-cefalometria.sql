-- Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026).
-- H1 cefalometría manual, H3 superposición antes/después, H4 normas
-- mexicanas. Aditivo e idempotente. SIN bloques DO (el editor SQL de
-- Rafael no los acepta). Pégalo tal cual en Supabase → SQL Editor.
--
-- NO lo aplica la terminal. El código tolera que esta tabla/columna todavía
-- no exista (P2021/P2022): mientras no se pegue, los paneles de H1/H3
-- muestran "aún no configurado" en vez de romper la ficha del paciente.

-- 1) Nueva categoría de archivo: radiografía lateral de cráneo. Distinta de
--    CEPH_ANALYSIS_PDF (que ya existe, para el PDF de trazado que entrega
--    el centro radiológico).
ALTER TYPE "FileCategory" ADD VALUE IF NOT EXISTS 'XRAY_CEPHALOMETRIC';

-- 2) Tabla de análisis cefalométricos. Un caso puede tener varios (inicial,
--    progreso, final) para la superposición de H3.
CREATE TABLE IF NOT EXISTS "orthodontic_cephalometry_analyses" (
  "id" TEXT PRIMARY KEY,
  "treatmentPlanId" TEXT NOT NULL REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE,
  "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL DEFAULT 'INITIAL',
  "analysisType" TEXT NOT NULL DEFAULT 'STEINER',
  "normSet" TEXT NOT NULL DEFAULT 'STANDARD',
  "points" JSONB NOT NULL DEFAULT '{}',
  "measurements" JSONB NOT NULL DEFAULT '{}',
  "calibrationMmPerPixel" DOUBLE PRECISION,
  "lateralXrayFileId" TEXT REFERENCES "patient_files"("id") ON DELETE SET NULL,
  "tracingPdfFileId" TEXT REFERENCES "patient_files"("id") ON DELETE SET NULL,
  "createdByUserId" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "orthodontic_cephalometry_analyses_treatmentPlanId_idx"
  ON "orthodontic_cephalometry_analyses" ("treatmentPlanId");
CREATE INDEX IF NOT EXISTS "orthodontic_cephalometry_analyses_clinicId_idx"
  ON "orthodontic_cephalometry_analyses" ("clinicId");
CREATE INDEX IF NOT EXISTS "orthodontic_cephalometry_analyses_patientId_idx"
  ON "orthodontic_cephalometry_analyses" ("patientId");

-- 3) Restricciones de valor (CHECK), idempotentes vía DROP + ADD.
ALTER TABLE "orthodontic_cephalometry_analyses"
  DROP CONSTRAINT IF EXISTS "orthodontic_cephalometry_analyses_kind_check";
ALTER TABLE "orthodontic_cephalometry_analyses"
  ADD CONSTRAINT "orthodontic_cephalometry_analyses_kind_check"
  CHECK ("kind" IN ('INITIAL', 'PROGRESS', 'FINAL'));

ALTER TABLE "orthodontic_cephalometry_analyses"
  DROP CONSTRAINT IF EXISTS "orthodontic_cephalometry_analyses_analysisType_check";
ALTER TABLE "orthodontic_cephalometry_analyses"
  ADD CONSTRAINT "orthodontic_cephalometry_analyses_analysisType_check"
  CHECK ("analysisType" IN ('STEINER', 'RICKETTS', 'MCNAMARA'));

ALTER TABLE "orthodontic_cephalometry_analyses"
  DROP CONSTRAINT IF EXISTS "orthodontic_cephalometry_analyses_normSet_check";
ALTER TABLE "orthodontic_cephalometry_analyses"
  ADD CONSTRAINT "orthodontic_cephalometry_analyses_normSet_check"
  CHECK ("normSet" IN ('STANDARD', 'MEXICAN'));
