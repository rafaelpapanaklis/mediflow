-- ═══════════════════════════════════════════════════════════════════
-- Orthodontics module — schema (foundation)
--
-- CONTEXTO
-- 9 modelos clínicos + financieros para Ortodoncia (módulo 5/5 del
-- marketplace): diagnóstico Angle/overbite/overjet, plan en 6 fases
-- (alineación → retención), 8 vistas fotográficas T0/T1/T2/CONTROL,
-- control mensual estructurado, plan de pagos dedicado con tracking
-- de mensualidades, vinculación de cefalometrías PDF y modelos STL,
-- y consentimientos firmados (4 tipos).
--
-- Reutiliza PatientFile con FileCategory tipado: ORTHO_PHOTO_T0/T1/T2
-- /CONTROL, CEPH_ANALYSIS_PDF, SCAN_STL.
--
-- IDEMPOTENTE: usa IF NOT EXISTS, DO $$ guards y CREATE POLICY guards.
-- Re-corrible sin efectos colaterales. Listo para Supabase SQL Editor.
--
-- ORDEN
--   1. Extender enum FileCategory con 6 valores ortodónticos.
--   2. Enums nuevos (14).
--   3. Tablas (9).
--   4. FKs + índices.
--   5. CHECK constraints (overbite, overjet, duración, costo, día pago,
--      monto, paidAt nullability tied, drop reason length, backdating).
--   6. RLS deny-all en las 9 tablas.
--   7. Trigger recalc_payment_plan_status (recalcula paidAmount /
--      pendingAmount / status del plan tras cambio en installments).
--
-- NOTA SPEC §1.11: trigger auto_overdue_installments NO se crea aquí.
-- Esa lógica vive en Vercel Cron (/api/cron/orthodontics/...) con
-- defensa adicional en recordInstallmentPayment + botón manual.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Extender FileCategory ───────────────────────────────────────

DO $$ BEGIN
  ALTER TYPE "FileCategory" ADD VALUE IF NOT EXISTS 'ORTHO_PHOTO_T0';
  ALTER TYPE "FileCategory" ADD VALUE IF NOT EXISTS 'ORTHO_PHOTO_T1';
  ALTER TYPE "FileCategory" ADD VALUE IF NOT EXISTS 'ORTHO_PHOTO_T2';
  ALTER TYPE "FileCategory" ADD VALUE IF NOT EXISTS 'ORTHO_PHOTO_CONTROL';
  ALTER TYPE "FileCategory" ADD VALUE IF NOT EXISTS 'CEPH_ANALYSIS_PDF';
  ALTER TYPE "FileCategory" ADD VALUE IF NOT EXISTS 'SCAN_STL';
EXCEPTION WHEN others THEN null; END $$;

-- ── 2. Enums nuevos (14) ───────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "AngleClass" AS ENUM (
    'CLASS_I', 'CLASS_II_DIV_1', 'CLASS_II_DIV_2', 'CLASS_III', 'ASYMMETRIC'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoTechnique" AS ENUM (
    'METAL_BRACKETS', 'CERAMIC_BRACKETS', 'SELF_LIGATING_METAL',
    'SELF_LIGATING_CERAMIC', 'LINGUAL_BRACKETS', 'CLEAR_ALIGNERS', 'HYBRID'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AnchorageType" AS ENUM ('MAXIMUM', 'MODERATE', 'MINIMUM', 'COMPOUND');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoPhaseKey" AS ENUM (
    'ALIGNMENT', 'LEVELING', 'SPACE_CLOSURE', 'DETAILS', 'FINISHING', 'RETENTION'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoPhaseStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'DELAYED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoTreatmentStatus" AS ENUM (
    'PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'RETENTION', 'COMPLETED', 'DROPPED_OUT'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoPaymentStatus" AS ENUM (
    'ON_TIME', 'LIGHT_DELAY', 'SEVERE_DELAY', 'PAID_IN_FULL'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'WAIVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoPhotoSetType" AS ENUM ('T0', 'T1', 'T2', 'CONTROL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoPhotoView" AS ENUM (
    'EXTRA_FRONTAL', 'EXTRA_PROFILE', 'EXTRA_SMILE',
    'INTRA_FRONTAL_OCCLUSION', 'INTRA_LATERAL_RIGHT', 'INTRA_LATERAL_LEFT',
    'INTRA_OCCLUSAL_UPPER', 'INTRA_OCCLUSAL_LOWER'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "HabitType" AS ENUM (
    'DIGITAL_SUCKING', 'MOUTH_BREATHING', 'TONGUE_THRUSTING', 'BRUXISM',
    'NAIL_BITING', 'LIP_BITING', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "DentalPhase" AS ENUM ('DECIDUOUS', 'MIXED_EARLY', 'MIXED_LATE', 'PERMANENT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "TreatmentObjective" AS ENUM (
    'AESTHETIC_ONLY', 'FUNCTIONAL_ONLY', 'AESTHETIC_AND_FUNCTIONAL'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoConsentType" AS ENUM (
    'TREATMENT', 'FINANCIAL', 'MINOR_ASSENT', 'PHOTO_USE'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ControlAttendance" AS ENUM ('ATTENDED', 'RESCHEDULED', 'NO_SHOW');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AdjustmentType" AS ENUM (
    'WIRE_CHANGE', 'BRACKET_REPOSITION', 'ELASTIC_CHANGE',
    'NEW_ALIGNERS_DELIVERED', 'IPR', 'BUTTON_PLACEMENT',
    'ATTACHMENT_PLACEMENT', 'HYGIENE_REINFORCEMENT', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "OrthoPaymentMethod" AS ENUM (
    'CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER', 'CHECK', 'WALLET'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "DigitalRecordType" AS ENUM ('CEPH_ANALYSIS_PDF', 'SCAN_STL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 3. Tablas (9) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "orthodontic_diagnoses" (
  "id"                    TEXT PRIMARY KEY,
  "patientId"             TEXT NOT NULL,
  "clinicId"              TEXT NOT NULL,
  "diagnosedById"         TEXT NOT NULL,
  "diagnosedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "angleClassRight"       "AngleClass" NOT NULL,
  "angleClassLeft"        "AngleClass" NOT NULL,
  "overbiteMm"            DECIMAL(4,1) NOT NULL,
  "overbitePercentage"    INTEGER NOT NULL,
  "overjetMm"             DECIMAL(4,1) NOT NULL,
  "midlineDeviationMm"    DECIMAL(4,1),
  "crossbite"             BOOLEAN NOT NULL DEFAULT false,
  "crossbiteDetails"      TEXT,
  "openBite"              BOOLEAN NOT NULL DEFAULT false,
  "openBiteDetails"       TEXT,
  "crowdingUpperMm"       DECIMAL(4,1),
  "crowdingLowerMm"       DECIMAL(4,1),

  "etiologySkeletal"      BOOLEAN NOT NULL DEFAULT false,
  "etiologyDental"        BOOLEAN NOT NULL DEFAULT false,
  "etiologyFunctional"    BOOLEAN NOT NULL DEFAULT false,
  "etiologyNotes"         TEXT,

  "habits"                "HabitType"[] NOT NULL DEFAULT ARRAY[]::"HabitType"[],
  "habitsDescription"     TEXT,

  "dentalPhase"           "DentalPhase" NOT NULL,

  "tmjPainPresent"        BOOLEAN NOT NULL DEFAULT false,
  "tmjClickingPresent"    BOOLEAN NOT NULL DEFAULT false,
  "tmjNotes"              TEXT,

  "initialPhotoSetId"     TEXT,
  "initialCephFileId"     TEXT,
  "initialScanFileId"     TEXT,

  "clinicalSummary"       TEXT NOT NULL,

  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  "deletedAt"             TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS "orthodontic_treatment_plans" (
  "id"                            TEXT PRIMARY KEY,
  "diagnosisId"                   TEXT NOT NULL,
  "patientId"                     TEXT NOT NULL,
  "clinicId"                      TEXT NOT NULL,

  "technique"                     "OrthoTechnique" NOT NULL,
  "techniqueNotes"                TEXT,
  "estimatedDurationMonths"       INTEGER NOT NULL,
  "startDate"                     TIMESTAMP(3),
  "installedAt"                   TIMESTAMP(3),

  "totalCostMxn"                  DECIMAL(10,2) NOT NULL,
  "anchorageType"                 "AnchorageType" NOT NULL,
  "anchorageNotes"                TEXT,

  "extractionsRequired"           BOOLEAN NOT NULL DEFAULT false,
  "extractionsTeethFdi"           INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "iprRequired"                   BOOLEAN NOT NULL DEFAULT false,
  "tadsRequired"                  BOOLEAN NOT NULL DEFAULT false,

  "treatmentObjectives"           "TreatmentObjective" NOT NULL,
  "patientGoals"                  TEXT,

  "retentionPlanText"             TEXT NOT NULL,

  "status"                        "OrthoTreatmentStatus" NOT NULL DEFAULT 'PLANNED',
  "statusUpdatedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "onHoldReason"                  TEXT,
  "onHoldStartedAt"               TIMESTAMP(3),
  "droppedOutAt"                  TIMESTAMP(3),
  "droppedOutReason"              TEXT,

  "signedTreatmentConsentFileId"  TEXT,

  "createdAt"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                     TIMESTAMP(3) NOT NULL,
  "deletedAt"                     TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS "orthodontic_phases" (
  "id"               TEXT PRIMARY KEY,
  "treatmentPlanId"  TEXT NOT NULL,
  "clinicId"         TEXT NOT NULL,

  "phaseKey"         "OrthoPhaseKey" NOT NULL,
  "status"           "OrthoPhaseStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "startedAt"        TIMESTAMP(3),
  "expectedEndAt"    TIMESTAMP(3),
  "completedAt"      TIMESTAMP(3),
  "notes"            TEXT,
  "orderIndex"       INTEGER NOT NULL,

  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "ortho_payment_plans" (
  "id"                                TEXT PRIMARY KEY,
  "treatmentPlanId"                   TEXT NOT NULL,
  "patientId"                         TEXT NOT NULL,
  "clinicId"                          TEXT NOT NULL,

  "totalAmount"                       DECIMAL(10,2) NOT NULL,
  "initialDownPayment"                DECIMAL(10,2) NOT NULL,
  "installmentAmount"                 DECIMAL(10,2) NOT NULL,
  "installmentCount"                  INTEGER NOT NULL,

  "startDate"                         TIMESTAMP(3) NOT NULL,
  "endDate"                           TIMESTAMP(3) NOT NULL,
  "paymentDayOfMonth"                 INTEGER NOT NULL,

  "paidAmount"                        DECIMAL(10,2) NOT NULL DEFAULT 0,
  "pendingAmount"                     DECIMAL(10,2) NOT NULL,
  "status"                            "OrthoPaymentStatus" NOT NULL DEFAULT 'ON_TIME',
  "statusUpdatedAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "preferredPaymentMethod"            "OrthoPaymentMethod" NOT NULL,
  "signedFinancialAgreementFileId"    TEXT,

  "notes"                             TEXT,

  "createdAt"                         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                         TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "ortho_installments" (
  "id"                       TEXT PRIMARY KEY,
  "paymentPlanId"            TEXT NOT NULL,
  "clinicId"                 TEXT NOT NULL,

  "installmentNumber"        INTEGER NOT NULL,
  "amount"                   DECIMAL(10,2) NOT NULL,
  "dueDate"                  TIMESTAMP(3) NOT NULL,
  "status"                   "InstallmentStatus" NOT NULL DEFAULT 'PENDING',

  "paidAt"                   TIMESTAMP(3),
  "amountPaid"               DECIMAL(10,2),
  "paymentMethod"            "OrthoPaymentMethod",
  "receiptFileId"            TEXT,
  "recordedById"             TEXT,
  "backdatingJustification"  TEXT,

  "waivedAt"                 TIMESTAMP(3),
  "waivedById"               TEXT,
  "waiverReason"             TEXT,

  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "ortho_photo_sets" (
  "id"                    TEXT PRIMARY KEY,
  "treatmentPlanId"       TEXT NOT NULL,
  "patientId"             TEXT NOT NULL,
  "clinicId"              TEXT NOT NULL,

  "setType"               "OrthoPhotoSetType" NOT NULL,
  "capturedAt"            TIMESTAMP(3) NOT NULL,
  "capturedById"          TEXT NOT NULL,
  "monthInTreatment"      INTEGER,
  "notes"                 TEXT,

  "photoFrontalId"        TEXT,
  "photoProfileId"        TEXT,
  "photoSmileId"          TEXT,
  "photoIntraFrontalId"   TEXT,
  "photoIntraLateralRId"  TEXT,
  "photoIntraLateralLId"  TEXT,
  "photoOcclusalUpperId"  TEXT,
  "photoOcclusalLowerId"  TEXT,

  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "orthodontic_control_appointments" (
  "id"                       TEXT PRIMARY KEY,
  "treatmentPlanId"          TEXT NOT NULL,
  "patientId"                TEXT NOT NULL,
  "clinicId"                 TEXT NOT NULL,

  "scheduledAt"              TIMESTAMP(3) NOT NULL,
  "performedAt"              TIMESTAMP(3),
  "monthInTreatment"         INTEGER NOT NULL,
  "attendance"               "ControlAttendance" NOT NULL DEFAULT 'ATTENDED',
  "attendedById"             TEXT,

  "hygieneScore"             INTEGER,
  "bracketsLoose"            INTEGER,
  "bracketsBroken"           INTEGER,
  "appliancesIntact"         BOOLEAN,
  "patientReportsPain"       BOOLEAN NOT NULL DEFAULT false,
  "patientPainNotes"         TEXT,

  "adjustments"              "AdjustmentType"[] NOT NULL DEFAULT ARRAY[]::"AdjustmentType"[],
  "adjustmentNotes"          TEXT,

  "photoSetId"               TEXT,

  "nextAppointmentAt"        TIMESTAMP(3),
  "nextAppointmentNotes"     TEXT,

  "paymentStatusSnapshot"    "OrthoPaymentStatus",

  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "orthodontic_digital_records" (
  "id"               TEXT PRIMARY KEY,
  "treatmentPlanId"  TEXT NOT NULL,
  "patientId"        TEXT NOT NULL,
  "clinicId"         TEXT NOT NULL,

  "recordType"       "DigitalRecordType" NOT NULL,
  "fileId"           TEXT NOT NULL,
  "capturedAt"       TIMESTAMP(3) NOT NULL,
  "uploadedById"     TEXT NOT NULL,
  "notes"            TEXT,

  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "orthodontic_consents" (
  "id"                       TEXT PRIMARY KEY,
  "treatmentPlanId"          TEXT NOT NULL,
  "patientId"                TEXT NOT NULL,
  "clinicId"                 TEXT NOT NULL,

  "consentType"              "OrthoConsentType" NOT NULL,
  "signedAt"                 TIMESTAMP(3) NOT NULL,
  "signerName"               TEXT NOT NULL,
  "signerRelationship"       TEXT,
  "patientSignatureImage"    TEXT,
  "guardianSignatureImage"   TEXT,
  "signedFileId"             TEXT,
  "notes"                    TEXT,

  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── 4. FKs + índices ───────────────────────────────────────────────

-- orthodontic_diagnoses
DO $$ BEGIN
  ALTER TABLE "orthodontic_diagnoses"
    ADD CONSTRAINT "orthodontic_diagnoses_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_diagnoses"
    ADD CONSTRAINT "orthodontic_diagnoses_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_diagnoses"
    ADD CONSTRAINT "orthodontic_diagnoses_diagnosedById_fkey"
    FOREIGN KEY ("diagnosedById") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "orthodontic_diagnoses_initialPhotoSetId_key"
  ON "orthodontic_diagnoses"("initialPhotoSetId");
CREATE INDEX IF NOT EXISTS "orthodontic_diagnoses_patientId_idx"
  ON "orthodontic_diagnoses"("patientId");
CREATE INDEX IF NOT EXISTS "orthodontic_diagnoses_clinicId_diagnosedAt_idx"
  ON "orthodontic_diagnoses"("clinicId", "diagnosedAt" DESC);

-- orthodontic_treatment_plans
DO $$ BEGIN
  ALTER TABLE "orthodontic_treatment_plans"
    ADD CONSTRAINT "orthodontic_treatment_plans_diagnosisId_fkey"
    FOREIGN KEY ("diagnosisId") REFERENCES "orthodontic_diagnoses"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_treatment_plans"
    ADD CONSTRAINT "orthodontic_treatment_plans_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_treatment_plans"
    ADD CONSTRAINT "orthodontic_treatment_plans_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_treatment_plans"
    ADD CONSTRAINT "orthodontic_treatment_plans_signedTreatmentConsentFileId_fkey"
    FOREIGN KEY ("signedTreatmentConsentFileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "orthodontic_treatment_plans_diagnosisId_key"
  ON "orthodontic_treatment_plans"("diagnosisId");
CREATE INDEX IF NOT EXISTS "orthodontic_treatment_plans_patientId_idx"
  ON "orthodontic_treatment_plans"("patientId");
CREATE INDEX IF NOT EXISTS "orthodontic_treatment_plans_clinicId_status_idx"
  ON "orthodontic_treatment_plans"("clinicId", "status");
CREATE INDEX IF NOT EXISTS "orthodontic_treatment_plans_clinicId_installedAt_idx"
  ON "orthodontic_treatment_plans"("clinicId", "installedAt" DESC);

-- orthodontic_phases
DO $$ BEGIN
  ALTER TABLE "orthodontic_phases"
    ADD CONSTRAINT "orthodontic_phases_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_phases"
    ADD CONSTRAINT "orthodontic_phases_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "orthodontic_phases_treatmentPlanId_phaseKey_key"
  ON "orthodontic_phases"("treatmentPlanId", "phaseKey");
-- SPEC §4.5 — índice para query del kanban (clinicId+status+phaseKey).
CREATE INDEX IF NOT EXISTS "idx_ortho_kanban_lookup"
  ON "orthodontic_phases"("clinicId", "status", "phaseKey");
CREATE INDEX IF NOT EXISTS "orthodontic_phases_treatmentPlanId_orderIndex_idx"
  ON "orthodontic_phases"("treatmentPlanId", "orderIndex");

-- ortho_payment_plans
DO $$ BEGIN
  ALTER TABLE "ortho_payment_plans"
    ADD CONSTRAINT "ortho_payment_plans_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_payment_plans"
    ADD CONSTRAINT "ortho_payment_plans_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_payment_plans"
    ADD CONSTRAINT "ortho_payment_plans_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_payment_plans"
    ADD CONSTRAINT "ortho_payment_plans_signedFinancialAgreementFileId_fkey"
    FOREIGN KEY ("signedFinancialAgreementFileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ortho_payment_plans_treatmentPlanId_key"
  ON "ortho_payment_plans"("treatmentPlanId");
CREATE INDEX IF NOT EXISTS "ortho_payment_plans_clinicId_status_idx"
  ON "ortho_payment_plans"("clinicId", "status");
CREATE INDEX IF NOT EXISTS "ortho_payment_plans_patientId_idx"
  ON "ortho_payment_plans"("patientId");

-- ortho_installments
DO $$ BEGIN
  ALTER TABLE "ortho_installments"
    ADD CONSTRAINT "ortho_installments_paymentPlanId_fkey"
    FOREIGN KEY ("paymentPlanId") REFERENCES "ortho_payment_plans"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_installments"
    ADD CONSTRAINT "ortho_installments_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_installments"
    ADD CONSTRAINT "ortho_installments_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_installments"
    ADD CONSTRAINT "ortho_installments_waivedById_fkey"
    FOREIGN KEY ("waivedById") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_installments"
    ADD CONSTRAINT "ortho_installments_receiptFileId_fkey"
    FOREIGN KEY ("receiptFileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ortho_installments_paymentPlanId_installmentNumber_key"
  ON "ortho_installments"("paymentPlanId", "installmentNumber");
CREATE INDEX IF NOT EXISTS "ortho_installments_clinicId_dueDate_status_idx"
  ON "ortho_installments"("clinicId", "dueDate", "status");
CREATE INDEX IF NOT EXISTS "ortho_installments_clinicId_status_idx"
  ON "ortho_installments"("clinicId", "status");

-- ortho_photo_sets
DO $$ BEGIN
  ALTER TABLE "ortho_photo_sets"
    ADD CONSTRAINT "ortho_photo_sets_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_photo_sets"
    ADD CONSTRAINT "ortho_photo_sets_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_photo_sets"
    ADD CONSTRAINT "ortho_photo_sets_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_photo_sets"
    ADD CONSTRAINT "ortho_photo_sets_capturedById_fkey"
    FOREIGN KEY ("capturedById") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_photo_sets"
    ADD CONSTRAINT "ortho_photo_sets_photoFrontalId_fkey"
    FOREIGN KEY ("photoFrontalId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_photo_sets"
    ADD CONSTRAINT "ortho_photo_sets_photoProfileId_fkey"
    FOREIGN KEY ("photoProfileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_photo_sets"
    ADD CONSTRAINT "ortho_photo_sets_photoSmileId_fkey"
    FOREIGN KEY ("photoSmileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_photo_sets"
    ADD CONSTRAINT "ortho_photo_sets_photoIntraFrontalId_fkey"
    FOREIGN KEY ("photoIntraFrontalId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_photo_sets"
    ADD CONSTRAINT "ortho_photo_sets_photoIntraLateralRId_fkey"
    FOREIGN KEY ("photoIntraLateralRId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_photo_sets"
    ADD CONSTRAINT "ortho_photo_sets_photoIntraLateralLId_fkey"
    FOREIGN KEY ("photoIntraLateralLId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_photo_sets"
    ADD CONSTRAINT "ortho_photo_sets_photoOcclusalUpperId_fkey"
    FOREIGN KEY ("photoOcclusalUpperId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_photo_sets"
    ADD CONSTRAINT "ortho_photo_sets_photoOcclusalLowerId_fkey"
    FOREIGN KEY ("photoOcclusalLowerId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "ortho_photo_sets_treatmentPlanId_setType_idx"
  ON "ortho_photo_sets"("treatmentPlanId", "setType");
CREATE INDEX IF NOT EXISTS "ortho_photo_sets_clinicId_capturedAt_idx"
  ON "ortho_photo_sets"("clinicId", "capturedAt" DESC);

-- orthodontic_control_appointments
DO $$ BEGIN
  ALTER TABLE "orthodontic_control_appointments"
    ADD CONSTRAINT "orthodontic_control_appointments_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_control_appointments"
    ADD CONSTRAINT "orthodontic_control_appointments_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_control_appointments"
    ADD CONSTRAINT "orthodontic_control_appointments_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_control_appointments"
    ADD CONSTRAINT "orthodontic_control_appointments_attendedById_fkey"
    FOREIGN KEY ("attendedById") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "orthodontic_control_appointments_treatmentPlanId_month_idx"
  ON "orthodontic_control_appointments"("treatmentPlanId", "monthInTreatment");
CREATE INDEX IF NOT EXISTS "orthodontic_control_appointments_clinicId_scheduledAt_idx"
  ON "orthodontic_control_appointments"("clinicId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "orthodontic_control_appointments_clinicId_performedAt_idx"
  ON "orthodontic_control_appointments"("clinicId", "performedAt");

-- orthodontic_digital_records
DO $$ BEGIN
  ALTER TABLE "orthodontic_digital_records"
    ADD CONSTRAINT "orthodontic_digital_records_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_digital_records"
    ADD CONSTRAINT "orthodontic_digital_records_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_digital_records"
    ADD CONSTRAINT "orthodontic_digital_records_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_digital_records"
    ADD CONSTRAINT "orthodontic_digital_records_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "patient_files"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_digital_records"
    ADD CONSTRAINT "orthodontic_digital_records_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "orthodontic_digital_records_treatmentPlanId_recordType_idx"
  ON "orthodontic_digital_records"("treatmentPlanId", "recordType");

-- orthodontic_consents
DO $$ BEGIN
  ALTER TABLE "orthodontic_consents"
    ADD CONSTRAINT "orthodontic_consents_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_consents"
    ADD CONSTRAINT "orthodontic_consents_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_consents"
    ADD CONSTRAINT "orthodontic_consents_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_consents"
    ADD CONSTRAINT "orthodontic_consents_signedFileId_fkey"
    FOREIGN KEY ("signedFileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "orthodontic_consents_treatmentPlanId_consentType_idx"
  ON "orthodontic_consents"("treatmentPlanId", "consentType");

-- ── 5. CHECK constraints ───────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "orthodontic_diagnoses"
    ADD CONSTRAINT "orthodontic_diagnoses_overbite_chk"
    CHECK ("overbiteMm" BETWEEN -10 AND 15
       AND "overbitePercentage" BETWEEN 0 AND 100
       AND "overjetMm" BETWEEN -5 AND 20);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "orthodontic_treatment_plans"
    ADD CONSTRAINT "orthodontic_treatment_plans_duration_chk"
    CHECK ("estimatedDurationMonths" BETWEEN 3 AND 60
       AND "totalCostMxn" > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- DROPPED_OUT requiere droppedOutAt + droppedOutReason ≥20 chars (SPEC §4.5).
DO $$ BEGIN
  ALTER TABLE "orthodontic_treatment_plans"
    ADD CONSTRAINT "orthodontic_treatment_plans_dropped_out_chk"
    CHECK (
      "status" <> 'DROPPED_OUT'
      OR ("droppedOutAt" IS NOT NULL AND length(coalesce("droppedOutReason", '')) >= 20)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_payment_plans"
    ADD CONSTRAINT "ortho_payment_plans_count_chk"
    CHECK ("installmentCount" BETWEEN 1 AND 60
       AND "paymentDayOfMonth" BETWEEN 1 AND 28);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_installments"
    ADD CONSTRAINT "ortho_installments_amount_chk"
    CHECK ("amount" > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- paidAt nullability tied — paidAt y amountPaid y paymentMethod van juntos.
-- SPEC §4.5: (paidAt IS NULL) = (amountPaid IS NULL AND paymentMethod IS NULL).
DO $$ BEGIN
  ALTER TABLE "ortho_installments"
    ADD CONSTRAINT "ortho_installments_paid_atomicity_chk"
    CHECK (
      ("paidAt" IS NULL AND "amountPaid" IS NULL AND "paymentMethod" IS NULL)
      OR ("paidAt" IS NOT NULL AND "amountPaid" IS NOT NULL AND "paymentMethod" IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Waiver requiere waiverReason ≥20 chars cuando hay waivedAt.
DO $$ BEGIN
  ALTER TABLE "ortho_installments"
    ADD CONSTRAINT "ortho_installments_waiver_chk"
    CHECK (
      "waivedAt" IS NULL
      OR length(coalesce("waiverReason", '')) >= 20
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 6. RLS deny-all en las 9 tablas ────────────────────────────────
-- Defensa adicional: el patrón MediFlow usa service role bypass + filtros
-- explícitos por clinicId. Las policies deny-all bloquean acceso vía
-- anon/authenticated si alguien expone la BD por error.

DO $$
DECLARE
  ortho_table TEXT;
BEGIN
  FOR ortho_table IN
    SELECT unnest(ARRAY[
      'orthodontic_diagnoses',
      'orthodontic_treatment_plans',
      'orthodontic_phases',
      'ortho_payment_plans',
      'ortho_installments',
      'ortho_photo_sets',
      'orthodontic_control_appointments',
      'orthodontic_digital_records',
      'orthodontic_consents'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', ortho_table);
    EXECUTE format(
      'DROP POLICY IF EXISTS "deny_all_anon_%s" ON %I',
      ortho_table, ortho_table
    );
    EXECUTE format(
      'CREATE POLICY "deny_all_anon_%s" ON %I AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false)',
      ortho_table, ortho_table
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS "deny_all_authenticated_%s" ON %I',
      ortho_table, ortho_table
    );
    EXECUTE format(
      'CREATE POLICY "deny_all_authenticated_%s" ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false)',
      ortho_table, ortho_table
    );
  END LOOP;
END $$;

-- ── 7. Trigger recalc_payment_plan_status ──────────────────────────
-- Tras INSERT/UPDATE en ortho_installments, recalcula paidAmount,
-- pendingAmount y status del plan asociado. Idempotente.
--
-- Mapping de status (defensa primaria del cron Vercel — aquí se hace
-- el cálculo determinista al momento de modificar un installment):
--   - Todas PAID/WAIVED → PAID_IN_FULL
--   - Alguna OVERDUE >30 días sobre due → SEVERE_DELAY
--   - Alguna OVERDUE 1-30 días              → LIGHT_DELAY
--   - Caso contrario                        → ON_TIME

CREATE OR REPLACE FUNCTION ortho_recalc_payment_plan_status()
RETURNS TRIGGER AS $$
DECLARE
  v_paid       DECIMAL(10,2);
  v_total      DECIMAL(10,2);
  v_initial    DECIMAL(10,2);
  v_pending    DECIMAL(10,2);
  v_max_delay  INTEGER;
  v_pending_count INTEGER;
  v_new_status "OrthoPaymentStatus";
  v_plan_id    TEXT;
BEGIN
  v_plan_id := COALESCE(NEW."paymentPlanId", OLD."paymentPlanId");
  IF v_plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Suma de amountPaid de installments PAID y suma de amount de WAIVED.
  SELECT COALESCE(SUM(CASE
                       WHEN "status" = 'PAID' THEN "amountPaid"
                       WHEN "status" = 'WAIVED' THEN "amount"
                       ELSE 0
                     END), 0)
    INTO v_paid
    FROM "ortho_installments"
    WHERE "paymentPlanId" = v_plan_id;

  SELECT "totalAmount", "initialDownPayment"
    INTO v_total, v_initial
    FROM "ortho_payment_plans"
    WHERE "id" = v_plan_id;

  -- paidAmount incluye el enganche ya pagado al inicio del plan.
  v_paid := v_paid + COALESCE(v_initial, 0);
  v_pending := GREATEST(v_total - v_paid, 0);

  -- Días de retraso del installment más vencido sin pago.
  SELECT COALESCE(MAX(EXTRACT(DAY FROM (NOW() - "dueDate"))::INTEGER), 0),
         COUNT(*) FILTER (WHERE "status" IN ('PENDING', 'OVERDUE'))
    INTO v_max_delay, v_pending_count
    FROM "ortho_installments"
    WHERE "paymentPlanId" = v_plan_id
      AND "paidAt" IS NULL
      AND "status" <> 'WAIVED'
      AND "dueDate" < NOW();

  IF v_pending_count = 0 AND v_pending <= 0 THEN
    v_new_status := 'PAID_IN_FULL';
  ELSIF v_max_delay > 30 THEN
    v_new_status := 'SEVERE_DELAY';
  ELSIF v_max_delay >= 1 THEN
    v_new_status := 'LIGHT_DELAY';
  ELSE
    v_new_status := 'ON_TIME';
  END IF;

  UPDATE "ortho_payment_plans"
     SET "paidAmount" = v_paid,
         "pendingAmount" = v_pending,
         "status" = v_new_status,
         "statusUpdatedAt" = NOW()
   WHERE "id" = v_plan_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recalc_payment_plan_status ON "ortho_installments";
CREATE TRIGGER recalc_payment_plan_status
AFTER INSERT OR UPDATE OF "status", "paidAt", "amountPaid", "amount"
ON "ortho_installments"
FOR EACH ROW
EXECUTE FUNCTION ortho_recalc_payment_plan_status();
