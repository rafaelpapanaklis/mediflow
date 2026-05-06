-- ═══════════════════════════════════════════════════════════════════════
-- Ortodoncia · Rediseño patient-detail Fase 1 — Mayo 2026
--
-- DEPLOY MANUAL EN SUPABASE PRODUCCIÓN.
--
-- Equivalente idempotente del archivo
--   prisma/migrations/20260506000000_ortho_patient_redesign_fase1/migration.sql
-- pensado para ejecutar directamente en el SQL editor de Supabase sin
-- depender del runner de prisma migrate (que requiere shadow database).
--
-- Cubre Fase 1:
--   - G1 ⭐ Treatment Card visual (ortho_treatment_cards + 3 tablas hijas)
--   - G3 Wire sequencing (ortho_wire_steps)
--   - G4 Bracket prescription/slot (4 columnas en orthodontic_treatment_plans)
--   - G10 TADs catalog + Aux mechanics (ortho_tads, ortho_aux_mechanics)
--   - Audit trail de avance de fase (ortho_phase_transitions)
--   - G16 Patient flow cross-cutting (patient_flow_entries)
--   - Diagnóstico: skeletalPattern (mesofacial/dolicofacial/braquifacial)
--
-- 100% IDEMPOTENTE: usa CREATE TYPE en DO $$ guards, IF NOT EXISTS, ADD
-- COLUMN IF NOT EXISTS, y ADD CONSTRAINT en DO $$ guards. Se puede correr
-- N veces sobre la misma BD sin error.
--
-- NO ROMPE schema existente — solo añade columnas nullables y tablas.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. ENUMS NUEVOS ──────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "OrthoApplianceSlot" AS ENUM ('MBT_018', 'MBT_022', 'ROTH_018', 'ROTH_022', 'DAMON_Q2', 'DAMON_ULTIMA', 'SPARK', 'INVISALIGN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoBondingType" AS ENUM ('DIRECTO', 'INDIRECTO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoSkeletalPattern" AS ENUM ('MESOFACIAL', 'DOLICOFACIAL', 'BRAQUIFACIAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoWireMaterial" AS ENUM ('NITI', 'SS', 'TMA', 'BETA_TITANIUM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoWireShape" AS ENUM ('ROUND', 'RECT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoWireStepStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoElasticClass" AS ENUM ('CLASE_I', 'CLASE_II', 'CLASE_III', 'BOX', 'CRISS_CROSS', 'SETTLING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoElasticZone" AS ENUM ('ANTERIOR', 'POSTERIOR', 'INTERMAXILAR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoTadBrand" AS ENUM ('DENTOS', 'SPIDER', 'IMTEC', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoExpanderType" AS ENUM ('RPE_HYRAX', 'QUAD_HELIX', 'MCNAMARA', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoDistalizerType" AS ENUM ('PENDULUM', 'CARRIERE', 'BENESLIDER', 'FORSUS', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoGingivitisLevel" AS ENUM ('AUSENTE', 'LEVE', 'MODERADA', 'SEVERA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoCardStatus" AS ENUM ('DRAFT', 'SIGNED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PatientFlowStatus" AS ENUM ('WAITING', 'IN_CHAIR', 'CHECKOUT', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. ALTER TABLES EXISTENTES ──────────────────────────────────────────

-- OrthodonticDiagnosis: patrón skeletal categórico (Sección B).
ALTER TABLE "orthodontic_diagnoses"
  ADD COLUMN IF NOT EXISTS "skeletalPattern" "OrthoSkeletalPattern";

-- OrthodonticTreatmentPlan: prescripción G4 detallada.
ALTER TABLE "orthodontic_treatment_plans"
  ADD COLUMN IF NOT EXISTS "prescriptionSlot"            "OrthoApplianceSlot",
  ADD COLUMN IF NOT EXISTS "bondingType"                 "OrthoBondingType",
  ADD COLUMN IF NOT EXISTS "prescriptionNotes"           TEXT,
  ADD COLUMN IF NOT EXISTS "estimatedTotalDurationWeeks" INTEGER;

-- ── 3. CREATE TABLES NUEVAS ─────────────────────────────────────────────

-- 3.1 ortho_wire_steps (G3)
CREATE TABLE IF NOT EXISTS "ortho_wire_steps" (
  "id"              TEXT NOT NULL,
  "treatmentPlanId" TEXT NOT NULL,
  "clinicId"        TEXT NOT NULL,
  "orderIndex"      INTEGER NOT NULL,
  "phaseKey"        "OrthoPhaseKey" NOT NULL,
  "material"        "OrthoWireMaterial" NOT NULL,
  "shape"           "OrthoWireShape" NOT NULL,
  "gauge"           TEXT NOT NULL,
  "purpose"         TEXT,
  "archUpper"       BOOLEAN NOT NULL DEFAULT true,
  "archLower"       BOOLEAN NOT NULL DEFAULT true,
  "durationWeeks"   INTEGER NOT NULL,
  "auxiliaries"     TEXT[] NOT NULL DEFAULT '{}',
  "notes"           TEXT,
  "status"          "OrthoWireStepStatus" NOT NULL DEFAULT 'PLANNED',
  "plannedDate"     TIMESTAMP(3),
  "appliedDate"     TIMESTAMP(3),
  "completedDate"   TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ortho_wire_steps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ortho_wire_steps_treatmentPlanId_orderIndex_key"
  ON "ortho_wire_steps" ("treatmentPlanId", "orderIndex");
CREATE INDEX IF NOT EXISTS "ortho_wire_steps_treatmentPlanId_status_idx"
  ON "ortho_wire_steps" ("treatmentPlanId", "status");
CREATE INDEX IF NOT EXISTS "ortho_wire_steps_clinicId_status_idx"
  ON "ortho_wire_steps" ("clinicId", "status");

-- 3.2 ortho_treatment_cards (G1 ⭐)
CREATE TABLE IF NOT EXISTS "ortho_treatment_cards" (
  "id"                   TEXT NOT NULL,
  "treatmentPlanId"      TEXT NOT NULL,
  "patientId"            TEXT NOT NULL,
  "clinicId"             TEXT NOT NULL,
  "controlAppointmentId" TEXT,
  "cardNumber"           INTEGER NOT NULL,
  "visitDate"            TIMESTAMP(3) NOT NULL,
  "durationMin"          INTEGER NOT NULL DEFAULT 30,
  "phaseKey"             "OrthoPhaseKey" NOT NULL,
  "monthAt"              DECIMAL(4,1) NOT NULL,
  "wireFromId"           TEXT,
  "wireToId"             TEXT,
  "soapS"                TEXT NOT NULL DEFAULT '',
  "soapO"                TEXT NOT NULL DEFAULT '',
  "soapA"                TEXT NOT NULL DEFAULT '',
  "soapP"                TEXT NOT NULL DEFAULT '',
  "hygienePlaquePct"     INTEGER,
  "hygieneGingivitis"    "OrthoGingivitisLevel",
  "hygieneWhiteSpots"    BOOLEAN NOT NULL DEFAULT false,
  "hasProgressPhoto"     BOOLEAN NOT NULL DEFAULT false,
  "photoSetId"           TEXT,
  "nextDate"             TIMESTAMP(3),
  "nextDurationMin"      INTEGER,
  "status"               "OrthoCardStatus" NOT NULL DEFAULT 'DRAFT',
  "signedAt"             TIMESTAMP(3),
  "signedById"           TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  "deletedAt"            TIMESTAMP(3),
  CONSTRAINT "ortho_treatment_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ortho_treatment_cards_controlAppointmentId_key"
  ON "ortho_treatment_cards" ("controlAppointmentId");
CREATE UNIQUE INDEX IF NOT EXISTS "ortho_treatment_cards_treatmentPlanId_cardNumber_key"
  ON "ortho_treatment_cards" ("treatmentPlanId", "cardNumber");
CREATE INDEX IF NOT EXISTS "ortho_treatment_cards_clinicId_visitDate_idx"
  ON "ortho_treatment_cards" ("clinicId", "visitDate" DESC);
CREATE INDEX IF NOT EXISTS "ortho_treatment_cards_patientId_visitDate_idx"
  ON "ortho_treatment_cards" ("patientId", "visitDate" DESC);

-- 3.3 ortho_card_elastics
CREATE TABLE IF NOT EXISTS "ortho_card_elastics" (
  "id"           TEXT NOT NULL,
  "cardId"       TEXT NOT NULL,
  "clinicId"     TEXT NOT NULL,
  "elasticClass" "OrthoElasticClass" NOT NULL,
  "config"       TEXT NOT NULL,
  "zone"         "OrthoElasticZone" NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ortho_card_elastics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ortho_card_elastics_cardId_idx"
  ON "ortho_card_elastics" ("cardId");

-- 3.4 ortho_card_ipr_points
CREATE TABLE IF NOT EXISTS "ortho_card_ipr_points" (
  "id"        TEXT NOT NULL,
  "cardId"    TEXT NOT NULL,
  "clinicId"  TEXT NOT NULL,
  "toothA"    INTEGER NOT NULL,
  "toothB"    INTEGER NOT NULL,
  "amountMm"  DECIMAL(3,1) NOT NULL,
  "done"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ortho_card_ipr_points_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ortho_card_ipr_points_cardId_idx"
  ON "ortho_card_ipr_points" ("cardId");

-- 3.5 ortho_card_broken_brackets
CREATE TABLE IF NOT EXISTS "ortho_card_broken_brackets" (
  "id"           TEXT NOT NULL,
  "cardId"       TEXT NOT NULL,
  "clinicId"     TEXT NOT NULL,
  "toothFdi"     INTEGER NOT NULL,
  "brokenDate"   TIMESTAMP(3) NOT NULL,
  "reBondedDate" TIMESTAMP(3),
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ortho_card_broken_brackets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ortho_card_broken_brackets_cardId_idx"
  ON "ortho_card_broken_brackets" ("cardId");

-- 3.6 ortho_tads (G10)
CREATE TABLE IF NOT EXISTS "ortho_tads" (
  "id"              TEXT NOT NULL,
  "treatmentPlanId" TEXT NOT NULL,
  "patientId"       TEXT NOT NULL,
  "clinicId"        TEXT NOT NULL,
  "brand"           "OrthoTadBrand" NOT NULL,
  "size"            TEXT NOT NULL,
  "location"        TEXT NOT NULL,
  "torqueNcm"       INTEGER,
  "placedDate"      TIMESTAMP(3) NOT NULL,
  "placedById"      TEXT,
  "failed"          BOOLEAN NOT NULL DEFAULT false,
  "failedDate"      TIMESTAMP(3),
  "failureReason"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "deletedAt"       TIMESTAMP(3),
  CONSTRAINT "ortho_tads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ortho_tads_treatmentPlanId_failed_idx"
  ON "ortho_tads" ("treatmentPlanId", "failed");
CREATE INDEX IF NOT EXISTS "ortho_tads_clinicId_placedDate_idx"
  ON "ortho_tads" ("clinicId", "placedDate" DESC);

-- 3.7 ortho_aux_mechanics
CREATE TABLE IF NOT EXISTS "ortho_aux_mechanics" (
  "id"                    TEXT NOT NULL,
  "treatmentPlanId"       TEXT NOT NULL,
  "clinicId"              TEXT NOT NULL,
  "expanderType"          "OrthoExpanderType",
  "expanderActivations"   INTEGER,
  "expanderInstalledAt"   TIMESTAMP(3),
  "expanderRemovedAt"     TIMESTAMP(3),
  "distalizerType"        "OrthoDistalizerType",
  "distalizerInstalledAt" TIMESTAMP(3),
  "distalizerRemovedAt"   TIMESTAMP(3),
  "notes"                 TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ortho_aux_mechanics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ortho_aux_mechanics_treatmentPlanId_key"
  ON "ortho_aux_mechanics" ("treatmentPlanId");

-- 3.8 ortho_phase_transitions
CREATE TABLE IF NOT EXISTS "ortho_phase_transitions" (
  "id"              TEXT NOT NULL,
  "treatmentPlanId" TEXT NOT NULL,
  "clinicId"        TEXT NOT NULL,
  "fromPhase"       "OrthoPhaseKey" NOT NULL,
  "toPhase"         "OrthoPhaseKey" NOT NULL,
  "criteriaChecked" TEXT[] NOT NULL DEFAULT '{}',
  "doctorNotes"     TEXT,
  "signedById"      TEXT NOT NULL,
  "signedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isOverride"      BOOLEAN NOT NULL DEFAULT false,
  "overrideReason"  TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ortho_phase_transitions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ortho_phase_transitions_treatmentPlanId_signedAt_idx"
  ON "ortho_phase_transitions" ("treatmentPlanId", "signedAt" DESC);
CREATE INDEX IF NOT EXISTS "ortho_phase_transitions_clinicId_signedAt_idx"
  ON "ortho_phase_transitions" ("clinicId", "signedAt" DESC);

-- 3.9 patient_flow_entries (G16, cross-cutting clinical-shared)
CREATE TABLE IF NOT EXISTS "patient_flow_entries" (
  "id"            TEXT NOT NULL,
  "clinicId"      TEXT NOT NULL,
  "patientId"     TEXT NOT NULL,
  "status"        "PatientFlowStatus" NOT NULL,
  "chair"         TEXT,
  "appointmentId" TEXT,
  "enteredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exitedAt"      TIMESTAMP(3),
  "triggeredById" TEXT,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "patient_flow_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "patient_flow_entries_clinicId_status_exitedAt_idx"
  ON "patient_flow_entries" ("clinicId", "status", "exitedAt");
CREATE INDEX IF NOT EXISTS "patient_flow_entries_patientId_enteredAt_idx"
  ON "patient_flow_entries" ("patientId", "enteredAt" DESC);

-- ── 4. FOREIGN KEYS ─────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "ortho_wire_steps"
    ADD CONSTRAINT "ortho_wire_steps_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_wire_steps"
    ADD CONSTRAINT "ortho_wire_steps_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_treatment_cards"
    ADD CONSTRAINT "ortho_treatment_cards_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_treatment_cards"
    ADD CONSTRAINT "ortho_treatment_cards_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_treatment_cards"
    ADD CONSTRAINT "ortho_treatment_cards_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_treatment_cards"
    ADD CONSTRAINT "ortho_treatment_cards_controlAppointmentId_fkey"
    FOREIGN KEY ("controlAppointmentId") REFERENCES "orthodontic_control_appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_treatment_cards"
    ADD CONSTRAINT "ortho_treatment_cards_wireFromId_fkey"
    FOREIGN KEY ("wireFromId") REFERENCES "ortho_wire_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_treatment_cards"
    ADD CONSTRAINT "ortho_treatment_cards_wireToId_fkey"
    FOREIGN KEY ("wireToId") REFERENCES "ortho_wire_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_treatment_cards"
    ADD CONSTRAINT "ortho_treatment_cards_signedById_fkey"
    FOREIGN KEY ("signedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_card_elastics"
    ADD CONSTRAINT "ortho_card_elastics_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "ortho_treatment_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_card_elastics"
    ADD CONSTRAINT "ortho_card_elastics_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_card_ipr_points"
    ADD CONSTRAINT "ortho_card_ipr_points_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "ortho_treatment_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_card_ipr_points"
    ADD CONSTRAINT "ortho_card_ipr_points_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_card_broken_brackets"
    ADD CONSTRAINT "ortho_card_broken_brackets_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "ortho_treatment_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_card_broken_brackets"
    ADD CONSTRAINT "ortho_card_broken_brackets_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_tads"
    ADD CONSTRAINT "ortho_tads_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_tads"
    ADD CONSTRAINT "ortho_tads_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_tads"
    ADD CONSTRAINT "ortho_tads_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_tads"
    ADD CONSTRAINT "ortho_tads_placedById_fkey"
    FOREIGN KEY ("placedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_aux_mechanics"
    ADD CONSTRAINT "ortho_aux_mechanics_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_aux_mechanics"
    ADD CONSTRAINT "ortho_aux_mechanics_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_phase_transitions"
    ADD CONSTRAINT "ortho_phase_transitions_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_phase_transitions"
    ADD CONSTRAINT "ortho_phase_transitions_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_phase_transitions"
    ADD CONSTRAINT "ortho_phase_transitions_signedById_fkey"
    FOREIGN KEY ("signedById") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "patient_flow_entries"
    ADD CONSTRAINT "patient_flow_entries_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "patient_flow_entries"
    ADD CONSTRAINT "patient_flow_entries_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "patient_flow_entries"
    ADD CONSTRAINT "patient_flow_entries_triggeredById_fkey"
    FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;

-- Verificación rápida (descomentable después del deploy):
-- SELECT COUNT(*) FILTER (WHERE typname = 'OrthoApplianceSlot') AS enums_new FROM pg_type;
-- SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE 'ortho_%' AND table_schema = current_schema();
