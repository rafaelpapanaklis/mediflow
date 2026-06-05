-- MediFlow — Mejoras CRM (jun 2026)
-- Run in: https://supabase.com/dashboard/project/nyvcwjdpwxzqlwjwjimv/sql/new
--
-- ADITIVO e idempotente (IF NOT EXISTS). No crea tablas nuevas: todas las
-- métricas CRM (LTV, churn, cohortes) se calculan de modelos existentes
-- (Invoice/Payment/Appointment/NoShowPrediction). Por eso NO requiere RLS extra.
--
-- ⚠️ RAFAEL: correr este SQL en Supabase ANTES del deploy.

-- Pacientes: fuente de adquisición + etapa de ciclo de vida + control de
-- mensaje de cumpleaños (para no repetir el mismo año).
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS "source"            TEXT,
  ADD COLUMN IF NOT EXISTS "lifecycleStage"    TEXT DEFAULT 'patient',
  ADD COLUMN IF NOT EXISTS "lastBirthdayMsgAt" TIMESTAMP(3);

-- Clínicas: toggles de automatización CRM. Default OFF — ningún cron envía
-- nada hasta que la clínica los active desde Configuración.
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS "birthdayMsgActive"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "postApptFollowupActive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "noShowTaskActive"       BOOLEAN NOT NULL DEFAULT false;
