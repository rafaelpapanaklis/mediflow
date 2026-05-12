-- ────────────────────────────────────────────────────────────────────────────
-- Ortodoncia v2 rewrite — feat/ortho-v2-rewrite (Fase 2 SPEC.md)
--
-- Migration en 3 secciones:
--   1. DROP de 24 tablas + 38 enums del módulo ortho v1
--   2. CREATE de 15 enums + 17 tablas + 25 índices + 22 FK constraints v2
--   3. Inicialización (ninguna, las tablas quedan vacías post-orphan-delete)
--
-- Renames vs SPEC.md:
--   - SPEC.TreatmentPlan → OrthoTreatmentPlan (legacy TreatmentPlan línea 895
--     del schema preservado, cross-módulo perio/implants/clinical-shared)
--   - SPEC.LabOrder → OrthoLabOrder (LabOrder cross-módulo intacto)
--   - SPEC.LabOrderStatus → OrthoLabOrderStatus
--
-- Verificaciones pre-migración:
--   - Data: solo Gabriela tiene rows en tablas v1 (Sergio+Andrés orphans
--     borrados via scripts/delete-ortho-orphan-diagnoses.mts)
--   - Audit enums: ControlAttendance/AdjustmentType/OrthoPaymentMethod
--     son solo-orto (registrado en docs/ortho-redesign-v2/_decisions.md)
--   - npx prisma validate → schema estructuralmente válido
-- ────────────────────────────────────────────────────────────────────────────

-- ════════════════════════════════════════════════════════════════════════════
-- 1. DROP TABLAS y ENUMS DEL MÓDULO ORTHO v1
-- ════════════════════════════════════════════════════════════════════════════

-- Drop tables (orden: hijas → padres, CASCADE para FK auto-cleanup)
DROP TABLE IF EXISTS "ortho_referral_codes" CASCADE;
DROP TABLE IF EXISTS "ortho_nps_schedules" CASCADE;
DROP TABLE IF EXISTS "ortho_retainer_checkups" CASCADE;
DROP TABLE IF EXISTS "ortho_retention_regimens" CASCADE;
DROP TABLE IF EXISTS "ortho_sign_at_home_packages" CASCADE;
DROP TABLE IF EXISTS "ortho_quote_scenarios" CASCADE;
DROP TABLE IF EXISTS "ortho_phase_transitions" CASCADE;
DROP TABLE IF EXISTS "ortho_aux_mechanics" CASCADE;
DROP TABLE IF EXISTS "ortho_tads" CASCADE;
DROP TABLE IF EXISTS "ortho_card_broken_brackets" CASCADE;
DROP TABLE IF EXISTS "ortho_card_ipr_points" CASCADE;
DROP TABLE IF EXISTS "ortho_card_elastics" CASCADE;
DROP TABLE IF EXISTS "ortho_treatment_cards" CASCADE;
DROP TABLE IF EXISTS "ortho_wire_steps" CASCADE;
DROP TABLE IF EXISTS "orthodontic_consents" CASCADE;
DROP TABLE IF EXISTS "orthodontic_digital_records" CASCADE;
DROP TABLE IF EXISTS "orthodontic_control_appointments" CASCADE;
DROP TABLE IF EXISTS "ortho_photo_sets" CASCADE;
DROP TABLE IF EXISTS "ortho_installments" CASCADE;
DROP TABLE IF EXISTS "ortho_payment_plans" CASCADE;
DROP TABLE IF EXISTS "orthodontic_phases" CASCADE;
DROP TABLE IF EXISTS "orthodontic_treatment_plans" CASCADE;
DROP TABLE IF EXISTS "orthodontic_diagnoses" CASCADE;

-- Drop enums (audit cross-módulo confirmó: solo-orto)
DROP TYPE IF EXISTS "AngleClass" CASCADE;
DROP TYPE IF EXISTS "OrthoTechnique" CASCADE;
DROP TYPE IF EXISTS "AnchorageType" CASCADE;
DROP TYPE IF EXISTS "OrthoPhaseKey" CASCADE;
DROP TYPE IF EXISTS "OrthoPhaseStatus" CASCADE;
DROP TYPE IF EXISTS "OrthoTreatmentStatus" CASCADE;
DROP TYPE IF EXISTS "OrthoPaymentStatus" CASCADE;
DROP TYPE IF EXISTS "InstallmentStatus" CASCADE;
DROP TYPE IF EXISTS "OrthoPhotoSetType" CASCADE;
DROP TYPE IF EXISTS "OrthoPhotoView" CASCADE;
DROP TYPE IF EXISTS "HabitType" CASCADE;
DROP TYPE IF EXISTS "DentalPhase" CASCADE;
DROP TYPE IF EXISTS "TreatmentObjective" CASCADE;
DROP TYPE IF EXISTS "OrthoConsentType" CASCADE;
DROP TYPE IF EXISTS "ControlAttendance" CASCADE;
DROP TYPE IF EXISTS "AdjustmentType" CASCADE;
DROP TYPE IF EXISTS "OrthoPaymentMethod" CASCADE;
DROP TYPE IF EXISTS "DigitalRecordType" CASCADE;
DROP TYPE IF EXISTS "OrthoApplianceSlot" CASCADE;
DROP TYPE IF EXISTS "OrthoBondingType" CASCADE;
DROP TYPE IF EXISTS "OrthoSkeletalPattern" CASCADE;
DROP TYPE IF EXISTS "OrthoWireMaterial" CASCADE;
DROP TYPE IF EXISTS "OrthoWireShape" CASCADE;
DROP TYPE IF EXISTS "OrthoWireStepStatus" CASCADE;
DROP TYPE IF EXISTS "OrthoElasticClass" CASCADE;
DROP TYPE IF EXISTS "OrthoElasticZone" CASCADE;
DROP TYPE IF EXISTS "OrthoTadBrand" CASCADE;
DROP TYPE IF EXISTS "OrthoExpanderType" CASCADE;
DROP TYPE IF EXISTS "OrthoDistalizerType" CASCADE;
DROP TYPE IF EXISTS "OrthoGingivitisLevel" CASCADE;
DROP TYPE IF EXISTS "OrthoCardStatus" CASCADE;
DROP TYPE IF EXISTS "OrthoQuoteScenarioStatus" CASCADE;
DROP TYPE IF EXISTS "OrthoQuoteScenarioPaymentMode" CASCADE;
DROP TYPE IF EXISTS "OrthoSignAtHomeStatus" CASCADE;
DROP TYPE IF EXISTS "OrthoRetainerType" CASCADE;
DROP TYPE IF EXISTS "OrthoRetainerArchwireGauge" CASCADE;
DROP TYPE IF EXISTS "OrthoRetainerCheckupStatus" CASCADE;
DROP TYPE IF EXISTS "OrthoNpsType" CASCADE;
DROP TYPE IF EXISTS "OrthoNpsStatus" CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. CREATE ENUMS v2 (15 enums per SPEC.md §1.1)
-- ════════════════════════════════════════════════════════════════════════════


-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'EVAL', 'ACCEPTED', 'ACTIVE', 'PAUSED', 'DEBONDING', 'RETENTION', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PhaseEnum" AS ENUM ('ALIGNMENT', 'LEVELING', 'SPACE_CLOSE', 'DETAIL', 'FINISHING', 'RETENTION');

-- CreateEnum
CREATE TYPE "AngleClass" AS ENUM ('I', 'II_DIV1', 'II_DIV2', 'III', 'COMBO');

-- CreateEnum
CREATE TYPE "OpenBite" AS ENUM ('NONE', 'ANTERIOR', 'POSTERIOR', 'BOTH');

-- CreateEnum
CREATE TYPE "CrossBite" AS ENUM ('NONE', 'ANTERIOR', 'LATERAL_R', 'LATERAL_L', 'POSTERIOR_R', 'POSTERIOR_L', 'BILATERAL');

-- CreateEnum
CREATE TYPE "FacialProfile" AS ENUM ('CONCAVE', 'STRAIGHT', 'CONVEX');

-- CreateEnum
CREATE TYPE "SkeletalPattern" AS ENUM ('BRACHY', 'MESO', 'DOLICHO');

-- CreateEnum
CREATE TYPE "ArchMaterial" AS ENUM ('NITI', 'SS', 'TMA', 'BETA_TI', 'ESTHETIC', 'OTHER');

-- CreateEnum
CREATE TYPE "ArchStatus" AS ENUM ('FUTURE', 'CURRENT', 'PAST', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PhotoKind" AS ENUM ('EXTRA_FRONTAL_REST', 'EXTRA_FRONTAL_SMILE', 'EXTRA_LAT34', 'EXTRA_PROFILE_R', 'EXTRA_PROFILE_L', 'INTRA_FRONT', 'INTRA_LAT_R', 'INTRA_LAT_L', 'INTRA_OCCL_UP', 'INTRA_OCCL_LO', 'INTRA_OVERJET', 'RX_PANO', 'RX_CEPH', 'RX_PA', 'RX_CBCT', 'STL_UP', 'STL_LO', 'STL_BITE', 'PDF', 'OTHER');

-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('INSTALLATION', 'CONTROL', 'EMERGENCY', 'DEBONDING', 'RETAINER_FIT', 'FOLLOWUP');

-- CreateEnum
CREATE TYPE "InstStatus" AS ENUM ('FUTURE', 'PENDING', 'PAID', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "RetainerKind" AS ENUM ('NONE', 'HAWLEY', 'ESSIX', 'FIXED_3_3', 'FIXED_EXTENDED', 'CLEAR_NIGHT');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('CONSENT', 'REFERRAL_LETTER', 'LAB_ORDER', 'OTHER');

-- CreateEnum
CREATE TYPE "OrthoLabOrderStatus" AS ENUM ('DRAFT', 'SENT', 'RECEIVED', 'CANCELLED');


-- ════════════════════════════════════════════════════════════════════════════
-- 3. CREATE TABLES v2 (17 tablas per SPEC.md §1.1)
-- ════════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "ortho_cases" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "caseCode" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'DRAFT',
    "currentPhase" "PhaseEnum",
    "primaryDoctorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "estimatedEnd" TIMESTAMP(3),
    "debondedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ortho_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_diagnoses" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "angleClass" "AngleClass" NOT NULL,
    "subCaninoR" "AngleClass",
    "subCaninoL" "AngleClass",
    "subMolarR" "AngleClass",
    "subMolarL" "AngleClass",
    "overjetMm" DOUBLE PRECISION,
    "overbiteMm" DOUBLE PRECISION,
    "openBite" "OpenBite" NOT NULL DEFAULT 'NONE',
    "crossBite" "CrossBite" NOT NULL DEFAULT 'NONE',
    "crowdingMaxMm" DOUBLE PRECISION,
    "crowdingMandMm" DOUBLE PRECISION,
    "diastemas" JSONB NOT NULL,
    "midlineDeviation" DOUBLE PRECISION,
    "facialProfile" "FacialProfile" NOT NULL,
    "skeletalPattern" "SkeletalPattern" NOT NULL,
    "skeletalIssues" TEXT[],
    "tmjFindings" JSONB NOT NULL,
    "habits" TEXT[],
    "narrative" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "ortho_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_treatment_plans" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "appliances" TEXT[],
    "extractions" INTEGER[],
    "elastics" JSONB NOT NULL,
    "expanders" JSONB NOT NULL,
    "tads" JSONB NOT NULL,
    "objectives" TEXT[],
    "notes" TEXT NOT NULL,
    "templateId" TEXT,
    "iprPlan" JSONB NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,
    "signedDocUrl" TEXT,

    CONSTRAINT "ortho_treatment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_arches_planned" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "phase" "PhaseEnum" NOT NULL,
    "material" "ArchMaterial" NOT NULL,
    "gauge" TEXT NOT NULL,
    "durationW" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" "ArchStatus" NOT NULL DEFAULT 'FUTURE',
    "notes" TEXT,

    CONSTRAINT "ortho_arches_planned_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_photo_sets" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "stageCode" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "ortho_photo_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_photos" (
    "id" TEXT NOT NULL,
    "photoSetId" TEXT NOT NULL,
    "kind" "PhotoKind" NOT NULL,
    "url" TEXT NOT NULL,
    "thumbUrl" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "annotations" JSONB NOT NULL,
    "measurements" JSONB NOT NULL,
    "teethRef" INTEGER[],
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "exifJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ortho_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_treatment_cards" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "visitDate" TIMESTAMP(3) NOT NULL,
    "visitType" "VisitType" NOT NULL,
    "templateUsed" TEXT,
    "archPlacedId" TEXT,
    "archPlacedJson" JSONB,
    "ligColor" TEXT,
    "ligKind" TEXT,
    "activations" TEXT[],
    "elasticUse" JSONB NOT NULL,
    "bracketsLost" INTEGER[],
    "iprDoneDelta" JSONB NOT NULL,
    "soap" JSONB NOT NULL,
    "homeInstr" TEXT NOT NULL,
    "nextSuggestedAt" TIMESTAMP(3),
    "linkedPhotoSet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "signedOffAt" TIMESTAMP(3),

    CONSTRAINT "ortho_treatment_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_financial_plans" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "downPayment" DECIMAL(10,2) NOT NULL,
    "months" INTEGER NOT NULL,
    "monthly" DECIMAL(10,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "scenarios" JSONB NOT NULL,
    "activeScenarioId" TEXT,
    "signAtHomeUrl" TEXT,
    "signedByPatient" BOOLEAN NOT NULL DEFAULT false,
    "signedAt" TIMESTAMP(3),

    CONSTRAINT "ortho_financial_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_installments" (
    "id" TEXT NOT NULL,
    "financialId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "invoiceId" TEXT,
    "status" "InstStatus" NOT NULL DEFAULT 'FUTURE',

    CONSTRAINT "ortho_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_retention_plans" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "retUpper" "RetainerKind" NOT NULL DEFAULT 'NONE',
    "retLower" "RetainerKind" NOT NULL DEFAULT 'NONE',
    "fixedGauge" TEXT,
    "regimen" TEXT NOT NULL,
    "checkpoints" TIMESTAMP(3)[],
    "checkpointsDone" JSONB NOT NULL,
    "beforeAfterPdf" TEXT,
    "referralCode" TEXT NOT NULL,
    "referralReward" JSONB NOT NULL,
    "referralsCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ortho_retention_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_documents" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "signedToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "ortho_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_lab_orders" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemLabel" TEXT NOT NULL,
    "labPartner" TEXT NOT NULL,
    "trackingCode" TEXT,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "status" "OrthoLabOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,

    CONSTRAINT "ortho_lab_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_communication_logs" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "templateId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "externalId" TEXT,

    CONSTRAINT "ortho_communication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_appliance_types" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,

    CONSTRAINT "ortho_appliance_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_templates" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerUserId" TEXT,
    "payload" JSONB NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ortho_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_note_templates" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "builtin" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ortho_note_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ortho_indication_templates" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "ortho_indication_templates_pkey" PRIMARY KEY ("id")
);


-- ════════════════════════════════════════════════════════════════════════════
-- 4. CREATE INDEXES (25 índices)
-- ════════════════════════════════════════════════════════════════════════════

-- CreateIndex
CREATE UNIQUE INDEX "ortho_cases_patientId_key" ON "ortho_cases"("patientId");
-- CreateIndex
CREATE INDEX "ortho_cases_clinicId_status_idx" ON "ortho_cases"("clinicId", "status");
-- CreateIndex
CREATE INDEX "ortho_cases_clinicId_primaryDoctorId_idx" ON "ortho_cases"("clinicId", "primaryDoctorId");
-- CreateIndex
CREATE UNIQUE INDEX "ortho_cases_clinicId_caseCode_key" ON "ortho_cases"("clinicId", "caseCode");
-- CreateIndex
CREATE UNIQUE INDEX "ortho_diagnoses_caseId_key" ON "ortho_diagnoses"("caseId");
-- CreateIndex
CREATE UNIQUE INDEX "ortho_treatment_plans_caseId_key" ON "ortho_treatment_plans"("caseId");
-- CreateIndex
CREATE INDEX "ortho_treatment_plans_templateId_idx" ON "ortho_treatment_plans"("templateId");
-- CreateIndex
CREATE UNIQUE INDEX "ortho_arches_planned_planId_order_key" ON "ortho_arches_planned"("planId", "order");
-- CreateIndex
CREATE INDEX "ortho_photo_sets_caseId_capturedAt_idx" ON "ortho_photo_sets"("caseId", "capturedAt");
-- CreateIndex
CREATE UNIQUE INDEX "ortho_photo_sets_caseId_stageCode_key" ON "ortho_photo_sets"("caseId", "stageCode");
-- CreateIndex
CREATE INDEX "ortho_photos_photoSetId_idx" ON "ortho_photos"("photoSetId");
-- CreateIndex
CREATE UNIQUE INDEX "ortho_treatment_cards_appointmentId_key" ON "ortho_treatment_cards"("appointmentId");
-- CreateIndex
CREATE INDEX "ortho_treatment_cards_caseId_visitDate_idx" ON "ortho_treatment_cards"("caseId", "visitDate");
-- CreateIndex
CREATE INDEX "ortho_treatment_cards_appointmentId_idx" ON "ortho_treatment_cards"("appointmentId");
-- CreateIndex
CREATE UNIQUE INDEX "ortho_financial_plans_caseId_key" ON "ortho_financial_plans"("caseId");
-- CreateIndex
CREATE INDEX "ortho_installments_dueDate_status_idx" ON "ortho_installments"("dueDate", "status");
-- CreateIndex
CREATE UNIQUE INDEX "ortho_installments_financialId_number_key" ON "ortho_installments"("financialId", "number");
-- CreateIndex
CREATE UNIQUE INDEX "ortho_retention_plans_caseId_key" ON "ortho_retention_plans"("caseId");
-- CreateIndex
CREATE UNIQUE INDEX "ortho_retention_plans_referralCode_key" ON "ortho_retention_plans"("referralCode");
-- CreateIndex
CREATE INDEX "ortho_lab_orders_caseId_status_idx" ON "ortho_lab_orders"("caseId", "status");
-- CreateIndex
CREATE INDEX "ortho_communication_logs_caseId_sentAt_idx" ON "ortho_communication_logs"("caseId", "sentAt");
-- CreateIndex
CREATE UNIQUE INDEX "ortho_appliance_types_clinicId_code_key" ON "ortho_appliance_types"("clinicId", "code");
-- CreateIndex
CREATE UNIQUE INDEX "ortho_templates_clinicId_name_key" ON "ortho_templates"("clinicId", "name");
-- CreateIndex
CREATE UNIQUE INDEX "ortho_note_templates_clinicId_scope_name_key" ON "ortho_note_templates"("clinicId", "scope", "name");

-- ════════════════════════════════════════════════════════════════════════════
-- 5. ADD FOREIGN KEY CONSTRAINTS (22 FKs)
-- ════════════════════════════════════════════════════════════════════════════

-- AddForeignKey
ALTER TABLE "ortho_cases" ADD CONSTRAINT "ortho_cases_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_cases" ADD CONSTRAINT "ortho_cases_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_cases" ADD CONSTRAINT "ortho_cases_primaryDoctorId_fkey" FOREIGN KEY ("primaryDoctorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_diagnoses" ADD CONSTRAINT "ortho_diagnoses_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ortho_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_treatment_plans" ADD CONSTRAINT "ortho_treatment_plans_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ortho_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_treatment_plans" ADD CONSTRAINT "ortho_treatment_plans_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ortho_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_arches_planned" ADD CONSTRAINT "ortho_arches_planned_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ortho_treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_photo_sets" ADD CONSTRAINT "ortho_photo_sets_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ortho_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_photos" ADD CONSTRAINT "ortho_photos_photoSetId_fkey" FOREIGN KEY ("photoSetId") REFERENCES "ortho_photo_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_treatment_cards" ADD CONSTRAINT "ortho_treatment_cards_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ortho_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_treatment_cards" ADD CONSTRAINT "ortho_treatment_cards_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_financial_plans" ADD CONSTRAINT "ortho_financial_plans_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ortho_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_installments" ADD CONSTRAINT "ortho_installments_financialId_fkey" FOREIGN KEY ("financialId") REFERENCES "ortho_financial_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_installments" ADD CONSTRAINT "ortho_installments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_retention_plans" ADD CONSTRAINT "ortho_retention_plans_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ortho_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_documents" ADD CONSTRAINT "ortho_documents_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ortho_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_lab_orders" ADD CONSTRAINT "ortho_lab_orders_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ortho_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_communication_logs" ADD CONSTRAINT "ortho_communication_logs_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ortho_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_appliance_types" ADD CONSTRAINT "ortho_appliance_types_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_templates" ADD CONSTRAINT "ortho_templates_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_note_templates" ADD CONSTRAINT "ortho_note_templates_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ortho_indication_templates" ADD CONSTRAINT "ortho_indication_templates_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
