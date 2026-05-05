-- ═══════════════════════════════════════════════════════════════════
-- Periodontics module — schema (foundation)
--
-- CONTEXTO
-- 9 modelos clínicos para Periodoncia (módulo 3/5 del marketplace):
-- sondaje completo (192 sitios x 32 dientes en JSON denso),
-- clasificación 2017 AAP/EFP automática con override, recesiones Cairo,
-- plan de 4 fases, SRP por cuadrante, reevaluación post-Fase 2,
-- riesgo Berna, cirugía periodontal y peri-implantitis.
-- Reutiliza PatientFile para fotos intraoperatorias / consentimientos.
--
-- IDEMPOTENTE: usa IF NOT EXISTS, DO $$ guards y CREATE POLICY guards.
-- Re-corrible sin efectos colaterales. Listo para Supabase SQL Editor.
--
-- ORDEN
--   1. Enums (14)
--   2. Extender periodontal_records (modelo legacy compliance v1)
--   3. Tablas (8 nuevas)
--   4. FKs + índices + GIN sobre sites
--   5. CHECK constraints (BoP 0-100, recall 3/4/6, recesión 0-20, FDI)
--   6. RLS deny-all en las 9 tablas
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Enums ───────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "PeriodontalRecordType" AS ENUM (
    'INICIAL', 'PRE_TRATAMIENTO', 'POST_FASE_1', 'POST_FASE_2',
    'MANTENIMIENTO', 'CIRUGIA_PRE', 'CIRUGIA_POST'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SitePosition" AS ENUM ('MV', 'MB', 'DV', 'DL', 'ML', 'MB_PAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PeriodontalStage" AS ENUM (
    'SALUD', 'GINGIVITIS', 'STAGE_I', 'STAGE_II', 'STAGE_III', 'STAGE_IV'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PeriodontalGrade" AS ENUM ('GRADE_A', 'GRADE_B', 'GRADE_C');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PeriodontalExtension" AS ENUM (
    'LOCALIZADA', 'GENERALIZADA', 'PATRON_MOLAR_INCISIVO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CairoClassification" AS ENUM ('RT1', 'RT2', 'RT3');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "GingivalPhenotype" AS ENUM ('DELGADO', 'GRUESO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PeriodontalPhase" AS ENUM ('PHASE_1', 'PHASE_2', 'PHASE_3', 'PHASE_4');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SRPTechnique" AS ENUM (
    'SRP_CUADRANTE', 'FULL_MOUTH_DISINFECTION', 'FULL_MOUTH_SCALING'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SRPInstrumentation" AS ENUM ('MANUAL', 'ULTRASONICO', 'COMBINADO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SmokingStatus" AS ENUM ('NO', 'MENOR_10', 'MAYOR_O_IGUAL_10');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PeriodontalRiskCategory" AS ENUM ('BAJO', 'MODERADO', 'ALTO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PeriodontalSurgeryType" AS ENUM (
    'COLGAJO_ACCESO', 'GINGIVECTOMIA', 'RESECTIVA_OSEA', 'RTG',
    'INJERTO_GINGIVAL_LIBRE', 'INJERTO_TEJIDO_CONECTIVO',
    'TUNELIZACION', 'CORONALLY_ADVANCED_FLAP', 'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PeriImplantStatus" AS ENUM (
    'SALUD', 'MUCOSITIS',
    'PERIIMPLANTITIS_INICIAL', 'PERIIMPLANTITIS_MODERADA',
    'PERIIMPLANTITIS_AVANZADA'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "GingivitisType" AS ENUM (
    'SALUD_INTACTO', 'SALUD_REDUCIDO_ESTABLE',
    'GINGIVITIS_INDUCIDA_PLACA', 'GINGIVITIS_NO_INDUCIDA_PLACA',
    'PERIODONTITIS'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── 2. Extender periodontal_records (modelo compliance v1) ────────

ALTER TABLE "periodontal_records" ADD COLUMN IF NOT EXISTS "recordType" "PeriodontalRecordType" NOT NULL DEFAULT 'INICIAL';
ALTER TABLE "periodontal_records" ADD COLUMN IF NOT EXISTS "sites" JSONB;
ALTER TABLE "periodontal_records" ADD COLUMN IF NOT EXISTS "toothLevel" JSONB;
ALTER TABLE "periodontal_records" ADD COLUMN IF NOT EXISTS "bopPercentage" DOUBLE PRECISION;
ALTER TABLE "periodontal_records" ADD COLUMN IF NOT EXISTS "plaqueIndexOleary" DOUBLE PRECISION;
ALTER TABLE "periodontal_records" ADD COLUMN IF NOT EXISTS "sites1to3mm" INTEGER;
ALTER TABLE "periodontal_records" ADD COLUMN IF NOT EXISTS "sites4to5mm" INTEGER;
ALTER TABLE "periodontal_records" ADD COLUMN IF NOT EXISTS "sites6PlusMm" INTEGER;
ALTER TABLE "periodontal_records" ADD COLUMN IF NOT EXISTS "teethWithPockets5Plus" INTEGER;
ALTER TABLE "periodontal_records" ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER;
ALTER TABLE "periodontal_records" ADD COLUMN IF NOT EXISTS "comparedToRecordId" TEXT;
ALTER TABLE "periodontal_records" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();
ALTER TABLE "periodontal_records" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- measurements era NOT NULL en compliance v1; el módulo nuevo permite
-- registros con sites en lugar de measurements, así que lo hacemos
-- nullable. El campo legacy se mantiene como compat.
ALTER TABLE "periodontal_records" ALTER COLUMN "measurements" DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE "periodontal_records"
    ADD CONSTRAINT "periodontal_records_comparedToRecordId_fkey"
    FOREIGN KEY ("comparedToRecordId") REFERENCES "periodontal_records"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "perio_record_pat_recorded_idx"
  ON "periodontal_records"("patientId", "recordedAt" DESC);
CREATE INDEX IF NOT EXISTS "perio_record_clinic_recorded_idx"
  ON "periodontal_records"("clinicId", "recordedAt" DESC);
CREATE INDEX IF NOT EXISTS "perio_record_clinic_deleted_idx"
  ON "periodontal_records"("clinicId", "deletedAt");


-- ── 3. Tablas nuevas ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "periodontal_classifications" (
  "id"                       TEXT          PRIMARY KEY,
  "patientId"                TEXT          NOT NULL,
  "clinicId"                 TEXT          NOT NULL,
  "periodontalRecordId"      TEXT          NOT NULL,
  "stage"                    "PeriodontalStage"     NOT NULL,
  "grade"                    "PeriodontalGrade",
  "extension"                "PeriodontalExtension",
  "modifiers"                JSONB         NOT NULL DEFAULT '{}'::jsonb,
  "computationInputs"        JSONB         NOT NULL DEFAULT '{}'::jsonb,
  "calculatedAutomatically"  BOOLEAN       NOT NULL,
  "overriddenByDoctor"       BOOLEAN       NOT NULL DEFAULT false,
  "justification"            TEXT,
  "classifiedAt"             TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "classifiedById"           TEXT          NOT NULL,
  "createdAt"                TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3)  NOT NULL,
  "deletedAt"                TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "perio_class_record_unique" ON "periodontal_classifications"("periodontalRecordId");
CREATE INDEX IF NOT EXISTS "perio_class_pat_idx"     ON "periodontal_classifications"("patientId", "classifiedAt" DESC);
CREATE INDEX IF NOT EXISTS "perio_class_clinic_idx"  ON "periodontal_classifications"("clinicId");

CREATE TABLE IF NOT EXISTS "gingival_recessions" (
  "id"                  TEXT             PRIMARY KEY,
  "patientId"           TEXT             NOT NULL,
  "clinicId"            TEXT             NOT NULL,
  "toothFdi"            INTEGER          NOT NULL,
  "surface"             TEXT             NOT NULL,
  "recessionHeightMm"   DOUBLE PRECISION NOT NULL,
  "recessionWidthMm"    DOUBLE PRECISION NOT NULL,
  "keratinizedTissueMm" DOUBLE PRECISION NOT NULL,
  "cairoClassification" "CairoClassification" NOT NULL,
  "gingivalPhenotype"   "GingivalPhenotype"   NOT NULL,
  "recordedAt"          TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "recordedById"        TEXT             NOT NULL,
  "notes"               TEXT,
  "resolvedAt"          TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP(3)     NOT NULL,
  "deletedAt"           TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "ging_rec_pat_tooth_idx"   ON "gingival_recessions"("patientId", "toothFdi");
CREATE INDEX IF NOT EXISTS "ging_rec_clinic_recorded_idx" ON "gingival_recessions"("clinicId", "recordedAt" DESC);

CREATE TABLE IF NOT EXISTS "periodontal_treatment_plans" (
  "id"                 TEXT          PRIMARY KEY,
  "patientId"          TEXT          NOT NULL,
  "clinicId"           TEXT          NOT NULL,
  "currentPhase"       "PeriodontalPhase" NOT NULL,
  "phase1StartedAt"    TIMESTAMP(3),
  "phase1CompletedAt"  TIMESTAMP(3),
  "phase2StartedAt"    TIMESTAMP(3),
  "phase2CompletedAt"  TIMESTAMP(3),
  "phase3StartedAt"    TIMESTAMP(3),
  "phase3CompletedAt"  TIMESTAMP(3),
  "phase4StartedAt"    TIMESTAMP(3),
  "nextEvaluationAt"   TIMESTAMP(3),
  "planNotes"          TEXT,
  "createdAt"          TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMP(3)  NOT NULL,
  "deletedAt"          TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "perio_plan_pat_idx"        ON "periodontal_treatment_plans"("patientId");
CREATE INDEX IF NOT EXISTS "perio_plan_clinic_phase_idx" ON "periodontal_treatment_plans"("clinicId", "currentPhase");
CREATE INDEX IF NOT EXISTS "perio_plan_next_eval_idx"  ON "periodontal_treatment_plans"("nextEvaluationAt");

CREATE TABLE IF NOT EXISTS "srp_sessions" (
  "id"                 TEXT             PRIMARY KEY,
  "patientId"          TEXT             NOT NULL,
  "clinicId"           TEXT             NOT NULL,
  "planId"             TEXT             NOT NULL,
  "performedAt"        TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "doctorId"           TEXT             NOT NULL,
  "technique"          "SRPTechnique"   NOT NULL,
  "instrumentation"    "SRPInstrumentation" NOT NULL,
  "quadrantsCompleted" JSONB            NOT NULL DEFAULT '{}'::jsonb,
  "anesthesiaUsed"     BOOLEAN          NOT NULL DEFAULT false,
  "anesthesiaType"     TEXT,
  "durationMinutes"    INTEGER,
  "observations"       TEXT,
  "createdAt"          TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMP(3)     NOT NULL,
  "deletedAt"          TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "srp_pat_performed_idx" ON "srp_sessions"("patientId", "performedAt" DESC);
CREATE INDEX IF NOT EXISTS "srp_clinic_idx"        ON "srp_sessions"("clinicId");
CREATE INDEX IF NOT EXISTS "srp_plan_idx"          ON "srp_sessions"("planId");

CREATE TABLE IF NOT EXISTS "periodontal_reevaluations" (
  "id"                       TEXT             PRIMARY KEY,
  "patientId"                TEXT             NOT NULL,
  "clinicId"                 TEXT             NOT NULL,
  "planId"                   TEXT             NOT NULL,
  "initialRecordId"          TEXT             NOT NULL,
  "postRecordId"             TEXT             NOT NULL,
  "bopImprovementPct"        DOUBLE PRECISION NOT NULL,
  "pdAverageImprovementMm"   DOUBLE PRECISION NOT NULL,
  "residualSites"            JSONB            NOT NULL DEFAULT '[]'::jsonb,
  "surgicalCandidatesTeeth"  JSONB            NOT NULL DEFAULT '[]'::jsonb,
  "evaluatedAt"              TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "evaluatedById"            TEXT             NOT NULL,
  "recommendation"           TEXT,
  "createdAt"                TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3)     NOT NULL,
  "deletedAt"                TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "perio_reeval_pat_idx"    ON "periodontal_reevaluations"("patientId", "evaluatedAt" DESC);
CREATE INDEX IF NOT EXISTS "perio_reeval_clinic_idx" ON "periodontal_reevaluations"("clinicId");

CREATE TABLE IF NOT EXISTS "periodontal_risk_assessments" (
  "id"                       TEXT             PRIMARY KEY,
  "patientId"                TEXT             NOT NULL,
  "clinicId"                 TEXT             NOT NULL,
  "evaluatedAt"              TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "bopPct"                   DOUBLE PRECISION NOT NULL,
  "residualSites5Plus"       INTEGER          NOT NULL,
  "lostTeethPerio"           INTEGER          NOT NULL,
  "boneLossAgeRatio"         DOUBLE PRECISION,
  "smokingStatus"            "SmokingStatus"  NOT NULL,
  "hba1c"                    DOUBLE PRECISION,
  "riskCategory"             "PeriodontalRiskCategory" NOT NULL,
  "recommendedRecallMonths"  INTEGER          NOT NULL,
  "evaluatedById"            TEXT             NOT NULL,
  "createdAt"                TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3)     NOT NULL,
  "deletedAt"                TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "perio_risk_pat_idx"          ON "periodontal_risk_assessments"("patientId", "evaluatedAt" DESC);
CREATE INDEX IF NOT EXISTS "perio_risk_clinic_category_idx" ON "periodontal_risk_assessments"("clinicId", "riskCategory");

CREATE TABLE IF NOT EXISTS "periodontal_surgeries" (
  "id"                  TEXT          PRIMARY KEY,
  "patientId"           TEXT          NOT NULL,
  "clinicId"            TEXT          NOT NULL,
  "planId"              TEXT,
  "surgeryType"         "PeriodontalSurgeryType" NOT NULL,
  "treatedSites"        JSONB         NOT NULL DEFAULT '[]'::jsonb,
  "biomaterials"        JSONB,
  "sutureType"          TEXT,
  "surgeryDate"         TIMESTAMP(3)  NOT NULL,
  "doctorId"            TEXT          NOT NULL,
  "sutureRemovalDate"   TIMESTAMP(3),
  "postOpComplications" TEXT,
  "intraoperativeFileId" TEXT,
  "consentSignedFileId"  TEXT,
  "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP(3)  NOT NULL,
  "deletedAt"           TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "perio_surgery_pat_date_idx" ON "periodontal_surgeries"("patientId", "surgeryDate" DESC);
CREATE INDEX IF NOT EXISTS "perio_surgery_clinic_idx"   ON "periodontal_surgeries"("clinicId");
CREATE INDEX IF NOT EXISTS "perio_surgery_plan_idx"     ON "periodontal_surgeries"("planId");

CREATE TABLE IF NOT EXISTS "peri_implant_assessments" (
  "id"                       TEXT             PRIMARY KEY,
  "patientId"                TEXT             NOT NULL,
  "clinicId"                 TEXT             NOT NULL,
  "implantId"                TEXT,
  "implantFdi"               INTEGER          NOT NULL,
  "status"                   "PeriImplantStatus" NOT NULL,
  "bop"                      BOOLEAN          NOT NULL,
  "suppuration"              BOOLEAN          NOT NULL,
  "radiographicBoneLossMm"   DOUBLE PRECISION,
  "recommendedTreatment"     TEXT,
  "evaluatedAt"              TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "evaluatedById"            TEXT             NOT NULL,
  "createdAt"                TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3)     NOT NULL,
  "deletedAt"                TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "periimp_pat_idx"        ON "peri_implant_assessments"("patientId", "evaluatedAt" DESC);
CREATE INDEX IF NOT EXISTS "periimp_clinic_status_idx" ON "peri_implant_assessments"("clinicId", "status");
CREATE INDEX IF NOT EXISTS "periimp_implant_idx"    ON "peri_implant_assessments"("implantId");


-- ── 4. Foreign keys ───────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "periodontal_classifications"
    ADD CONSTRAINT "perio_class_record_fkey"
    FOREIGN KEY ("periodontalRecordId") REFERENCES "periodontal_records"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_classifications"
    ADD CONSTRAINT "perio_class_pat_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_classifications"
    ADD CONSTRAINT "perio_class_clinic_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_classifications"
    ADD CONSTRAINT "perio_class_classifier_fkey"
    FOREIGN KEY ("classifiedById") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "gingival_recessions"
    ADD CONSTRAINT "ging_rec_pat_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "gingival_recessions"
    ADD CONSTRAINT "ging_rec_clinic_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "gingival_recessions"
    ADD CONSTRAINT "ging_rec_recorder_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "periodontal_treatment_plans"
    ADD CONSTRAINT "perio_plan_pat_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_treatment_plans"
    ADD CONSTRAINT "perio_plan_clinic_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "srp_sessions"
    ADD CONSTRAINT "srp_pat_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "srp_sessions"
    ADD CONSTRAINT "srp_clinic_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "srp_sessions"
    ADD CONSTRAINT "srp_plan_fkey"
    FOREIGN KEY ("planId") REFERENCES "periodontal_treatment_plans"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "srp_sessions"
    ADD CONSTRAINT "srp_doctor_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "periodontal_reevaluations"
    ADD CONSTRAINT "perio_reeval_pat_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_reevaluations"
    ADD CONSTRAINT "perio_reeval_clinic_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_reevaluations"
    ADD CONSTRAINT "perio_reeval_plan_fkey"
    FOREIGN KEY ("planId") REFERENCES "periodontal_treatment_plans"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_reevaluations"
    ADD CONSTRAINT "perio_reeval_initial_fkey"
    FOREIGN KEY ("initialRecordId") REFERENCES "periodontal_records"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_reevaluations"
    ADD CONSTRAINT "perio_reeval_post_fkey"
    FOREIGN KEY ("postRecordId") REFERENCES "periodontal_records"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_reevaluations"
    ADD CONSTRAINT "perio_reeval_evaluator_fkey"
    FOREIGN KEY ("evaluatedById") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "periodontal_risk_assessments"
    ADD CONSTRAINT "perio_risk_pat_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_risk_assessments"
    ADD CONSTRAINT "perio_risk_clinic_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_risk_assessments"
    ADD CONSTRAINT "perio_risk_evaluator_fkey"
    FOREIGN KEY ("evaluatedById") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "periodontal_surgeries"
    ADD CONSTRAINT "perio_surgery_pat_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_surgeries"
    ADD CONSTRAINT "perio_surgery_clinic_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_surgeries"
    ADD CONSTRAINT "perio_surgery_plan_fkey"
    FOREIGN KEY ("planId") REFERENCES "periodontal_treatment_plans"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_surgeries"
    ADD CONSTRAINT "perio_surgery_doctor_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_surgeries"
    ADD CONSTRAINT "perio_surgery_intraop_fkey"
    FOREIGN KEY ("intraoperativeFileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_surgeries"
    ADD CONSTRAINT "perio_surgery_consent_fkey"
    FOREIGN KEY ("consentSignedFileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "peri_implant_assessments"
    ADD CONSTRAINT "periimp_pat_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "peri_implant_assessments"
    ADD CONSTRAINT "periimp_clinic_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "peri_implant_assessments"
    ADD CONSTRAINT "periimp_evaluator_fkey"
    FOREIGN KEY ("evaluatedById") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── 5. CHECK constraints ──────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "periodontal_records"
    ADD CONSTRAINT "chk_perio_bop_range"
    CHECK ("bopPercentage" IS NULL OR ("bopPercentage" >= 0 AND "bopPercentage" <= 100));
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_records"
    ADD CONSTRAINT "chk_perio_plaque_range"
    CHECK ("plaqueIndexOleary" IS NULL OR ("plaqueIndexOleary" >= 0 AND "plaqueIndexOleary" <= 100));
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "periodontal_records"
    ADD CONSTRAINT "chk_perio_sites_nonneg"
    CHECK (
      ("sites1to3mm" IS NULL OR "sites1to3mm" >= 0) AND
      ("sites4to5mm" IS NULL OR "sites4to5mm" >= 0) AND
      ("sites6PlusMm" IS NULL OR "sites6PlusMm" >= 0)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "periodontal_risk_assessments"
    ADD CONSTRAINT "chk_recall_months_valid"
    CHECK ("recommendedRecallMonths" IN (3, 4, 6));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "gingival_recessions"
    ADD CONSTRAINT "chk_recession_height_range"
    CHECK ("recessionHeightMm" >= 0 AND "recessionHeightMm" <= 20);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "gingival_recessions"
    ADD CONSTRAINT "chk_recession_width_range"
    CHECK ("recessionWidthMm" >= 0 AND "recessionWidthMm" <= 20);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "gingival_recessions"
    ADD CONSTRAINT "chk_kt_range"
    CHECK ("keratinizedTissueMm" >= 0 AND "keratinizedTissueMm" <= 20);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "gingival_recessions"
    ADD CONSTRAINT "chk_surface_valid"
    CHECK ("surface" IN ('vestibular', 'lingual'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "peri_implant_assessments"
    ADD CONSTRAINT "chk_implant_fdi_range"
    CHECK ("implantFdi" >= 11 AND "implantFdi" <= 48);
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── 6. Índice GIN sobre sites JSONB ──────────────────────────────

CREATE INDEX IF NOT EXISTS "perio_record_sites_gin"
  ON "periodontal_records" USING GIN ("sites" jsonb_path_ops);


-- ═══════════════════════════════════════════════════════════════════
-- 7. RLS deny-all en las 9 tablas (defensa en profundidad)
--
-- Mismo patrón que pediatría/endodoncia: RESTRICTIVE policy bloquea
-- todo acceso desde anon/authenticated. MediFlow accede vía Prisma +
-- service role (bypassa RLS por diseño).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "periodontal_records"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "periodontal_classifications"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gingival_recessions"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "periodontal_treatment_plans"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "srp_sessions"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "periodontal_reevaluations"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "periodontal_risk_assessments"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "periodontal_surgeries"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "peri_implant_assessments"       ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  perio_table TEXT;
BEGIN
  FOR perio_table IN
    SELECT unnest(ARRAY[
      'periodontal_records',
      'periodontal_classifications',
      'gingival_recessions',
      'periodontal_treatment_plans',
      'srp_sessions',
      'periodontal_reevaluations',
      'periodontal_risk_assessments',
      'periodontal_surgeries',
      'peri_implant_assessments'
    ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = perio_table
        AND policyname = perio_table || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        perio_table || '_deny_anon',
        perio_table
      );
    END IF;
  END LOOP;
END $$;
