-- ═══════════════════════════════════════════════════════════════════
-- Implants — añade tipos de recordatorio granulares al enum
-- ClinicalReminderType. Set v2 para el módulo Implantes 4/5.
--
-- Nuevos valores (5):
--   implant_cicatrizacion_7d       — control de cicatrización 7d post-cirugía
--   implant_retiro_sutura_10d      — retiro de sutura 10d post-cirugía
--   implant_oseointegracion_4m     — control oseointegración a 4m
--   implant_control_anual          — control anual del implante
--   implant_peri_implantitis_6m    — control peri-implantario semestral
--
-- Los valores existentes (implant_followup_1m / 6m / 1y) se conservan
-- para compatibilidad — pueden coexistir con los granulares.
--
-- IDEMPOTENTE: ALTER TYPE ADD VALUE IF NOT EXISTS (Postgres 12+).
-- ═══════════════════════════════════════════════════════════════════

ALTER TYPE "ClinicalReminderType" ADD VALUE IF NOT EXISTS 'implant_cicatrizacion_7d';
ALTER TYPE "ClinicalReminderType" ADD VALUE IF NOT EXISTS 'implant_retiro_sutura_10d';
ALTER TYPE "ClinicalReminderType" ADD VALUE IF NOT EXISTS 'implant_oseointegracion_4m';
ALTER TYPE "ClinicalReminderType" ADD VALUE IF NOT EXISTS 'implant_control_anual';
ALTER TYPE "ClinicalReminderType" ADD VALUE IF NOT EXISTS 'implant_peri_implantitis_6m';
