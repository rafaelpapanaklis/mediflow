-- ═══════════════════════════════════════════════════════════════════
-- Dental cross-módulos — A2: WhatsApp queue + XrayAnalysis modes +
-- PeriImplantAssessment FK (NO crea tabla implants — esa la aporta el
-- módulo Implantología 4/5)
--
-- CONTEXTO
-- 3 cambios cross-módulos del Sprint de Cierre Dental, Track A2:
--
--   1. WhatsAppReminder.payload (Json?) — argumentos dinámicos para que
--      el worker de queue pueda hidratar plantillas con installmentNumber,
--      daysOverdue, amountMxn, etc. sin tener que re-fetchear el contexto.
--
--   2. XrayAnalysis.mode (XrayAnalysisMode) + measurements (Json?) —
--      modos dedicados PERIODONTAL_BONE_LOSS y PERIIMPLANT_BONE_LOSS
--      con captura específica de mediciones por sitio/implante.
--
--   3. PeriImplantAssessment.implantId — FK real hacia `implants(id)`.
--      La tabla `implants` la crea la migración del módulo
--      `feature/implant-module-v1` (`20260504200000_implants_module`).
--      Esta migración asume que esa otra migración ya se aplicó (orden
--      por timestamp lo garantiza tras el merge en `feature/implant-phase-8-v1`).
--
-- IDEMPOTENTE: usa IF NOT EXISTS, DO $$ guards. Re-corrible sin efectos
-- colaterales. Diseñado para Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. WhatsAppReminder.payload ──────────────────────────────────────
ALTER TABLE "whatsapp_reminders"
  ADD COLUMN IF NOT EXISTS "payload" JSONB;

-- ── 2. XrayAnalysis.mode + measurements ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'XrayAnalysisMode') THEN
    CREATE TYPE "XrayAnalysisMode" AS ENUM (
      'GENERAL',
      'PERIODONTAL_BONE_LOSS',
      'PERIIMPLANT_BONE_LOSS'
    );
  END IF;
END $$;

ALTER TABLE "xray_analyses"
  ADD COLUMN IF NOT EXISTS "mode" "XrayAnalysisMode" NOT NULL DEFAULT 'GENERAL';

ALTER TABLE "xray_analyses"
  ADD COLUMN IF NOT EXISTS "measurements" JSONB;

CREATE INDEX IF NOT EXISTS "xray_analyses_mode_idx"
  ON "xray_analyses" ("mode");

-- ── 3. PeriImplantAssessment.implantId FK → implants(id) ─────────────
-- Defensivo: solo agrega la FK si la tabla `implants` existe (creada
-- por la migración del módulo Implantología 4/5). Si no existe, esta
-- migración es no-op para el FK y queda pendiente para cuando llegue
-- el módulo. La columna `implantId` ya existe del modelo periodontics.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'implants') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'peri_implant_assessments_implantId_fkey'
    ) THEN
      ALTER TABLE "peri_implant_assessments"
        ADD CONSTRAINT "peri_implant_assessments_implantId_fkey"
        FOREIGN KEY ("implantId") REFERENCES "implants"("id") ON DELETE SET NULL;
    END IF;
  ELSE
    RAISE NOTICE 'Tabla implants no existe aún — FK peri_implant_assessments_implantId_fkey omitida. Aplica la migración del módulo Implantología y vuelve a correr esta.';
  END IF;
END $$;
