-- ═══════════════════════════════════════════════════════════════════
-- Endodontics module — schema (foundation)
--
-- CONTEXTO
-- 8 modelos clínicos para Endodoncia (módulo 2/5 del marketplace):
-- diagnóstico, prueba de vitalidad, tratamiento de conductos,
-- conducto individual, medicación intracanal, controles, retratamiento
-- y cirugía apical. Reutiliza PatientFile para radiografías
-- (conductometría / control / intraoperatorio).
--
-- IDEMPOTENTE: usa IF NOT EXISTS, DO $$ guards y CREATE POLICY guards.
-- Se puede re-correr múltiples veces sin efectos colaterales. Listo
-- para pegar en Supabase SQL Editor.
--
-- ORDEN
--   1. Enums (16)
--   2. Tablas (8) con FKs onDelete:Restrict para evidencia legal
--   3. Índices + constraints CHECK (FDI válido, PAI 1..5, WL 5..40)
--   4. Índice GIN sobre irrigants JSONB
--   5. RLS deny-all en las 8 tablas nuevas
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Enums ───────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "PulpalDiagnosis" AS ENUM (
    'PULPA_NORMAL', 'PULPITIS_REVERSIBLE',
    'PULPITIS_IRREVERSIBLE_SINTOMATICA', 'PULPITIS_IRREVERSIBLE_ASINTOMATICA',
    'NECROSIS_PULPAR', 'PREVIAMENTE_TRATADO', 'PREVIAMENTE_INICIADO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PeriapicalDiagnosis" AS ENUM (
    'TEJIDOS_PERIAPICALES_NORMALES',
    'PERIODONTITIS_APICAL_SINTOMATICA', 'PERIODONTITIS_APICAL_ASINTOMATICA',
    'ABSCESO_APICAL_AGUDO', 'ABSCESO_APICAL_CRONICO',
    'OSTEITIS_CONDENSANTE'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "VitalityTestType" AS ENUM (
    'FRIO', 'CALOR', 'EPT',
    'PERCUSION_VERTICAL', 'PERCUSION_HORIZONTAL',
    'PALPACION_APICAL', 'MORDIDA_TOOTHSLOOTH'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "VitalityResult" AS ENUM (
    'POSITIVO', 'NEGATIVO', 'EXAGERADO', 'DIFERIDO', 'SIN_RESPUESTA'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "EndoTreatmentType" AS ENUM (
    'TC_PRIMARIO', 'RETRATAMIENTO', 'APICECTOMIA',
    'PULPOTOMIA_EMERGENCIA', 'TERAPIA_REGENERATIVA'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AccessType" AS ENUM (
    'CONVENCIONAL', 'CONSERVADOR', 'RECTIFICACION_PREVIO', 'POSTE_RETIRADO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "InstrumentationSystem" AS ENUM (
    'PROTAPER_GOLD', 'PROTAPER_NEXT', 'WAVEONE_GOLD', 'RECIPROC_BLUE',
    'BIORACE', 'HYFLEX_EDM', 'TRUNATOMY', 'MANUAL_KFILES', 'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "InstrumentationTechnique" AS ENUM (
    'ROTACION_CONTINUA', 'RECIPROCACION', 'MANUAL', 'HIBRIDA'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "IrrigationActivation" AS ENUM (
    'NINGUNA', 'SONICA', 'ULTRASONICA', 'LASER', 'XPF'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ObturationTechnique" AS ENUM (
    'CONDENSACION_LATERAL', 'CONDENSACION_VERTICAL_CALIENTE',
    'OLA_CONTINUA', 'CONO_UNICO',
    'TERMOPLASTICA_INYECTABLE', 'BIOCERAMIC_SINGLE_CONE'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SealerType" AS ENUM (
    'AH_PLUS', 'MTA_FILLAPEX', 'BIOROOT_RCS', 'BC_SEALER',
    'TUBLISEAL', 'SEALAPEX', 'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CanalCanonicalName" AS ENUM (
    'MB', 'MB2', 'DB', 'MV', 'DV', 'MP', 'P',
    'D', 'M', 'L', 'V', 'ML', 'DL',
    'CONDUCTO_UNICO', 'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ObturationQuality" AS ENUM (
    'HOMOGENEA', 'ADECUADA', 'CON_HUECOS', 'SOBREOBTURADA', 'SUBOBTURADA'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "IntracanalSubstance" AS ENUM (
    'HIDROXIDO_CALCIO', 'CTZ', 'LEDERMIX',
    'FORMOCRESOL', 'PROPILENGLICOL', 'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "FollowUpMilestone" AS ENUM (
    'CONTROL_6M', 'CONTROL_12M', 'CONTROL_24M', 'CONTROL_EXTRA'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "FollowUpConclusion" AS ENUM (
    'EXITO', 'EN_CURACION', 'FRACASO', 'INCIERTO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "RetreatmentFailureReason" AS ENUM (
    'FILTRACION_CORONAL', 'INSTRUMENTO_FRACTURADO', 'CONDUCTO_NO_TRATADO',
    'SOBREOBTURACION', 'SUBOBTURACION', 'FRACTURA_RADICULAR',
    'REINFECCION', 'DESCONOCIDO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "RetreatmentDifficulty" AS ENUM ('BAJA', 'MEDIA', 'ALTA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "RetroFillingMaterial" AS ENUM (
    'MTA', 'BIOCERAMIC_PUTTY', 'SUPER_EBA', 'IRM', 'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "FlapType" AS ENUM (
    'OCHSENBEIN_LUEBKE', 'SULCULAR', 'SEMILUNAR', 'PAPILAR'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "EndoOutcomeStatus" AS ENUM (
    'EN_CURSO', 'COMPLETADO', 'FALLIDO', 'ABANDONADO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PostOpRestorationType" AS ENUM (
    'CORONA_PORCELANA_METAL', 'CORONA_ZIRCONIA',
    'CORONA_DISILICATO_LITIO', 'ONLAY',
    'RESTAURACION_DIRECTA_RESINA',
    'POSTE_FIBRA_CORONA', 'POSTE_METALICO_CORONA'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── 2. Tabla "endodontic_diagnoses" ────────────────────────────────

CREATE TABLE IF NOT EXISTS "endodontic_diagnoses" (
  "id"                   TEXT          PRIMARY KEY,
  "clinicId"             TEXT          NOT NULL,
  "patientId"            TEXT          NOT NULL,
  "doctorId"             TEXT          NOT NULL,
  "toothFdi"             INTEGER       NOT NULL,
  "diagnosedAt"          TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "pulpalDiagnosis"      "PulpalDiagnosis"     NOT NULL,
  "periapicalDiagnosis"  "PeriapicalDiagnosis" NOT NULL,
  "justification"        TEXT,
  "createdByUserId"      TEXT          NOT NULL,
  "createdAt"            TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"            TIMESTAMP(3)  NOT NULL,
  "deletedAt"            TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "endo_diag_clinic_pat_tooth_idx"
  ON "endodontic_diagnoses"("clinicId", "patientId", "toothFdi");
CREATE INDEX IF NOT EXISTS "endo_diag_clinic_doctor_date_idx"
  ON "endodontic_diagnoses"("clinicId", "doctorId", "diagnosedAt");


-- ── 3. Tabla "vitality_tests" ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS "vitality_tests" (
  "id"               TEXT          PRIMARY KEY,
  "clinicId"         TEXT          NOT NULL,
  "patientId"        TEXT          NOT NULL,
  "doctorId"         TEXT          NOT NULL,
  "toothFdi"         INTEGER       NOT NULL,
  "controlTeeth"     JSONB         NOT NULL DEFAULT '[]'::jsonb,
  "testType"         "VitalityTestType" NOT NULL,
  "result"           "VitalityResult"   NOT NULL,
  "intensity"        INTEGER,
  "evaluatedAt"      TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "notes"            TEXT,
  "createdByUserId"  TEXT          NOT NULL,
  "createdAt"        TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"        TIMESTAMP(3)  NOT NULL,
  "deletedAt"        TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "vitality_clinic_pat_tooth_date_idx"
  ON "vitality_tests"("clinicId", "patientId", "toothFdi", "evaluatedAt");


-- ── 4. Tabla "endodontic_treatments" ───────────────────────────────

CREATE TABLE IF NOT EXISTS "endodontic_treatments" (
  "id"                            TEXT          PRIMARY KEY,
  "clinicId"                      TEXT          NOT NULL,
  "patientId"                     TEXT          NOT NULL,
  "doctorId"                      TEXT          NOT NULL,
  "toothFdi"                      INTEGER       NOT NULL,
  "treatmentType"                 "EndoTreatmentType" NOT NULL,
  "diagnosisId"                   TEXT,
  "startedAt"                     TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "completedAt"                   TIMESTAMP(3),
  "sessionsCount"                 INTEGER       NOT NULL DEFAULT 1,
  "currentStep"                   INTEGER       NOT NULL DEFAULT 1,
  "isMultiSession"                BOOLEAN       NOT NULL DEFAULT false,
  "rubberDamPlaced"               BOOLEAN       NOT NULL DEFAULT false,
  "accessType"                    "AccessType",
  "instrumentationSystem"         "InstrumentationSystem",
  "technique"                     "InstrumentationTechnique",
  "motorBrand"                    TEXT,
  "torqueSettings"                TEXT,
  "rpmSetting"                    INTEGER,
  "irrigants"                     JSONB,
  "irrigationActivation"          "IrrigationActivation",
  "totalIrrigationMinutes"        INTEGER,
  "obturationTechnique"           "ObturationTechnique",
  "sealer"                        "SealerType",
  "masterConePresetIso"           INTEGER,
  "postOpRestorationPlan"         "PostOpRestorationType",
  "requiresPost"                  BOOLEAN       NOT NULL DEFAULT false,
  "postMaterial"                  TEXT,
  "restorationUrgencyDays"        INTEGER,
  "restorationDoctorId"           TEXT,
  "postOpRestorationCompletedAt"  TIMESTAMP(3),
  "outcomeStatus"                 "EndoOutcomeStatus" NOT NULL DEFAULT 'EN_CURSO',
  "notes"                         TEXT,
  "createdByUserId"               TEXT          NOT NULL,
  "createdAt"                     TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"                     TIMESTAMP(3)  NOT NULL,
  "deletedAt"                     TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "endo_tx_clinic_pat_tooth_idx"
  ON "endodontic_treatments"("clinicId", "patientId", "toothFdi");
CREATE INDEX IF NOT EXISTS "endo_tx_clinic_doctor_started_idx"
  ON "endodontic_treatments"("clinicId", "doctorId", "startedAt");
CREATE INDEX IF NOT EXISTS "endo_tx_clinic_outcome_idx"
  ON "endodontic_treatments"("clinicId", "outcomeStatus");


-- ── 5. Tabla "root_canals" ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "root_canals" (
  "id"                       TEXT              PRIMARY KEY,
  "treatmentId"              TEXT              NOT NULL,
  "canonicalName"            "CanalCanonicalName" NOT NULL,
  "customLabel"              TEXT,
  "workingLengthMm"          DECIMAL(4, 1)     NOT NULL,
  "coronalReferencePoint"    TEXT              NOT NULL,
  "masterApicalFileIso"      INTEGER           NOT NULL,
  "masterApicalFileTaper"    DECIMAL(3, 2)     NOT NULL,
  "apexLocatorReadingMm"     DECIMAL(4, 1),
  "radiographicLengthMm"     DECIMAL(4, 1),
  "apexLocatorBrand"         TEXT,
  "conductometryFileId"      TEXT,
  "obturationQuality"        "ObturationQuality",
  "notes"                    TEXT,
  "createdByUserId"          TEXT              NOT NULL,
  "createdAt"                TIMESTAMP(3)      NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3)      NOT NULL,
  "deletedAt"                TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "root_canals_treatment_idx"
  ON "root_canals"("treatmentId");


-- ── 6. Tabla "intracanal_medications" ─────────────────────────────

CREATE TABLE IF NOT EXISTS "intracanal_medications" (
  "id"                  TEXT              PRIMARY KEY,
  "treatmentId"         TEXT              NOT NULL,
  "substance"           "IntracanalSubstance" NOT NULL,
  "placedAt"            TIMESTAMP(3)      NOT NULL,
  "expectedRemovalAt"   TIMESTAMP(3),
  "actualRemovalAt"     TIMESTAMP(3),
  "notes"               TEXT,
  "createdByUserId"     TEXT              NOT NULL,
  "createdAt"           TIMESTAMP(3)      NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP(3)      NOT NULL,
  "deletedAt"           TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "intracanal_med_tx_placed_idx"
  ON "intracanal_medications"("treatmentId", "placedAt");


-- ── 7. Tabla "endodontic_follow_ups" ──────────────────────────────

CREATE TABLE IF NOT EXISTS "endodontic_follow_ups" (
  "id"                 TEXT                 PRIMARY KEY,
  "treatmentId"        TEXT                 NOT NULL,
  "milestone"          "FollowUpMilestone"  NOT NULL,
  "scheduledAt"        TIMESTAMP(3)         NOT NULL,
  "performedAt"        TIMESTAMP(3),
  "paiScore"           INTEGER,
  "symptomsPresent"    BOOLEAN,
  "conclusion"         "FollowUpConclusion",
  "recommendedAction"  TEXT,
  "controlFileId"      TEXT,
  "notes"              TEXT,
  "createdByUserId"    TEXT                 NOT NULL,
  "createdAt"          TIMESTAMP(3)         NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMP(3)         NOT NULL,
  "deletedAt"          TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "endo_followup_tx_scheduled_idx"
  ON "endodontic_follow_ups"("treatmentId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "endo_followup_scheduled_performed_idx"
  ON "endodontic_follow_ups"("scheduledAt", "performedAt");


-- ── 8. Tabla "endodontic_retreatment_info" ────────────────────────

CREATE TABLE IF NOT EXISTS "endodontic_retreatment_info" (
  "id"                            TEXT                       PRIMARY KEY,
  "treatmentId"                   TEXT                       NOT NULL,
  "failureReason"                 "RetreatmentFailureReason" NOT NULL,
  "originalTreatmentDate"         TIMESTAMP(3),
  "fracturedInstrumentRecovered"  BOOLEAN                    NOT NULL DEFAULT false,
  "difficulty"                    "RetreatmentDifficulty"    NOT NULL DEFAULT 'MEDIA',
  "notes"                         TEXT,
  "createdByUserId"               TEXT                       NOT NULL,
  "createdAt"                     TIMESTAMP(3)               NOT NULL DEFAULT NOW(),
  "updatedAt"                     TIMESTAMP(3)               NOT NULL,
  "deletedAt"                     TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "endo_retreatment_treatment_unique"
  ON "endodontic_retreatment_info"("treatmentId");


-- ── 9. Tabla "apical_surgeries" ───────────────────────────────────

CREATE TABLE IF NOT EXISTS "apical_surgeries" (
  "id"                       TEXT                  PRIMARY KEY,
  "treatmentId"              TEXT                  NOT NULL,
  "interventedRoot"          TEXT                  NOT NULL,
  "resectedRootLengthMm"     DECIMAL(3, 1)         NOT NULL,
  "retroFillingMaterial"     "RetroFillingMaterial" NOT NULL,
  "flapType"                 "FlapType"            NOT NULL,
  "sutureType"               TEXT,
  "postOpControlAt"          TIMESTAMP(3),
  "intraoperativeFileId"     TEXT,
  "notes"                    TEXT,
  "createdByUserId"          TEXT                  NOT NULL,
  "createdAt"                TIMESTAMP(3)          NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3)          NOT NULL,
  "deletedAt"                TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "apical_surgery_treatment_unique"
  ON "apical_surgeries"("treatmentId");


-- ── 10. Foreign keys ──────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "endodontic_diagnoses"
    ADD CONSTRAINT "endo_diag_clinic_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "endodontic_diagnoses"
    ADD CONSTRAINT "endo_diag_patient_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "endodontic_diagnoses"
    ADD CONSTRAINT "endo_diag_doctor_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "vitality_tests"
    ADD CONSTRAINT "vitality_clinic_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "vitality_tests"
    ADD CONSTRAINT "vitality_patient_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "vitality_tests"
    ADD CONSTRAINT "vitality_doctor_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "endodontic_treatments"
    ADD CONSTRAINT "endo_tx_clinic_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "endodontic_treatments"
    ADD CONSTRAINT "endo_tx_patient_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "endodontic_treatments"
    ADD CONSTRAINT "endo_tx_doctor_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "endodontic_treatments"
    ADD CONSTRAINT "endo_tx_diagnosis_fkey"
    FOREIGN KEY ("diagnosisId") REFERENCES "endodontic_diagnoses"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "root_canals"
    ADD CONSTRAINT "root_canal_treatment_fkey"
    FOREIGN KEY ("treatmentId") REFERENCES "endodontic_treatments"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "root_canals"
    ADD CONSTRAINT "root_canal_conductometry_fkey"
    FOREIGN KEY ("conductometryFileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "intracanal_medications"
    ADD CONSTRAINT "intracanal_med_treatment_fkey"
    FOREIGN KEY ("treatmentId") REFERENCES "endodontic_treatments"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "endodontic_follow_ups"
    ADD CONSTRAINT "endo_followup_treatment_fkey"
    FOREIGN KEY ("treatmentId") REFERENCES "endodontic_treatments"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "endodontic_follow_ups"
    ADD CONSTRAINT "endo_followup_control_fkey"
    FOREIGN KEY ("controlFileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "endodontic_retreatment_info"
    ADD CONSTRAINT "endo_retreatment_treatment_fkey"
    FOREIGN KEY ("treatmentId") REFERENCES "endodontic_treatments"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "apical_surgeries"
    ADD CONSTRAINT "apical_surgery_treatment_fkey"
    FOREIGN KEY ("treatmentId") REFERENCES "endodontic_treatments"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "apical_surgeries"
    ADD CONSTRAINT "apical_surgery_intraop_fkey"
    FOREIGN KEY ("intraoperativeFileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── 11. CHECK constraints ─────────────────────────────────────────

-- FDI válido (cuadrantes 1-4, dientes 1-8)
DO $$ BEGIN
  ALTER TABLE "endodontic_diagnoses"
    ADD CONSTRAINT "endo_diag_tooth_fdi_valid"
    CHECK (
      ("toothFdi" BETWEEN 11 AND 18) OR
      ("toothFdi" BETWEEN 21 AND 28) OR
      ("toothFdi" BETWEEN 31 AND 38) OR
      ("toothFdi" BETWEEN 41 AND 48)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "vitality_tests"
    ADD CONSTRAINT "vitality_tooth_fdi_valid"
    CHECK (
      ("toothFdi" BETWEEN 11 AND 18) OR
      ("toothFdi" BETWEEN 21 AND 28) OR
      ("toothFdi" BETWEEN 31 AND 38) OR
      ("toothFdi" BETWEEN 41 AND 48)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "endodontic_treatments"
    ADD CONSTRAINT "endo_tx_tooth_fdi_valid"
    CHECK (
      ("toothFdi" BETWEEN 11 AND 18) OR
      ("toothFdi" BETWEEN 21 AND 28) OR
      ("toothFdi" BETWEEN 31 AND 38) OR
      ("toothFdi" BETWEEN 41 AND 48)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- PAI score 1..5 (Periapical Index, escala estándar)
DO $$ BEGIN
  ALTER TABLE "endodontic_follow_ups"
    ADD CONSTRAINT "endo_followup_pai_valid"
    CHECK ("paiScore" IS NULL OR "paiScore" BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Working length 5..40 mm (rango anatómico real)
DO $$ BEGIN
  ALTER TABLE "root_canals"
    ADD CONSTRAINT "root_canal_wl_valid"
    CHECK ("workingLengthMm" BETWEEN 5 AND 40);
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── 12. Índice GIN sobre irrigants JSONB ─────────────────────────

CREATE INDEX IF NOT EXISTS "endo_tx_irrigants_gin"
  ON "endodontic_treatments" USING GIN ("irrigants");


-- ═══════════════════════════════════════════════════════════════════
-- 13. RLS deny-all en las 8 tablas nuevas (defensa en profundidad)
--
-- Mismo patrón que sql/rls-deny-all-policies.sql: RESTRICTIVE policy
-- que bloquea todo acceso desde anon/authenticated. MediFlow accede a
-- estas tablas vía Prisma + service role (bypassa RLS por diseño).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "endodontic_diagnoses"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vitality_tests"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "endodontic_treatments"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "root_canals"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intracanal_medications"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "endodontic_follow_ups"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "endodontic_retreatment_info"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "apical_surgeries"              ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  endo_table TEXT;
BEGIN
  FOR endo_table IN
    SELECT unnest(ARRAY[
      'endodontic_diagnoses',
      'vitality_tests',
      'endodontic_treatments',
      'root_canals',
      'intracanal_medications',
      'endodontic_follow_ups',
      'endodontic_retreatment_info',
      'apical_surgeries'
    ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = endo_table
        AND policyname = endo_table || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        endo_table || '_deny_anon',
        endo_table
      );
    END IF;
  END LOOP;
END $$;
