-- ═══════════════════════════════════════════════════════════════════
-- Implants — añade tipos de foto granulares al enum ClinicalPhotoType.
--
-- El módulo Implantes 4/5 maneja fases más detalladas que el set inicial
-- pediatrics (implant_site_pre, implant_placement, implant_healing,
-- implant_prosthetic). Esta migración añade el set v2 sin remover los
-- valores existentes (compatibilidad hacia atrás).
--
-- Nuevos valores:
--   pre_surgical, surgical_phase, second_stage, prosthetic_placement,
--   follow_up_radiograph, peri_implant_check
--
-- Cross genéricos:
--   pre_treatment, post_treatment
--
-- IDEMPOTENTE: ALTER TYPE ADD VALUE IF NOT EXISTS (Postgres 12+).
-- ═══════════════════════════════════════════════════════════════════

ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'pre_surgical';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'surgical_phase';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'second_stage';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'prosthetic_placement';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'follow_up_radiograph';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'peri_implant_check';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'pre_treatment';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'post_treatment';
