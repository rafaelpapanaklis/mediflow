-- Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026).
-- H12 seguimiento de alineadores, H14 cumplimiento de elásticos/horas de
-- uso, H15 monitoreo a distancia con fotos del paciente. Aditivo e
-- idempotente. SIN bloques DO. Pégalo tal cual en Supabase → SQL Editor.
--
-- NO lo aplica la terminal. El código tolera que estas tablas todavía no
-- existan (P2021/P2022): los paneles muestran "aún no configurado" en vez
-- de romper la ficha o el portal del paciente.

-- 1) Caso de alineadores: número actual/total, intervalo de cambio,
--    attachments, refinamientos.
CREATE TABLE IF NOT EXISTS "orthodontic_aligners" (
  "id" TEXT PRIMARY KEY,
  "treatmentPlanId" TEXT NOT NULL UNIQUE REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE,
  "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "systemName" TEXT,
  "totalTrays" INTEGER NOT NULL,
  "currentTray" INTEGER NOT NULL DEFAULT 1,
  "changeIntervalDays" INTEGER NOT NULL DEFAULT 14,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "attachmentsPlaced" INTEGER,
  "attachmentsLost" INTEGER NOT NULL DEFAULT 0,
  "refinementCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "orthodontic_aligners_clinicId_idx" ON "orthodontic_aligners" ("clinicId");
ALTER TABLE "orthodontic_aligners" DROP CONSTRAINT IF EXISTS "orthodontic_aligners_status_check";
ALTER TABLE "orthodontic_aligners" ADD CONSTRAINT "orthodontic_aligners_status_check"
  CHECK ("status" IN ('ACTIVE', 'PAUSED', 'FINISHED'));

-- 2) Bitácora de eventos del caso de alineadores (entregas, refinamientos,
--    cambios manuales, attachments).
CREATE TABLE IF NOT EXISTS "orthodontic_aligner_events" (
  "id" TEXT PRIMARY KEY,
  "alignerId" TEXT NOT NULL REFERENCES "orthodontic_aligners"("id") ON DELETE CASCADE,
  "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "eventType" TEXT NOT NULL,
  "trayNumber" INTEGER,
  "quantity" INTEGER,
  "notes" TEXT,
  "createdByUserId" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "orthodontic_aligner_events_alignerId_idx" ON "orthodontic_aligner_events" ("alignerId");
ALTER TABLE "orthodontic_aligner_events" DROP CONSTRAINT IF EXISTS "orthodontic_aligner_events_eventType_check";
ALTER TABLE "orthodontic_aligner_events" ADD CONSTRAINT "orthodontic_aligner_events_eventType_check"
  CHECK ("eventType" IN ('DELIVERY', 'REFINEMENT', 'TRAY_CHANGE', 'ATTACHMENT_PLACED', 'ATTACHMENT_LOST', 'PAUSE', 'RESUME'));

-- 3) Registro diario de cumplimiento de elásticos/alineador (H14). Un
--    registro por día — upsert desde el portal del paciente o captura
--    manual de recepción si el paciente no usa el portal.
CREATE TABLE IF NOT EXISTS "orthodontic_elastics_logs" (
  "id" TEXT PRIMARY KEY,
  "treatmentPlanId" TEXT NOT NULL REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE,
  "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "logDate" DATE NOT NULL,
  "wornHours" DOUBLE PRECISION,
  "usedElastics" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL DEFAULT 'PATIENT_PORTAL',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  UNIQUE ("treatmentPlanId", "logDate")
);
CREATE INDEX IF NOT EXISTS "orthodontic_elastics_logs_treatmentPlanId_idx" ON "orthodontic_elastics_logs" ("treatmentPlanId");
ALTER TABLE "orthodontic_elastics_logs" DROP CONSTRAINT IF EXISTS "orthodontic_elastics_logs_source_check";
ALTER TABLE "orthodontic_elastics_logs" ADD CONSTRAINT "orthodontic_elastics_logs_source_check"
  CHECK ("source" IN ('PATIENT_PORTAL', 'CLINIC_MANUAL'));

-- 4) Fotos de monitoreo remoto que el paciente sube desde el portal (H15).
--    Sin análisis de IA (fuera de alcance de esta ola): solo captura +
--    revisión humana. Guarda su propio storageKey (mismo patrón que
--    patient_uploads), no reusa patient_files (esa es de subida clínica).
CREATE TABLE IF NOT EXISTS "orthodontic_monitoring_photos" (
  "id" TEXT PRIMARY KEY,
  "treatmentPlanId" TEXT NOT NULL REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE,
  "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "angle" TEXT NOT NULL DEFAULT 'OTHER',
  "patientNote" TEXT,
  "doctorNote" TEXT,
  "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedByUserId" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "orthodontic_monitoring_photos_treatmentPlanId_idx" ON "orthodontic_monitoring_photos" ("treatmentPlanId");
CREATE INDEX IF NOT EXISTS "orthodontic_monitoring_photos_clinicId_reviewStatus_idx" ON "orthodontic_monitoring_photos" ("clinicId", "reviewStatus");
ALTER TABLE "orthodontic_monitoring_photos" DROP CONSTRAINT IF EXISTS "orthodontic_monitoring_photos_angle_check";
ALTER TABLE "orthodontic_monitoring_photos" ADD CONSTRAINT "orthodontic_monitoring_photos_angle_check"
  CHECK ("angle" IN ('FRONTAL', 'LATERAL', 'SMILE', 'INTRAORAL', 'OTHER'));
ALTER TABLE "orthodontic_monitoring_photos" DROP CONSTRAINT IF EXISTS "orthodontic_monitoring_photos_reviewStatus_check";
ALTER TABLE "orthodontic_monitoring_photos" ADD CONSTRAINT "orthodontic_monitoring_photos_reviewStatus_check"
  CHECK ("reviewStatus" IN ('PENDING', 'REVIEWED', 'FLAGGED'));
