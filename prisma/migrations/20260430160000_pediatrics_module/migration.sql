-- ═══════════════════════════════════════════════════════════════════
-- Pediatrics module — schema (foundation)
--
-- CONTEXTO
-- Modelo clínico para Odontopediatría (paciente <14 años). Crea 11 tablas
-- y 16 enums que cubren: registro pediátrico maestro, tutores, conducta
-- (Frankl/Venham), riesgo cariogénico (CAMBRA), hábitos orales, erupción,
-- mantenedores de espacio, sellantes, aplicaciones de flúor, tratamientos
-- endodónticos pediátricos y consentimientos.
--
-- IDEMPOTENTE: usa IF NOT EXISTS, DO $$ guards y CREATE POLICY guards.
-- Se puede re-correr múltiples veces sin efectos colaterales. Listo para
-- pegar en Supabase SQL Editor.
--
-- ORDEN
--   1. Enums (16)
--   2. Tablas (11)
--   3. Foreign keys + índices
--   4. RLS deny-all en las 11 tablas nuevas
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Enums ───────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "PedDentitionType" AS ENUM ('temporal', 'mixta', 'permanente');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedVaccinationStatus" AS ENUM ('completo', 'incompleto', 'desconocido');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedFeedingType" AS ENUM ('materna', 'mixta', 'formula', 'na');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedGuardianRelationship" AS ENUM (
    'madre', 'padre', 'tutor_legal', 'abuelo', 'abuela',
    'tio', 'tia', 'hermano', 'hermana', 'otro'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedBehaviorScale" AS ENUM ('frankl', 'venham');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedCariesCategory" AS ENUM ('bajo', 'moderado', 'alto', 'extremo');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedHabitType" AS ENUM (
    'succion_digital', 'chupon', 'biberon_nocturno',
    'respiracion_bucal', 'bruxismo_nocturno', 'onicofagia', 'deglucion_atipica'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedHabitFrequency" AS ENUM ('continua', 'nocturna', 'ocasional', 'na');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedSpaceMaintainerType" AS ENUM (
    'banda_ansa', 'corona_ansa', 'nance', 'arco_lingual', 'distal_shoe'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedSpaceMaintainerStatus" AS ENUM (
    'activo', 'retirado', 'fracturado', 'perdido'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedSealantMaterial" AS ENUM ('resina_fotocurada', 'ionomero');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedSealantRetention" AS ENUM ('completo', 'parcial', 'perdido');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedFluorideProduct" AS ENUM (
    'barniz_5pct_naf', 'gel_apf', 'sdf', 'fosfato_acido'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedEndoTreatmentType" AS ENUM (
    'pulpotomia', 'pulpectomia',
    'recubrimiento_indirecto', 'recubrimiento_directo'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedEndoMaterial" AS ENUM (
    'formocresol', 'mta', 'sulfato_ferrico', 'hidroxido_calcio', 'otro'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PedConsentProcedure" AS ENUM (
    'anestesia_local', 'sedacion_consciente', 'oxido_nitroso',
    'extraccion', 'pulpotomia', 'pulpectomia', 'fluorizacion',
    'toma_impresiones', 'rx_intraoral', 'otro'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── 2. Tabla "pediatric_records" (uno por paciente) ─────────────────

CREATE TABLE IF NOT EXISTS "pediatric_records" (
  "id"                    TEXT          PRIMARY KEY,
  "clinicId"              TEXT          NOT NULL,
  "patientId"             TEXT          NOT NULL,
  "doctorId"              TEXT,
  "createdBy"             TEXT          NOT NULL,
  "recordedAt"            TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "lastReviewedAt"        TIMESTAMP(3),
  "lastReviewedBy"        TEXT,
  "birthWeightKg"         DECIMAL(4, 2),
  "gestationWeeks"        INTEGER,
  "prematuro"             BOOLEAN       NOT NULL DEFAULT false,
  "vaccinationStatus"     "PedVaccinationStatus" NOT NULL DEFAULT 'desconocido',
  "feedingType"           "PedFeedingType"       NOT NULL DEFAULT 'na',
  "specialConditions"     JSONB         NOT NULL DEFAULT '[]'::jsonb,
  "medication"            JSONB         NOT NULL DEFAULT '[]'::jsonb,
  "primaryGuardianId"     TEXT,
  "cutoffOverrideYears"   INTEGER,
  "createdAt"             TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"             TIMESTAMP(3)  NOT NULL,
  "deletedAt"             TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "pediatric_records_patientId_key"
  ON "pediatric_records"("patientId");
CREATE INDEX IF NOT EXISTS "pediatric_records_clinicId_idx"
  ON "pediatric_records"("clinicId");
CREATE INDEX IF NOT EXISTS "pediatric_records_deletedAt_idx"
  ON "pediatric_records"("deletedAt");


-- ── 3. Tabla "ped_guardians" ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ped_guardians" (
  "id"                  TEXT          PRIMARY KEY,
  "clinicId"            TEXT          NOT NULL,
  "patientId"           TEXT          NOT NULL,
  "pediatricRecordId"   TEXT,
  "fullName"            TEXT          NOT NULL,
  "parentesco"          "PedGuardianRelationship" NOT NULL,
  "birthDate"           TIMESTAMP(3),
  "phone"               TEXT          NOT NULL,
  "email"               TEXT,
  "address"             TEXT,
  "ineUrl"              TEXT,
  "esResponsableLegal"  BOOLEAN       NOT NULL DEFAULT true,
  "principal"           BOOLEAN       NOT NULL DEFAULT false,
  "createdBy"           TEXT          NOT NULL,
  "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP(3)  NOT NULL,
  "deletedAt"           TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "ped_guardians_clinicId_idx"        ON "ped_guardians"("clinicId");
CREATE INDEX IF NOT EXISTS "ped_guardians_patient_principal_idx" ON "ped_guardians"("patientId", "principal");
CREATE INDEX IF NOT EXISTS "ped_guardians_deletedAt_idx"        ON "ped_guardians"("deletedAt");


-- ── 4. Tabla "ped_behavior_assessments" (Frankl / Venham) ──────────

CREATE TABLE IF NOT EXISTS "ped_behavior_assessments" (
  "id"                 TEXT          PRIMARY KEY,
  "clinicId"           TEXT          NOT NULL,
  "patientId"          TEXT          NOT NULL,
  "pediatricRecordId"  TEXT          NOT NULL,
  "appointmentId"      TEXT,
  "scale"              "PedBehaviorScale" NOT NULL,
  "value"              INTEGER       NOT NULL,
  "notes"              TEXT,
  "recordedAt"         TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "recordedBy"         TEXT          NOT NULL,
  "createdAt"          TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMP(3)  NOT NULL,
  "deletedAt"          TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "ped_behavior_patient_recorded_idx"
  ON "ped_behavior_assessments"("patientId", "recordedAt" DESC);
CREATE INDEX IF NOT EXISTS "ped_behavior_clinicId_idx"
  ON "ped_behavior_assessments"("clinicId");
CREATE INDEX IF NOT EXISTS "ped_behavior_deletedAt_idx"
  ON "ped_behavior_assessments"("deletedAt");


-- ── 5. Tabla "ped_caries_risk" (CAMBRA) ────────────────────────────

CREATE TABLE IF NOT EXISTS "ped_caries_risk" (
  "id"                       TEXT          PRIMARY KEY,
  "clinicId"                 TEXT          NOT NULL,
  "patientId"                TEXT          NOT NULL,
  "pediatricRecordId"        TEXT          NOT NULL,
  "scoredAt"                 TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "scoredBy"                 TEXT          NOT NULL,
  "riskFactors"              JSONB         NOT NULL DEFAULT '[]'::jsonb,
  "protectiveFactors"        JSONB         NOT NULL DEFAULT '[]'::jsonb,
  "diseaseIndicators"        JSONB         NOT NULL DEFAULT '[]'::jsonb,
  "category"                 "PedCariesCategory" NOT NULL,
  "recommendedRecallMonths"  INTEGER       NOT NULL,
  "previousCategory"         "PedCariesCategory",
  "nextDueAt"                TIMESTAMP(3),
  "createdAt"                TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3)  NOT NULL,
  "deletedAt"                TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "ped_caries_patient_scored_idx"
  ON "ped_caries_risk"("patientId", "scoredAt" DESC);
CREATE INDEX IF NOT EXISTS "ped_caries_clinicId_idx"  ON "ped_caries_risk"("clinicId");
CREATE INDEX IF NOT EXISTS "ped_caries_nextDueAt_idx" ON "ped_caries_risk"("nextDueAt");


-- ── 6. Tabla "ped_oral_habits" ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ped_oral_habits" (
  "id"                     TEXT          PRIMARY KEY,
  "clinicId"               TEXT          NOT NULL,
  "patientId"              TEXT          NOT NULL,
  "pediatricRecordId"      TEXT          NOT NULL,
  "habitType"              "PedHabitType" NOT NULL,
  "frequency"              "PedHabitFrequency" NOT NULL DEFAULT 'na',
  "startedAt"              TIMESTAMP(3)  NOT NULL,
  "endedAt"                TIMESTAMP(3),
  "intervention"           TEXT,
  "interventionStartedAt"  TIMESTAMP(3),
  "interventionType"       TEXT,
  "notes"                  TEXT,
  "createdBy"              TEXT          NOT NULL,
  "createdAt"              TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"              TIMESTAMP(3)  NOT NULL,
  "deletedAt"              TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "ped_oral_habits_patient_type_idx"
  ON "ped_oral_habits"("patientId", "habitType");
CREATE INDEX IF NOT EXISTS "ped_oral_habits_patient_ended_idx"
  ON "ped_oral_habits"("patientId", "endedAt");
CREATE INDEX IF NOT EXISTS "ped_oral_habits_clinicId_idx"
  ON "ped_oral_habits"("clinicId");


-- ── 7. Tabla "ped_eruption_records" ────────────────────────────────

CREATE TABLE IF NOT EXISTS "ped_eruption_records" (
  "id"                    TEXT          PRIMARY KEY,
  "clinicId"              TEXT          NOT NULL,
  "patientId"             TEXT          NOT NULL,
  "pediatricRecordId"     TEXT          NOT NULL,
  "toothFdi"              INTEGER       NOT NULL,
  "observedAt"            TIMESTAMP(3)  NOT NULL,
  "ageAtEruptionDecimal"  DECIMAL(4, 2) NOT NULL,
  "withinExpectedRange"   BOOLEAN       NOT NULL,
  "deviation"             TEXT          NOT NULL,
  "notes"                 TEXT,
  "recordedBy"            TEXT          NOT NULL,
  "createdAt"             TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"             TIMESTAMP(3)  NOT NULL,
  "deletedAt"             TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ped_eruption_patient_tooth_key"
  ON "ped_eruption_records"("patientId", "toothFdi");
CREATE INDEX IF NOT EXISTS "ped_eruption_clinicId_idx"
  ON "ped_eruption_records"("clinicId");


-- ── 8. Tabla "ped_space_maintainers" ───────────────────────────────

CREATE TABLE IF NOT EXISTS "ped_space_maintainers" (
  "id"                  TEXT          PRIMARY KEY,
  "clinicId"            TEXT          NOT NULL,
  "patientId"           TEXT          NOT NULL,
  "pediatricRecordId"   TEXT          NOT NULL,
  "appointmentId"       TEXT,
  "replacedToothFdi"    INTEGER       NOT NULL,
  "type"                "PedSpaceMaintainerType" NOT NULL,
  "placedAt"            TIMESTAMP(3)  NOT NULL,
  "estimatedRemovalAt"  TIMESTAMP(3),
  "currentStatus"       "PedSpaceMaintainerStatus" NOT NULL DEFAULT 'activo',
  "removedAt"           TIMESTAMP(3),
  "removedBy"           TEXT,
  "removedReason"       TEXT,
  "notes"               TEXT,
  "placedBy"            TEXT          NOT NULL,
  "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP(3)  NOT NULL,
  "deletedAt"           TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "ped_space_maintainers_patient_status_idx"
  ON "ped_space_maintainers"("patientId", "currentStatus");
CREATE INDEX IF NOT EXISTS "ped_space_maintainers_clinicId_idx"
  ON "ped_space_maintainers"("clinicId");


-- ── 9. Tabla "ped_sealants" ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ped_sealants" (
  "id"                  TEXT          PRIMARY KEY,
  "clinicId"            TEXT          NOT NULL,
  "patientId"           TEXT          NOT NULL,
  "pediatricRecordId"   TEXT          NOT NULL,
  "toothFdi"            INTEGER       NOT NULL,
  "material"            "PedSealantMaterial" NOT NULL,
  "placedAt"            TIMESTAMP(3)  NOT NULL,
  "placedBy"            TEXT          NOT NULL,
  "retentionStatus"     "PedSealantRetention" NOT NULL DEFAULT 'completo',
  "lastCheckedAt"       TIMESTAMP(3),
  "reappliedAt"         TIMESTAMP(3),
  "reappliedBy"         TEXT,
  "notes"               TEXT,
  "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP(3)  NOT NULL,
  "deletedAt"           TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ped_sealants_patient_tooth_key"
  ON "ped_sealants"("patientId", "toothFdi");
CREATE INDEX IF NOT EXISTS "ped_sealants_clinicId_idx"
  ON "ped_sealants"("clinicId");


-- ── 10. Tabla "ped_fluoride_applications" ──────────────────────────

CREATE TABLE IF NOT EXISTS "ped_fluoride_applications" (
  "id"                  TEXT          PRIMARY KEY,
  "clinicId"            TEXT          NOT NULL,
  "patientId"           TEXT          NOT NULL,
  "pediatricRecordId"   TEXT          NOT NULL,
  "appointmentId"       TEXT,
  "product"             "PedFluorideProduct" NOT NULL,
  "appliedTeeth"        JSONB         NOT NULL DEFAULT '[]'::jsonb,
  "lotNumber"           TEXT,
  "appliedAt"           TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "appliedBy"           TEXT          NOT NULL,
  "notes"               TEXT,
  "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP(3)  NOT NULL,
  "deletedAt"           TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "ped_fluoride_patient_applied_idx"
  ON "ped_fluoride_applications"("patientId", "appliedAt" DESC);
CREATE INDEX IF NOT EXISTS "ped_fluoride_clinicId_idx"
  ON "ped_fluoride_applications"("clinicId");


-- ── 11. Tabla "ped_endodontic_treatments" ──────────────────────────

CREATE TABLE IF NOT EXISTS "ped_endodontic_treatments" (
  "id"                 TEXT          PRIMARY KEY,
  "clinicId"           TEXT          NOT NULL,
  "patientId"          TEXT          NOT NULL,
  "pediatricRecordId"  TEXT          NOT NULL,
  "appointmentId"      TEXT,
  "toothFdi"           INTEGER       NOT NULL,
  "treatmentType"      "PedEndoTreatmentType" NOT NULL,
  "material"           "PedEndoMaterial" NOT NULL,
  "performedAt"        TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "performedBy"        TEXT          NOT NULL,
  "residualVitality"   TEXT,
  "postOpSymptoms"     TEXT,
  "notes"              TEXT,
  "xrayUrl"            TEXT,
  "createdAt"          TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMP(3)  NOT NULL,
  "deletedAt"          TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "ped_endo_patient_performed_idx"
  ON "ped_endodontic_treatments"("patientId", "performedAt" DESC);
CREATE INDEX IF NOT EXISTS "ped_endo_clinicId_idx"
  ON "ped_endodontic_treatments"("clinicId");


-- ── 12. Tabla "ped_consents" ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ped_consents" (
  "id"                       TEXT          PRIMARY KEY,
  "clinicId"                 TEXT          NOT NULL,
  "patientId"                TEXT          NOT NULL,
  "pediatricRecordId"        TEXT          NOT NULL,
  "procedureType"            "PedConsentProcedure" NOT NULL,
  "guardianId"               TEXT          NOT NULL,
  "guardianSignedAt"         TIMESTAMP(3),
  "guardianSignatureUrl"     TEXT,
  "minorAssentRequired"      BOOLEAN       NOT NULL DEFAULT false,
  "minorAssentSignedAt"      TIMESTAMP(3),
  "minorAssentSignatureUrl"  TEXT,
  "pdfUrl"                   TEXT,
  "pdfHash"                  TEXT,
  "expiresAt"                TIMESTAMP(3)  NOT NULL,
  "revokedAt"                TIMESTAMP(3),
  "revokedBy"                TEXT,
  "revokedReason"            TEXT,
  "generatedBy"              TEXT          NOT NULL,
  "createdAt"                TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3)  NOT NULL,
  "deletedAt"                TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "ped_consents_patient_procedure_idx"
  ON "ped_consents"("patientId", "procedureType");
CREATE INDEX IF NOT EXISTS "ped_consents_expiresAt_idx" ON "ped_consents"("expiresAt");
CREATE INDEX IF NOT EXISTS "ped_consents_clinicId_idx"  ON "ped_consents"("clinicId");
CREATE INDEX IF NOT EXISTS "ped_consents_deletedAt_idx" ON "ped_consents"("deletedAt");


-- ── 13. Foreign keys ───────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "pediatric_records"
    ADD CONSTRAINT "pediatric_records_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "pediatric_records"
    ADD CONSTRAINT "pediatric_records_primaryGuardianId_fkey"
    FOREIGN KEY ("primaryGuardianId") REFERENCES "ped_guardians"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_guardians"
    ADD CONSTRAINT "ped_guardians_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_guardians"
    ADD CONSTRAINT "ped_guardians_pediatricRecordId_fkey"
    FOREIGN KEY ("pediatricRecordId") REFERENCES "pediatric_records"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_behavior_assessments"
    ADD CONSTRAINT "ped_behavior_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_behavior_assessments"
    ADD CONSTRAINT "ped_behavior_pediatricRecordId_fkey"
    FOREIGN KEY ("pediatricRecordId") REFERENCES "pediatric_records"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_behavior_assessments"
    ADD CONSTRAINT "ped_behavior_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_caries_risk"
    ADD CONSTRAINT "ped_caries_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_caries_risk"
    ADD CONSTRAINT "ped_caries_pediatricRecordId_fkey"
    FOREIGN KEY ("pediatricRecordId") REFERENCES "pediatric_records"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_oral_habits"
    ADD CONSTRAINT "ped_oral_habits_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_oral_habits"
    ADD CONSTRAINT "ped_oral_habits_pediatricRecordId_fkey"
    FOREIGN KEY ("pediatricRecordId") REFERENCES "pediatric_records"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_eruption_records"
    ADD CONSTRAINT "ped_eruption_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_eruption_records"
    ADD CONSTRAINT "ped_eruption_pediatricRecordId_fkey"
    FOREIGN KEY ("pediatricRecordId") REFERENCES "pediatric_records"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_space_maintainers"
    ADD CONSTRAINT "ped_space_maintainers_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_space_maintainers"
    ADD CONSTRAINT "ped_space_maintainers_pediatricRecordId_fkey"
    FOREIGN KEY ("pediatricRecordId") REFERENCES "pediatric_records"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_space_maintainers"
    ADD CONSTRAINT "ped_space_maintainers_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_sealants"
    ADD CONSTRAINT "ped_sealants_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_sealants"
    ADD CONSTRAINT "ped_sealants_pediatricRecordId_fkey"
    FOREIGN KEY ("pediatricRecordId") REFERENCES "pediatric_records"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_fluoride_applications"
    ADD CONSTRAINT "ped_fluoride_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_fluoride_applications"
    ADD CONSTRAINT "ped_fluoride_pediatricRecordId_fkey"
    FOREIGN KEY ("pediatricRecordId") REFERENCES "pediatric_records"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_fluoride_applications"
    ADD CONSTRAINT "ped_fluoride_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_endodontic_treatments"
    ADD CONSTRAINT "ped_endo_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_endodontic_treatments"
    ADD CONSTRAINT "ped_endo_pediatricRecordId_fkey"
    FOREIGN KEY ("pediatricRecordId") REFERENCES "pediatric_records"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_endodontic_treatments"
    ADD CONSTRAINT "ped_endo_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_consents"
    ADD CONSTRAINT "ped_consents_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_consents"
    ADD CONSTRAINT "ped_consents_pediatricRecordId_fkey"
    FOREIGN KEY ("pediatricRecordId") REFERENCES "pediatric_records"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ped_consents"
    ADD CONSTRAINT "ped_consents_guardianId_fkey"
    FOREIGN KEY ("guardianId") REFERENCES "ped_guardians"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ═══════════════════════════════════════════════════════════════════
-- 14. RLS deny-all en las 11 tablas nuevas (defensa en profundidad)
--
-- Mismo patrón que sql/rls-deny-all-policies.sql: RESTRICTIVE policy
-- que bloquea todo acceso desde anon/authenticated. MediFlow accede a
-- estas tablas vía Prisma + service role (bypassa RLS por diseño).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "pediatric_records"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ped_guardians"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ped_behavior_assessments"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ped_caries_risk"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ped_oral_habits"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ped_eruption_records"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ped_space_maintainers"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ped_sealants"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ped_fluoride_applications"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ped_endodontic_treatments"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ped_consents"               ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  ped_table TEXT;
BEGIN
  FOR ped_table IN
    SELECT unnest(ARRAY[
      'pediatric_records',
      'ped_guardians',
      'ped_behavior_assessments',
      'ped_caries_risk',
      'ped_oral_habits',
      'ped_eruption_records',
      'ped_space_maintainers',
      'ped_sealants',
      'ped_fluoride_applications',
      'ped_endodontic_treatments',
      'ped_consents'
    ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ped_table
        AND policyname = ped_table || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        ped_table || '_deny_anon',
        ped_table
      );
    END IF;
  END LOOP;
END $$;
