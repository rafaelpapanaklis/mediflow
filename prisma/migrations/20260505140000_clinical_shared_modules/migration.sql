-- ═══════════════════════════════════════════════════════════════════
-- Clinical-shared cross-cutting — Sprint cierre dental
--
-- CONTEXTO
-- 8 modelos compartidos por los 5 módulos dentales (pediatrics,
-- endodontics, periodontics, implants, orthodontics):
--
--   1. clinical_photos               — galería unificada por paciente/módulo
--   2. clinical_evolution_templates  — plantillas SOAP por módulo
--   3. doctor_contacts               — directorio de doctores externos
--   4. referral_letters              — hojas de referencia
--   5. lab_partners                  — laboratorios externos
--   6. lab_orders                    — órdenes de laboratorio
--   7. treatment_links               — link sesión módulo ↔ TreatmentSession
--   8. patient_share_links           — tokens públicos (/share/p/[token])
--   9. clinical_reminders            — recordatorios programados por módulo
--
-- IDEMPOTENTE: usa IF NOT EXISTS y DO $$ guards. Se puede re-correr
-- múltiples veces sin efectos colaterales. Listo para Supabase SQL Editor.
--
-- ORDEN
--   1. Enums (8)
--   2. Tablas (9)
--   3. Foreign keys + índices
--   4. RLS deny-all en las 9 tablas nuevas
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Enums ───────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "ClinicalModule" AS ENUM (
    'pediatrics', 'endodontics', 'periodontics', 'implants', 'orthodontics'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ClinicalPhotoStage" AS ENUM ('pre', 'during', 'post', 'control');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ClinicalPhotoType" AS ENUM (
    'oral_general', 'eruption_check', 'sealant_pre', 'sealant_post',
    'fluoride_app', 'behavior_documentation',
    'endo_access', 'endo_working_length', 'endo_obturation',
    'perio_initial', 'perio_postsrp', 'perio_surgery',
    'implant_site_pre', 'implant_placement', 'implant_healing', 'implant_prosthetic',
    'ortho_extraoral_front', 'ortho_extraoral_profile', 'ortho_intraoral', 'ortho_progress',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ReferralLetterStatus" AS ENUM ('draft', 'sent', 'acknowledged', 'completed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ReferralLetterChannel" AS ENUM ('whatsapp', 'email', 'print');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "LabOrderStatus" AS ENUM ('draft', 'sent', 'in_progress', 'received', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "LabOrderType" AS ENUM (
    'post_core', 'surgical_guide', 'custom_abutment', 'crown',
    'ortho_appliance', 'retainer', 'ped_space_maintainer_lab', 'other'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ClinicalReminderType" AS ENUM (
    'ped_profilaxis_6m', 'ped_control_erupcion_anual', 'ped_cumpleanos_paciente',
    'endo_followup_3m', 'endo_followup_6m', 'endo_followup_1y',
    'perio_maintenance_3m', 'perio_reevaluation',
    'implant_followup_1m', 'implant_followup_6m', 'implant_followup_1y',
    'ortho_control_30d', 'ortho_retention_check',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ClinicalReminderStatus" AS ENUM ('pending', 'sent', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── 2. Tabla "clinical_photos" ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "clinical_photos" (
  "id"            TEXT                  PRIMARY KEY,
  "clinicId"      TEXT                  NOT NULL,
  "patientId"     TEXT                  NOT NULL,
  "module"        "ClinicalModule"      NOT NULL,
  "toothFdi"      INTEGER,
  "photoType"     "ClinicalPhotoType"   NOT NULL,
  "stage"         "ClinicalPhotoStage"  NOT NULL,
  "capturedAt"    TIMESTAMP(3)          NOT NULL DEFAULT NOW(),
  "capturedBy"    TEXT                  NOT NULL,
  "blobUrl"       TEXT                  NOT NULL,
  "thumbnailUrl"  TEXT,
  "notes"         TEXT,
  "annotations"   JSONB,
  "createdAt"     TIMESTAMP(3)          NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMP(3)          NOT NULL DEFAULT NOW(),
  "deletedAt"     TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "clinical_photos_clinicId_patientId_module_idx"
  ON "clinical_photos" ("clinicId", "patientId", "module");
CREATE INDEX IF NOT EXISTS "clinical_photos_clinicId_patientId_photoType_idx"
  ON "clinical_photos" ("clinicId", "patientId", "photoType");
CREATE INDEX IF NOT EXISTS "clinical_photos_patientId_capturedAt_idx"
  ON "clinical_photos" ("patientId", "capturedAt" DESC);
CREATE INDEX IF NOT EXISTS "clinical_photos_clinicId_deletedAt_idx"
  ON "clinical_photos" ("clinicId", "deletedAt");


-- ── 3. Tabla "clinical_evolution_templates" ────────────────────────

CREATE TABLE IF NOT EXISTS "clinical_evolution_templates" (
  "id"                  TEXT             PRIMARY KEY,
  "clinicId"            TEXT             NOT NULL,
  "module"              "ClinicalModule" NOT NULL,
  "name"                TEXT             NOT NULL,
  "soapTemplate"        JSONB            NOT NULL,
  "proceduresPrefilled" TEXT[]           NOT NULL DEFAULT ARRAY[]::TEXT[],
  "materialsPrefilled"  TEXT[]           NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isDefault"           BOOLEAN          NOT NULL DEFAULT FALSE,
  "createdBy"           TEXT             NOT NULL,
  "createdAt"           TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "deletedAt"           TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "clinical_evolution_templates_clinicId_module_name_key"
  ON "clinical_evolution_templates" ("clinicId", "module", "name");
CREATE INDEX IF NOT EXISTS "clinical_evolution_templates_clinicId_module_isDefault_idx"
  ON "clinical_evolution_templates" ("clinicId", "module", "isDefault");


-- ── 4. Tabla "doctor_contacts" ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "doctor_contacts" (
  "id"          TEXT          PRIMARY KEY,
  "clinicId"    TEXT          NOT NULL,
  "fullName"    TEXT          NOT NULL,
  "specialty"   TEXT,
  "cedula"      TEXT,
  "phone"       TEXT,
  "email"       TEXT,
  "clinicName"  TEXT,
  "address"     TEXT,
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "deletedAt"   TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "doctor_contacts_clinicId_fullName_idx"
  ON "doctor_contacts" ("clinicId", "fullName");


-- ── 5. Tabla "referral_letters" ────────────────────────────────────

CREATE TABLE IF NOT EXISTS "referral_letters" (
  "id"              TEXT                       PRIMARY KEY,
  "clinicId"        TEXT                       NOT NULL,
  "patientId"       TEXT                       NOT NULL,
  "module"          "ClinicalModule"           NOT NULL,
  "contactId"       TEXT,
  "authorId"        TEXT                       NOT NULL,
  "reason"          TEXT                       NOT NULL,
  "summary"         TEXT                       NOT NULL,
  "pdfUrl"          TEXT,
  "status"          "ReferralLetterStatus"     NOT NULL DEFAULT 'draft',
  "sentAt"          TIMESTAMP(3),
  "sentChannel"     "ReferralLetterChannel",
  "acknowledgedAt"  TIMESTAMP(3),
  "completedAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3)               NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP(3)               NOT NULL DEFAULT NOW(),
  "deletedAt"       TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "referral_letters_clinicId_patientId_module_idx"
  ON "referral_letters" ("clinicId", "patientId", "module");
CREATE INDEX IF NOT EXISTS "referral_letters_clinicId_status_idx"
  ON "referral_letters" ("clinicId", "status");


-- ── 6. Tabla "lab_partners" ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "lab_partners" (
  "id"          TEXT          PRIMARY KEY,
  "clinicId"    TEXT          NOT NULL,
  "name"        TEXT          NOT NULL,
  "contactName" TEXT,
  "phone"       TEXT,
  "email"       TEXT,
  "address"     TEXT,
  "notes"       TEXT,
  "isActive"    BOOLEAN       NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "deletedAt"   TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "lab_partners_clinicId_isActive_idx"
  ON "lab_partners" ("clinicId", "isActive");


-- ── 7. Tabla "lab_orders" ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "lab_orders" (
  "id"          TEXT             PRIMARY KEY,
  "clinicId"    TEXT             NOT NULL,
  "patientId"   TEXT             NOT NULL,
  "module"      "ClinicalModule" NOT NULL,
  "partnerId"   TEXT,
  "authorId"    TEXT             NOT NULL,
  "orderType"   "LabOrderType"   NOT NULL,
  "spec"        JSONB            NOT NULL,
  "toothFdi"    INTEGER,
  "shadeGuide"  TEXT,
  "dueDate"     TIMESTAMP(3),
  "pdfUrl"      TEXT,
  "status"      "LabOrderStatus" NOT NULL DEFAULT 'draft',
  "sentAt"      TIMESTAMP(3),
  "receivedAt"  TIMESTAMP(3),
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "deletedAt"   TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "lab_orders_clinicId_patientId_module_idx"
  ON "lab_orders" ("clinicId", "patientId", "module");
CREATE INDEX IF NOT EXISTS "lab_orders_clinicId_status_idx"
  ON "lab_orders" ("clinicId", "status");


-- ── 8. Tabla "treatment_links" ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "treatment_links" (
  "id"                  TEXT             PRIMARY KEY,
  "clinicId"            TEXT             NOT NULL,
  "module"              "ClinicalModule" NOT NULL,
  "moduleEntityType"    TEXT             NOT NULL,
  "moduleSessionId"     TEXT             NOT NULL,
  "treatmentSessionId"  TEXT             NOT NULL,
  "linkedBy"            TEXT             NOT NULL,
  "notes"               TEXT,
  "createdAt"           TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
  "deletedAt"           TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "treatment_links_modEntity_modSession_treatSession_key"
  ON "treatment_links" ("moduleEntityType", "moduleSessionId", "treatmentSessionId");
CREATE INDEX IF NOT EXISTS "treatment_links_clinicId_treatmentSessionId_idx"
  ON "treatment_links" ("clinicId", "treatmentSessionId");
CREATE INDEX IF NOT EXISTS "treatment_links_clinicId_module_idx"
  ON "treatment_links" ("clinicId", "module");


-- ── 9. Tabla "patient_share_links" ─────────────────────────────────

CREATE TABLE IF NOT EXISTS "patient_share_links" (
  "id"          TEXT             PRIMARY KEY,
  "clinicId"    TEXT             NOT NULL,
  "patientId"   TEXT             NOT NULL,
  "module"      "ClinicalModule" NOT NULL,
  "token"       TEXT             NOT NULL,
  "expiresAt"   TIMESTAMP(3)     NOT NULL,
  "createdBy"   TEXT             NOT NULL,
  "viewCount"   INTEGER          NOT NULL DEFAULT 0,
  "lastViewed"  TIMESTAMP(3),
  "revokedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "patient_share_links_token_key"
  ON "patient_share_links" ("token");
CREATE INDEX IF NOT EXISTS "patient_share_links_clinicId_patientId_module_idx"
  ON "patient_share_links" ("clinicId", "patientId", "module");
CREATE INDEX IF NOT EXISTS "patient_share_links_expiresAt_idx"
  ON "patient_share_links" ("expiresAt");


-- ── 10. Tabla "clinical_reminders" ─────────────────────────────────

CREATE TABLE IF NOT EXISTS "clinical_reminders" (
  "id"                  TEXT                     PRIMARY KEY,
  "clinicId"            TEXT                     NOT NULL,
  "patientId"           TEXT                     NOT NULL,
  "module"              "ClinicalModule"         NOT NULL,
  "reminderType"        "ClinicalReminderType"   NOT NULL,
  "dueDate"             TIMESTAMP(3)             NOT NULL,
  "status"              "ClinicalReminderStatus" NOT NULL DEFAULT 'pending',
  "message"             TEXT,
  "payload"             JSONB,
  "whatsappReminderId"  TEXT,
  "triggeredAt"         TIMESTAMP(3),
  "completedAt"         TIMESTAMP(3),
  "createdBy"           TEXT                     NOT NULL,
  "createdAt"           TIMESTAMP(3)             NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP(3)             NOT NULL DEFAULT NOW(),
  "deletedAt"           TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "clinical_reminders_clinicId_patientId_module_idx"
  ON "clinical_reminders" ("clinicId", "patientId", "module");
CREATE INDEX IF NOT EXISTS "clinical_reminders_status_dueDate_idx"
  ON "clinical_reminders" ("status", "dueDate");
CREATE INDEX IF NOT EXISTS "clinical_reminders_reminderType_status_idx"
  ON "clinical_reminders" ("reminderType", "status");


-- ── 11. Foreign keys ───────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "clinical_photos"
    ADD CONSTRAINT "clinical_photos_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "clinical_photos"
    ADD CONSTRAINT "clinical_photos_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "clinical_photos"
    ADD CONSTRAINT "clinical_photos_capturedBy_fkey"
    FOREIGN KEY ("capturedBy") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "clinical_evolution_templates"
    ADD CONSTRAINT "clinical_evolution_templates_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "clinical_evolution_templates"
    ADD CONSTRAINT "clinical_evolution_templates_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "doctor_contacts"
    ADD CONSTRAINT "doctor_contacts_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "referral_letters"
    ADD CONSTRAINT "referral_letters_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "referral_letters"
    ADD CONSTRAINT "referral_letters_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "referral_letters"
    ADD CONSTRAINT "referral_letters_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "referral_letters"
    ADD CONSTRAINT "referral_letters_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "doctor_contacts"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "lab_partners"
    ADD CONSTRAINT "lab_partners_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "lab_orders"
    ADD CONSTRAINT "lab_orders_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "lab_orders"
    ADD CONSTRAINT "lab_orders_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "lab_orders"
    ADD CONSTRAINT "lab_orders_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "lab_orders"
    ADD CONSTRAINT "lab_orders_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "lab_partners"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "treatment_links"
    ADD CONSTRAINT "treatment_links_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "treatment_links"
    ADD CONSTRAINT "treatment_links_treatmentSessionId_fkey"
    FOREIGN KEY ("treatmentSessionId") REFERENCES "treatment_sessions"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "treatment_links"
    ADD CONSTRAINT "treatment_links_linkedBy_fkey"
    FOREIGN KEY ("linkedBy") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "patient_share_links"
    ADD CONSTRAINT "patient_share_links_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "patient_share_links"
    ADD CONSTRAINT "patient_share_links_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "patient_share_links"
    ADD CONSTRAINT "patient_share_links_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "clinical_reminders"
    ADD CONSTRAINT "clinical_reminders_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "clinical_reminders"
    ADD CONSTRAINT "clinical_reminders_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "clinical_reminders"
    ADD CONSTRAINT "clinical_reminders_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ═══════════════════════════════════════════════════════════════════
-- 12. RLS deny-all en las 9 tablas nuevas
--
-- Mismo patrón que sql/rls-deny-all-policies.sql: RESTRICTIVE policy
-- que bloquea todo acceso desde anon/authenticated. MediFlow accede a
-- estas tablas vía Prisma + service role (bypassa RLS por diseño).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "clinical_photos"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinical_evolution_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctor_contacts"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referral_letters"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_partners"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_orders"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "treatment_links"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_share_links"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinical_reminders"           ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  cs_table TEXT;
BEGIN
  FOR cs_table IN
    SELECT unnest(ARRAY[
      'clinical_photos',
      'clinical_evolution_templates',
      'doctor_contacts',
      'referral_letters',
      'lab_partners',
      'lab_orders',
      'treatment_links',
      'patient_share_links',
      'clinical_reminders'
    ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = cs_table
        AND policyname = cs_table || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        cs_table || '_deny_anon',
        cs_table
      );
    END IF;
  END LOOP;
END $$;
