-- ═══════════════════════════════════════════════════════════════════════
-- Fotos clínicas (módulo general) — Ficha del paciente v3 — 2026-07-20
-- ⚠️ REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase ANTES de
--    probar el preview y ANTES del merge de feat/ficha-paciente-v3.
--    El código lee los enums nuevos y la columna "sizeBytes"; sin este SQL
--    fallan el tab Fotos clínicas Y la cuota de storage (storage-quota.ts
--    agrega clinical_photos → también bloquearía subir radiografías).
--
-- Tipos/tabla verificados contra el DDL real de
-- prisma/migrations/20260505140000_clinical_shared_modules/migration.sql:
--   TYPE "ClinicalModule" · TYPE "ClinicalPhotoType" · TABLE "clinical_photos".
--
-- IDEMPOTENTE: ALTER TYPE ... ADD VALUE IF NOT EXISTS, ADD COLUMN IF NOT
-- EXISTS, CREATE INDEX IF NOT EXISTS. Re-ejecutable sin efectos colaterales.
-- Nota PG12+: ADD VALUE puede correr en transacción mientras el valor nuevo
-- no se USE en la misma transacción (aquí solo se agregan).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Enum ClinicalModule += 'general' ────────────────────────────────
ALTER TYPE "ClinicalModule" ADD VALUE IF NOT EXISTS 'general';

-- ── 2. Enum ClinicalPhotoType += 9 vistas extraorales/intraorales ──────
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'extraoral_front';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'extraoral_smile';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'extraoral_profile_right';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'extraoral_profile_left';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'intraoral_front';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'intraoral_lateral_right';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'intraoral_lateral_left';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'occlusal_upper';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'occlusal_lower';

-- ── 3. clinical_photos."sizeBytes" (bytes almacenados post-compresión) ──
-- Nullable a propósito: fotos previas no lo registran y no suman cuota.
ALTER TABLE "clinical_photos" ADD COLUMN IF NOT EXISTS "sizeBytes" integer;

-- ── 4. Índice (clinicId, patientId, module) ────────────────────────────
-- Ya existe desde la migración clinical_shared_modules; el IF NOT EXISTS
-- lo vuelve inofensivo si el entorno viniera de un db push parcial.
CREATE INDEX IF NOT EXISTS "clinical_photos_clinicId_patientId_module_idx"
  ON "clinical_photos" ("clinicId", "patientId", "module");

-- RLS: clinical_photos YA está bajo deny-all (rls-deny-all-policies.sql /
-- migración clinical_shared_modules). NO se agregan policies por clinicId:
-- el aislamiento multi-tenant va en código (Prisma via service role).
