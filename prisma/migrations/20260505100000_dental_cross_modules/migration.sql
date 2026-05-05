-- ═══════════════════════════════════════════════════════════════════
-- Dental cross-módulos — A2: WhatsApp queue + XrayAnalysis modes +
-- PeriImplantAssessment FK + Implant stub model
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
--   3. Implant (modelo stub) + PeriImplantAssessment.implantId FK —
--      el modelo de Implantología (4/5) aún no existe; este stub
--      desbloquea la FK real para que la evaluación periimplantar
--      enlace correctamente cuando llegue el módulo.
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

-- ── 3. Implant (stub) + PeriImplantAssessment FK ─────────────────────
CREATE TABLE IF NOT EXISTS "implants" (
  "id"              TEXT NOT NULL,
  "clinicId"        TEXT NOT NULL,
  "patientId"       TEXT NOT NULL,
  "toothFdi"        INTEGER NOT NULL,
  "brand"           TEXT,
  "model"           TEXT,
  "platform"        TEXT,
  "placedAt"        TIMESTAMP(3),
  "placedByUserId"  TEXT,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "deletedAt"       TIMESTAMP(3),
  CONSTRAINT "implants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "implants_clinicId_patientId_idx"
  ON "implants" ("clinicId", "patientId");
CREATE INDEX IF NOT EXISTS "implants_clinicId_toothFdi_idx"
  ON "implants" ("clinicId", "toothFdi");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'implants_clinicId_fkey'
  ) THEN
    ALTER TABLE "implants"
      ADD CONSTRAINT "implants_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'implants_patientId_fkey'
  ) THEN
    ALTER TABLE "implants"
      ADD CONSTRAINT "implants_patientId_fkey"
      FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'implants_placedByUserId_fkey'
  ) THEN
    ALTER TABLE "implants"
      ADD CONSTRAINT "implants_placedByUserId_fkey"
      FOREIGN KEY ("placedByUserId") REFERENCES "User"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- FK real desde PeriImplantAssessment.implantId → implants.id (nullable
-- para preservar assessments huérfanos previos al modelo Implant).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'peri_implant_assessments_implantId_fkey'
  ) THEN
    ALTER TABLE "peri_implant_assessments"
      ADD CONSTRAINT "peri_implant_assessments_implantId_fkey"
      FOREIGN KEY ("implantId") REFERENCES "implants"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ── RLS deny-all para tabla nueva (defensa en profundidad) ───────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'implants') THEN
    EXECUTE 'ALTER TABLE "implants" ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE policyname = 'implants_deny_all' AND tablename = 'implants'
    ) THEN
      EXECUTE 'CREATE POLICY "implants_deny_all" ON "implants" FOR ALL USING (false)';
    END IF;
  END IF;
END $$;
