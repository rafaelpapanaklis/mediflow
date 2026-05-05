-- ═══════════════════════════════════════════════════════════════════
-- Implants module — schema (foundation)
--
-- CONTEXTO
-- 9 modelos clínicos para Implantología (módulo 4/5 del marketplace):
-- Implant, ImplantSurgicalRecord, ImplantHealingPhase,
-- ImplantSecondStageSurgery, ImplantProstheticPhase, ImplantComplication,
-- ImplantFollowUp, ImplantConsent, ImplantPassport. Reutiliza
-- PatientFile para radiografías peri-implantarias / foto intraoperatoria
-- / foto del paciente para el carnet / PDF del carnet / consentimiento
-- firmado. NO se crea modelo Radiography (ver SPEC §1).
--
-- COFEPRIS clase III (regulación legal — NO negociable)
-- - Trigger `block_implant_delete` rechaza DELETE a nivel DB.
-- - Trigger `protect_implant_traceability` valida flag de sesión
--   `app.implant_mutation_justified` antes de permitir UPDATE en
--   brand / lotNumber / placedAt. Server action
--   updateImplantTraceability hace SET LOCAL antes del UPDATE.
-- - CHECK constraints: removal integrity (status REMOVED requiere
--   removedAt + removalReason ≥20 chars), brandCustomName si OTRO,
--   diámetro / longitud / torque / ISQ en rangos clínicos válidos,
--   FDI válido (11..18, 21..28, 31..38, 41..48).
-- - Índice idx_implant_brand_lot para queries de recall <200ms.
--
-- IDEMPOTENTE: usa IF NOT EXISTS, DO $$ guards y CREATE POLICY guards.
-- Se puede re-correr múltiples veces sin efectos colaterales. Listo
-- para pegar en Supabase SQL Editor.
--
-- ORDEN
--   1. Enums (12 nuevos + 2 valores agregados a FileCategory)
--   2. Tablas (9) con onDelete según tipo
--   3. Índices (incluyendo idx_implant_brand_lot para recall)
--   4. Foreign keys
--   5. CHECK constraints (rangos clínicos + integridad COFEPRIS)
--   6. Triggers (block_implant_delete + protect_implant_traceability)
--   7. RLS deny-all en las 9 tablas nuevas
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Enums ───────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "ImplantBrand" AS ENUM (
    'STRAUMANN', 'NOBEL_BIOCARE', 'NEODENT', 'MIS', 'BIOHORIZONS',
    'ZIMMER_BIOMET', 'IMPLANT_DIRECT', 'ODONTIT', 'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ImplantConnectionType" AS ENUM (
    'EXTERNAL_HEX', 'INTERNAL_HEX', 'CONICAL_MORSE', 'TRI_CHANNEL', 'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ImplantSurfaceTreatment" AS ENUM (
    'SLA', 'SLActive', 'TiUnite', 'OsseoSpeed', 'LASER_LOK', 'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "LekholmZarbDensity" AS ENUM ('D1', 'D2', 'D3', 'D4');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ImplantStatus" AS ENUM (
    'PLANNED', 'PLACED', 'OSSEOINTEGRATING', 'UNCOVERED',
    'LOADED_PROVISIONAL', 'LOADED_DEFINITIVE', 'FUNCTIONAL',
    'COMPLICATION', 'FAILED', 'REMOVED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ImplantProtocol" AS ENUM (
    'ONE_STAGE', 'TWO_STAGE',
    'IMMEDIATE_PLACEMENT_DELAYED_LOADING',
    'IMMEDIATE_PLACEMENT_IMMEDIATE_LOADING',
    'DELAYED_PLACEMENT_IMMEDIATE_LOADING'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AbutmentType" AS ENUM (
    'PREFABRICATED_TI', 'CUSTOM_TI', 'CUSTOM_ZIRCONIA',
    'MULTI_UNIT_STRAIGHT', 'MULTI_UNIT_ANGLED_17', 'MULTI_UNIT_ANGLED_30',
    'HEALING_ABUTMENT', 'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ProsthesisType" AS ENUM (
    'SCREW_RETAINED_SINGLE', 'CEMENT_RETAINED_SINGLE',
    'SCREW_RETAINED_MULTI', 'CEMENT_RETAINED_MULTI',
    'OVERDENTURE_LOCATOR', 'OVERDENTURE_BAR',
    'ALL_ON_4', 'ALL_ON_6', 'PROVISIONAL_ACRYLIC'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ProsthesisMaterial" AS ENUM (
    'ZIRCONIA_MONOLITHIC', 'PORCELAIN_FUSED_TO_METAL',
    'PORCELAIN_FUSED_TO_ZIRCONIA', 'LITHIUM_DISILICATE',
    'ACRYLIC_PROVISIONAL', 'PMMA_PROVISIONAL',
    'HYBRID_TITANIUM_ACRYLIC', 'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ImplantComplicationType" AS ENUM (
    'PERI_IMPLANT_MUCOSITIS',
    'PERI_IMPLANTITIS_INITIAL', 'PERI_IMPLANTITIS_MODERATE', 'PERI_IMPLANTITIS_ADVANCED',
    'SCREW_LOOSENING', 'ABUTMENT_SCREW_FRACTURE',
    'PROSTHESIS_FRACTURE', 'IMPLANT_FRACTURE',
    'NERVE_DAMAGE_TRANSIENT', 'NERVE_DAMAGE_PERMANENT',
    'SINUS_PERFORATION', 'SINUS_INFECTION',
    'OSSEOINTEGRATION_FAILURE', 'AESTHETIC_COMPLICATION', 'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ASAClassification" AS ENUM (
    'ASA_I', 'ASA_II', 'ASA_III', 'ASA_IV', 'ASA_V'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ImplantFollowUpMilestone" AS ENUM (
    'M_1_WEEK', 'M_2_WEEKS', 'M_1_MONTH', 'M_3_MONTHS',
    'M_6_MONTHS', 'M_12_MONTHS', 'M_24_MONTHS',
    'M_5_YEARS', 'M_10_YEARS', 'UNSCHEDULED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ImplantConsentType" AS ENUM (
    'SURGERY', 'BONE_AUGMENTATION', 'QR_PUBLIC'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "BoneGraftSource" AS ENUM (
    'AUTOLOGOUS', 'ALLOGRAFT_HUMAN',
    'XENOGRAFT_BOVINE', 'XENOGRAFT_PORCINE',
    'SYNTHETIC_BIOACTIVE_GLASS', 'SYNTHETIC_HYDROXYAPATITE',
    'SYNTHETIC_TCP', 'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Valores agregados al enum existente FileCategory para soportar la
-- foto del paciente para el carnet y el CBCT de planeación (v1.1).
ALTER TYPE "FileCategory" ADD VALUE IF NOT EXISTS 'XRAY_CBCT';
ALTER TYPE "FileCategory" ADD VALUE IF NOT EXISTS 'PHOTO_PATIENT';


-- ── 2. Tablas (9) ──────────────────────────────────────────────────

-- ── 2.1 Tabla "implants" (entidad central, COFEPRIS clase III) ─────

CREATE TABLE IF NOT EXISTS "implants" (
  "id"                       TEXT                       PRIMARY KEY,
  "patientId"                TEXT                       NOT NULL,
  "clinicId"                 TEXT                       NOT NULL,

  "toothFdi"                 INTEGER                    NOT NULL,

  -- Trazabilidad COFEPRIS clase III (INMUTABLE)
  "brand"                    "ImplantBrand"             NOT NULL,
  "brandCustomName"          TEXT,
  "modelName"                TEXT                       NOT NULL,
  "diameterMm"               DECIMAL(3, 1)              NOT NULL,
  "lengthMm"                 DECIMAL(4, 1)              NOT NULL,
  "connectionType"           "ImplantConnectionType"    NOT NULL,
  "surfaceTreatment"         "ImplantSurfaceTreatment",
  "lotNumber"                TEXT                       NOT NULL,
  "manufactureDate"          TIMESTAMP(3),
  "expiryDate"               TIMESTAMP(3),

  "placedAt"                 TIMESTAMP(3)               NOT NULL,
  "placedByDoctorId"         TEXT                       NOT NULL,

  "protocol"                 "ImplantProtocol"          NOT NULL,
  "currentStatus"            "ImplantStatus"            NOT NULL DEFAULT 'PLACED',
  "statusUpdatedAt"          TIMESTAMP(3)               NOT NULL DEFAULT NOW(),

  "removedAt"                TIMESTAMP(3),
  "removalReason"            TEXT,
  "removalSurgeryRecordId"   TEXT,

  "notes"                    TEXT,

  "createdByUserId"          TEXT                       NOT NULL,
  "createdAt"                TIMESTAMP(3)               NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3)               NOT NULL
  -- INTENCIONAL: NO existe deletedAt — la semántica de "borrar" es REMOVED
);

CREATE INDEX IF NOT EXISTS "implants_patient_status_idx"
  ON "implants"("patientId", "currentStatus");
CREATE INDEX IF NOT EXISTS "implants_clinic_status_idx"
  ON "implants"("clinicId", "currentStatus");
CREATE INDEX IF NOT EXISTS "implants_clinic_placed_idx"
  ON "implants"("clinicId", "placedAt" DESC);
-- Índice de recall por lote — query <200ms con miles de implantes
CREATE INDEX IF NOT EXISTS "idx_implant_brand_lot"
  ON "implants"("brand", "lotNumber");
CREATE INDEX IF NOT EXISTS "implants_tooth_idx"
  ON "implants"("toothFdi");


-- ── 2.2 Tabla "implant_surgical_records" ──────────────────────────

CREATE TABLE IF NOT EXISTS "implant_surgical_records" (
  "id"                          TEXT                  PRIMARY KEY,
  "implantId"                   TEXT                  NOT NULL,
  "performedAt"                 TIMESTAMP(3)          NOT NULL,
  "asaClassification"           "ASAClassification"   NOT NULL,
  "prophylaxisAntibiotic"       BOOLEAN               NOT NULL DEFAULT false,
  "prophylaxisDrug"             TEXT,
  "hba1cIfDiabetic"             DECIMAL(3, 1),
  "insertionTorqueNcm"          INTEGER               NOT NULL,
  "isqMesiodistal"              INTEGER               NOT NULL,
  "isqVestibulolingual"         INTEGER               NOT NULL,
  "boneDensity"                 "LekholmZarbDensity"  NOT NULL,
  "ridgeWidthMm"                DECIMAL(3, 1),
  "ridgeHeightMm"               DECIMAL(4, 1),
  "flapType"                    TEXT                  NOT NULL,
  "drillingProtocol"            TEXT                  NOT NULL,
  "healingAbutmentLot"          TEXT,
  "healingAbutmentDiameterMm"   DECIMAL(3, 1),
  "healingAbutmentHeightMm"     DECIMAL(3, 1),
  "sutureMaterial"              TEXT,
  "sutureRemovalScheduledAt"    TIMESTAMP(3),
  "intraoperativePhotoFileId"   TEXT,
  "postOpInstructions"          TEXT,
  "durationMinutes"             INTEGER               NOT NULL,
  "complications"               TEXT,
  "createdByUserId"             TEXT                  NOT NULL,
  "createdAt"                   TIMESTAMP(3)          NOT NULL DEFAULT NOW(),
  "updatedAt"                   TIMESTAMP(3)          NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "implant_surgical_implant_unique"
  ON "implant_surgical_records"("implantId");
CREATE INDEX IF NOT EXISTS "implant_surgical_performed_idx"
  ON "implant_surgical_records"("performedAt");


-- ── 2.3 Tabla "implant_healing_phases" ────────────────────────────

CREATE TABLE IF NOT EXISTS "implant_healing_phases" (
  "id"                       TEXT          PRIMARY KEY,
  "implantId"                TEXT          NOT NULL,
  "startedAt"                TIMESTAMP(3)  NOT NULL,
  "expectedDurationWeeks"    INTEGER       NOT NULL,
  "isqAt2Weeks"              INTEGER,
  "isqAt4Weeks"              INTEGER,
  "isqAt8Weeks"              INTEGER,
  "isqLatest"                INTEGER,
  "isqLatestAt"              TIMESTAMP(3),
  "completedAt"              TIMESTAMP(3),
  "notes"                    TEXT,
  "createdByUserId"          TEXT          NOT NULL,
  "createdAt"                TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3)  NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "implant_healing_implant_unique"
  ON "implant_healing_phases"("implantId");


-- ── 2.4 Tabla "implant_second_stage_surgeries" ────────────────────

CREATE TABLE IF NOT EXISTS "implant_second_stage_surgeries" (
  "id"                          TEXT          PRIMARY KEY,
  "implantId"                   TEXT          NOT NULL,
  "performedAt"                 TIMESTAMP(3)  NOT NULL,
  "technique"                   TEXT          NOT NULL,
  "healingAbutmentLot"          TEXT          NOT NULL,
  "healingAbutmentDiameterMm"   DECIMAL(3, 1) NOT NULL,
  "healingAbutmentHeightMm"     DECIMAL(3, 1) NOT NULL,
  "isqAtUncovering"             INTEGER,
  "durationMinutes"             INTEGER       NOT NULL,
  "notes"                       TEXT,
  "createdByUserId"             TEXT          NOT NULL,
  "createdAt"                   TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"                   TIMESTAMP(3)  NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "implant_second_stage_implant_unique"
  ON "implant_second_stage_surgeries"("implantId");


-- ── 2.5 Tabla "implant_prosthetic_phases" ─────────────────────────

CREATE TABLE IF NOT EXISTS "implant_prosthetic_phases" (
  "id"                          TEXT                  PRIMARY KEY,
  "implantId"                   TEXT                  NOT NULL,
  "abutmentType"                "AbutmentType"        NOT NULL,
  "abutmentBrand"               TEXT,
  "abutmentLot"                 TEXT                  NOT NULL,
  "abutmentDiameterMm"          DECIMAL(3, 1),
  "abutmentHeightMm"            DECIMAL(3, 1),
  "abutmentAngulationDeg"       INTEGER,
  "abutmentTorqueNcm"           INTEGER               NOT NULL,
  "prosthesisType"              "ProsthesisType"      NOT NULL,
  "prosthesisMaterial"          "ProsthesisMaterial"  NOT NULL,
  "prosthesisLabName"           TEXT                  NOT NULL,
  "prosthesisLabLot"            TEXT                  NOT NULL,
  "screwLot"                    TEXT,
  "screwTorqueNcm"              INTEGER,
  "immediateLoading"            BOOLEAN               NOT NULL DEFAULT false,
  "provisionalDeliveredAt"      TIMESTAMP(3),
  "definitiveDeliveredAt"       TIMESTAMP(3),
  "prosthesisDeliveredAt"       TIMESTAMP(3)          NOT NULL,
  "occlusionScheme"             TEXT,
  "notes"                       TEXT,
  "createdByUserId"             TEXT                  NOT NULL,
  "createdAt"                   TIMESTAMP(3)          NOT NULL DEFAULT NOW(),
  "updatedAt"                   TIMESTAMP(3)          NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "implant_prosthetic_implant_unique"
  ON "implant_prosthetic_phases"("implantId");


-- ── 2.6 Tabla "implant_complications" ─────────────────────────────

CREATE TABLE IF NOT EXISTS "implant_complications" (
  "id"                          TEXT                       PRIMARY KEY,
  "implantId"                   TEXT                       NOT NULL,
  "clinicId"                    TEXT                       NOT NULL,
  "patientId"                   TEXT                       NOT NULL,
  "detectedAt"                  TIMESTAMP(3)               NOT NULL,
  "type"                        "ImplantComplicationType"  NOT NULL,
  "severity"                    TEXT                       NOT NULL,
  "description"                 TEXT                       NOT NULL,
  "bopAtDiagnosis"              BOOLEAN,
  "pdMaxAtDiagnosisMm"          DECIMAL(3, 1),
  "suppurationAtDiagnosis"      BOOLEAN,
  "radiographicBoneLossMm"      DECIMAL(3, 1),
  "treatmentPlan"               TEXT,
  "resolvedAt"                  TIMESTAMP(3),
  "outcome"                     TEXT,
  "createdByUserId"             TEXT                       NOT NULL,
  "createdAt"                   TIMESTAMP(3)               NOT NULL DEFAULT NOW(),
  "updatedAt"                   TIMESTAMP(3)               NOT NULL
);
CREATE INDEX IF NOT EXISTS "implant_complications_implant_idx"
  ON "implant_complications"("implantId", "detectedAt" DESC);
CREATE INDEX IF NOT EXISTS "implant_complications_clinic_type_idx"
  ON "implant_complications"("clinicId", "type");
CREATE INDEX IF NOT EXISTS "implant_complications_clinic_resolved_idx"
  ON "implant_complications"("clinicId", "resolvedAt");


-- ── 2.7 Tabla "implant_follow_ups" ────────────────────────────────

CREATE TABLE IF NOT EXISTS "implant_follow_ups" (
  "id"                          TEXT                          PRIMARY KEY,
  "implantId"                   TEXT                          NOT NULL,
  "clinicId"                    TEXT                          NOT NULL,
  "milestone"                   "ImplantFollowUpMilestone"    NOT NULL,
  "scheduledAt"                 TIMESTAMP(3),
  "performedAt"                 TIMESTAMP(3),
  "bopPresent"                  BOOLEAN,
  "pdMaxMm"                     DECIMAL(3, 1),
  "suppuration"                 BOOLEAN,
  "mobility"                    BOOLEAN,
  "occlusionStable"             BOOLEAN,
  "radiographicBoneLossMm"      DECIMAL(3, 1),
  "meetsAlbrektssonCriteria"    BOOLEAN,
  "radiographFileId"            TEXT,
  "nextControlAt"               TIMESTAMP(3),
  "notes"                       TEXT,
  "createdByUserId"             TEXT                          NOT NULL,
  "createdAt"                   TIMESTAMP(3)                  NOT NULL DEFAULT NOW(),
  "updatedAt"                   TIMESTAMP(3)                  NOT NULL
);
CREATE INDEX IF NOT EXISTS "implant_followup_implant_scheduled_idx"
  ON "implant_follow_ups"("implantId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "implant_followup_clinic_performed_idx"
  ON "implant_follow_ups"("clinicId", "performedAt");
-- Para query de overdue: scheduledAt < now() AND performedAt IS NULL
CREATE INDEX IF NOT EXISTS "implant_followup_overdue_idx"
  ON "implant_follow_ups"("scheduledAt", "performedAt");


-- ── 2.8 Tabla "implant_consents" ──────────────────────────────────

CREATE TABLE IF NOT EXISTS "implant_consents" (
  "id"                       TEXT                   PRIMARY KEY,
  "implantId"                TEXT                   NOT NULL,
  "patientId"                TEXT                   NOT NULL,
  "doctorId"                 TEXT                   NOT NULL,
  "consentType"              "ImplantConsentType"   NOT NULL,
  "text"                     TEXT                   NOT NULL,
  "acceptedRisks"            JSONB,
  "signedAt"                 TIMESTAMP(3),
  "patientSignatureImage"    TEXT,
  "signedFileId"             TEXT,
  "revokedAt"                TIMESTAMP(3),
  "revocationReason"         TEXT,
  "createdByUserId"          TEXT                   NOT NULL,
  "createdAt"                TIMESTAMP(3)           NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3)           NOT NULL
);
CREATE INDEX IF NOT EXISTS "implant_consents_implant_type_idx"
  ON "implant_consents"("implantId", "consentType");


-- ── 2.9 Tabla "implant_passports" (carnet horizontal landscape) ───

CREATE TABLE IF NOT EXISTS "implant_passports" (
  "id"                       TEXT          PRIMARY KEY,
  "implantId"                TEXT          NOT NULL,
  "generatedAt"              TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "regeneratedAt"            TIMESTAMP(3),
  "pdfFileId"                TEXT,
  "patientPhotoFileId"       TEXT,
  "qrPublicEnabled"          BOOLEAN       NOT NULL DEFAULT false,
  "qrPublicConsentId"        TEXT,
  "qrToken"                  TEXT,
  "createdByUserId"          TEXT          NOT NULL,
  "createdAt"                TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3)  NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "implant_passports_implant_unique"
  ON "implant_passports"("implantId");
CREATE UNIQUE INDEX IF NOT EXISTS "implant_passports_qr_token_unique"
  ON "implant_passports"("qrToken")
  WHERE "qrToken" IS NOT NULL;


-- ── 3. Foreign keys ────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "implants"
    ADD CONSTRAINT "implant_patient_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "implants"
    ADD CONSTRAINT "implant_clinic_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "implants"
    ADD CONSTRAINT "implant_doctor_fkey"
    FOREIGN KEY ("placedByDoctorId") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "implant_surgical_records"
    ADD CONSTRAINT "implant_surgical_implant_fkey"
    FOREIGN KEY ("implantId") REFERENCES "implants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "implant_surgical_records"
    ADD CONSTRAINT "implant_surgical_intraop_fkey"
    FOREIGN KEY ("intraoperativePhotoFileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "implant_healing_phases"
    ADD CONSTRAINT "implant_healing_implant_fkey"
    FOREIGN KEY ("implantId") REFERENCES "implants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "implant_second_stage_surgeries"
    ADD CONSTRAINT "implant_second_stage_implant_fkey"
    FOREIGN KEY ("implantId") REFERENCES "implants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "implant_prosthetic_phases"
    ADD CONSTRAINT "implant_prosthetic_implant_fkey"
    FOREIGN KEY ("implantId") REFERENCES "implants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "implant_complications"
    ADD CONSTRAINT "implant_complications_implant_fkey"
    FOREIGN KEY ("implantId") REFERENCES "implants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "implant_follow_ups"
    ADD CONSTRAINT "implant_followup_implant_fkey"
    FOREIGN KEY ("implantId") REFERENCES "implants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "implant_follow_ups"
    ADD CONSTRAINT "implant_followup_radiograph_fkey"
    FOREIGN KEY ("radiographFileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "implant_consents"
    ADD CONSTRAINT "implant_consent_implant_fkey"
    FOREIGN KEY ("implantId") REFERENCES "implants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "implant_consents"
    ADD CONSTRAINT "implant_consent_patient_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "implant_consents"
    ADD CONSTRAINT "implant_consent_doctor_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "implant_consents"
    ADD CONSTRAINT "implant_consent_signed_file_fkey"
    FOREIGN KEY ("signedFileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "implant_passports"
    ADD CONSTRAINT "implant_passport_implant_fkey"
    FOREIGN KEY ("implantId") REFERENCES "implants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "implant_passports"
    ADD CONSTRAINT "implant_passport_pdf_fkey"
    FOREIGN KEY ("pdfFileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "implant_passports"
    ADD CONSTRAINT "implant_passport_photo_fkey"
    FOREIGN KEY ("patientPhotoFileId") REFERENCES "patient_files"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "implant_passports"
    ADD CONSTRAINT "implant_passport_qr_consent_fkey"
    FOREIGN KEY ("qrPublicConsentId") REFERENCES "implant_consents"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── 4. CHECK constraints (rangos clínicos + integridad COFEPRIS) ──

-- 4.1 FDI válido en implants: cuadrantes 1-4, dientes 1-8
DO $$ BEGIN
  ALTER TABLE "implants"
    ADD CONSTRAINT "implant_tooth_fdi_valid"
    CHECK (
      ("toothFdi" BETWEEN 11 AND 18) OR
      ("toothFdi" BETWEEN 21 AND 28) OR
      ("toothFdi" BETWEEN 31 AND 38) OR
      ("toothFdi" BETWEEN 41 AND 48)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.2 Diámetro 3.0..7.0 mm
DO $$ BEGIN
  ALTER TABLE "implants"
    ADD CONSTRAINT "implant_diameter_valid"
    CHECK ("diameterMm" BETWEEN 3.0 AND 7.0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.3 Longitud 6.0..18.0 mm
DO $$ BEGIN
  ALTER TABLE "implants"
    ADD CONSTRAINT "implant_length_valid"
    CHECK ("lengthMm" BETWEEN 6.0 AND 18.0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.4 brand=OTRO requiere brandCustomName
DO $$ BEGIN
  ALTER TABLE "implants"
    ADD CONSTRAINT "implant_brand_other_requires_name"
    CHECK ("brand" <> 'OTRO' OR ("brandCustomName" IS NOT NULL AND length("brandCustomName") > 0));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.5 Lote no vacío (COFEPRIS)
DO $$ BEGIN
  ALTER TABLE "implants"
    ADD CONSTRAINT "implant_lot_not_empty"
    CHECK (length("lotNumber") >= 1);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.6 Integridad de remoción: status REMOVED requiere removedAt + reason ≥20 chars
DO $$ BEGIN
  ALTER TABLE "implants"
    ADD CONSTRAINT "implant_removal_integrity"
    CHECK (
      "currentStatus" <> 'REMOVED' OR (
        "removedAt" IS NOT NULL AND
        "removalReason" IS NOT NULL AND
        length("removalReason") >= 20
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.7 Manufactura anterior a expiración (si ambos presentes)
DO $$ BEGIN
  ALTER TABLE "implants"
    ADD CONSTRAINT "implant_manufacture_before_expiry"
    CHECK ("manufactureDate" IS NULL OR "expiryDate" IS NULL OR "manufactureDate" < "expiryDate");
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.8 Torque inserción razonable (5..100 Ncm)
DO $$ BEGIN
  ALTER TABLE "implant_surgical_records"
    ADD CONSTRAINT "implant_surgical_torque_valid"
    CHECK ("insertionTorqueNcm" BETWEEN 5 AND 100);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.9 ISQ rango (30..90)
DO $$ BEGIN
  ALTER TABLE "implant_surgical_records"
    ADD CONSTRAINT "implant_surgical_isq_md_valid"
    CHECK ("isqMesiodistal" BETWEEN 30 AND 90);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "implant_surgical_records"
    ADD CONSTRAINT "implant_surgical_isq_vl_valid"
    CHECK ("isqVestibulolingual" BETWEEN 30 AND 90);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.10 Severidad de complicación restringida
DO $$ BEGIN
  ALTER TABLE "implant_complications"
    ADD CONSTRAINT "implant_complications_severity_valid"
    CHECK ("severity" IN ('leve', 'moderada', 'severa'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.11 Abutment torque razonable
DO $$ BEGIN
  ALTER TABLE "implant_prosthetic_phases"
    ADD CONSTRAINT "implant_prosthetic_abutment_torque_valid"
    CHECK ("abutmentTorqueNcm" BETWEEN 5 AND 60);
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ═══════════════════════════════════════════════════════════════════
-- 5. Triggers — defensa en profundidad COFEPRIS
--
-- TRIGGER 1 `block_implant_delete`
--   Bloquea cualquier DELETE sobre "implants". La semántica de "borrar"
--   es UPDATE de `currentStatus` a REMOVED + `removalReason` ≥20.
--   Defensa contra DELETE accidental por consola SQL o bug de aplicación.
--
-- TRIGGER 2 `protect_implant_traceability`
--   Valida flag de sesión `app.implant_mutation_justified = 'true'`
--   antes de permitir UPDATE en brand / lotNumber / placedAt.
--   La server action `updateImplantTraceability` ejecuta
--   `SET LOCAL app.implant_mutation_justified = 'true'` dentro de la
--   transacción ANTES del UPDATE; el flag dura solo lo que dura la
--   transacción. Cualquier otro path (consola SQL, bug, copy/paste)
--   falla con RAISE EXCEPTION.
--
--   PRECAUCIÓN: si Supabase pooler ignora SET LOCAL (escenario
--   conocido con prepared statements de prisma + pgbouncer en transaction
--   mode), este trigger romperá la action. Validar con:
--     BEGIN; SET LOCAL app.implant_mutation_justified='true';
--       UPDATE "implants" SET "lotNumber"='TEST' WHERE id='...';
--     COMMIT;
--   Si falla con "permission denied for COFEPRIS traceability...", ejecutar:
--     DROP TRIGGER IF EXISTS protect_implant_traceability_trg ON "implants";
--   La validación queda entonces SOLO en server action (justification
--   ≥20 chars + audit log), que sigue siendo la garantía principal.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION block_implant_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'COFEPRIS: DELETE en implants prohibido. Use UPDATE currentStatus = REMOVED + removalReason ≥20 chars (implant id=%).',
    OLD."id"
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS block_implant_delete_trg ON "implants";
CREATE TRIGGER block_implant_delete_trg
  BEFORE DELETE ON "implants"
  FOR EACH ROW
  EXECUTE FUNCTION block_implant_delete();


CREATE OR REPLACE FUNCTION protect_implant_traceability()
RETURNS trigger AS $$
DECLARE
  flag_value TEXT;
BEGIN
  -- Si NO cambia ninguno de los 3 campos COFEPRIS, dejar pasar
  IF NEW."brand" = OLD."brand"
     AND NEW."lotNumber" = OLD."lotNumber"
     AND NEW."placedAt" = OLD."placedAt"
  THEN
    RETURN NEW;
  END IF;

  -- Algún campo COFEPRIS cambió — exigir flag de sesión
  flag_value := current_setting('app.implant_mutation_justified', true);

  IF flag_value IS NULL OR flag_value <> 'true' THEN
    RAISE EXCEPTION
      'COFEPRIS: brand/lotNumber/placedAt son inmutables. UPDATE requiere SET LOCAL app.implant_mutation_justified=''true'' + justificación ≥20 chars en audit log (implant id=%).',
      OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_implant_traceability_trg ON "implants";
CREATE TRIGGER protect_implant_traceability_trg
  BEFORE UPDATE ON "implants"
  FOR EACH ROW
  EXECUTE FUNCTION protect_implant_traceability();


-- ═══════════════════════════════════════════════════════════════════
-- 6. RLS deny-all en las 9 tablas nuevas (defensa en profundidad)
--
-- Mismo patrón que sql/rls-deny-all-policies.sql: RESTRICTIVE policy
-- que bloquea todo acceso desde anon/authenticated. MediFlow accede a
-- estas tablas vía Prisma + service role (bypassa RLS por diseño).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "implants"                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "implant_surgical_records"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "implant_healing_phases"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "implant_second_stage_surgeries"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "implant_prosthetic_phases"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "implant_complications"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "implant_follow_ups"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "implant_consents"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "implant_passports"                 ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  implant_table TEXT;
BEGIN
  FOR implant_table IN
    SELECT unnest(ARRAY[
      'implants',
      'implant_surgical_records',
      'implant_healing_phases',
      'implant_second_stage_surgeries',
      'implant_prosthetic_phases',
      'implant_complications',
      'implant_follow_ups',
      'implant_consents',
      'implant_passports'
    ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = implant_table
        AND policyname = implant_table || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        implant_table || '_deny_anon',
        implant_table
      );
    END IF;
  END LOOP;
END $$;
