-- ═══════════════════════════════════════════════════════════════════
-- Analytics & Insights — Push 1
--
-- Agrega 6 tablas para reportes operativos + 2 valores nuevos al enum
-- AppointmentStatus para capturar transiciones intermedias (IN_CHAIR
-- antes de IN_PROGRESS, CHECKED_OUT después de COMPLETED).
-- ═══════════════════════════════════════════════════════════════════

-- ── Nuevos valores enum AppointmentStatus ────────────────────────────
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'IN_CHAIR';
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'CHECKED_OUT';

-- ── appointment_timelines: timestamps por transición ─────────────────
CREATE TABLE IF NOT EXISTS "appointment_timelines" (
  "id"              TEXT          PRIMARY KEY,
  "appointmentId"   TEXT          NOT NULL UNIQUE,
  "arrivedAt"       TIMESTAMPTZ(6),
  "inChairAt"       TIMESTAMPTZ(6),
  "consultStartAt"  TIMESTAMPTZ(6),
  "consultEndAt"    TIMESTAMPTZ(6),
  "checkoutAt"      TIMESTAMPTZ(6),
  "totalWaitMin"    INTEGER,
  "totalConsultMin" INTEGER,
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "appointment_timelines_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "appointment_timelines_appointmentId_idx"
  ON "appointment_timelines"("appointmentId");

-- ── resource_costs: renta + ops mensuales por sillón ─────────────────
CREATE TABLE IF NOT EXISTS "resource_costs" (
  "id"          TEXT           PRIMARY KEY,
  "resourceId"  TEXT           NOT NULL UNIQUE,
  "monthlyRent" DECIMAL(10,2)  NOT NULL DEFAULT 0,
  "monthlyOps"  DECIMAL(10,2)  NOT NULL DEFAULT 0,
  "notes"       VARCHAR(500),
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "resource_costs_resourceId_fkey"
    FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE
);

-- ── no_show_predictions: predicción IA por cita ──────────────────────
CREATE TABLE IF NOT EXISTS "no_show_predictions" (
  "id"            TEXT           PRIMARY KEY,
  "appointmentId" TEXT           NOT NULL UNIQUE,
  "probability"   DOUBLE PRECISION NOT NULL,
  "factors"       JSONB          NOT NULL,
  "predictedAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "no_show_predictions_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "no_show_predictions_predictedAt_idx"
  ON "no_show_predictions"("predictedAt");

-- ── weekly_insights: resumen semanal IA ──────────────────────────────
CREATE TABLE IF NOT EXISTS "weekly_insights" (
  "id"        TEXT           PRIMARY KEY,
  "clinicId"  TEXT           NOT NULL,
  "weekStart" TIMESTAMPTZ(6) NOT NULL,
  "weekEnd"   TIMESTAMPTZ(6) NOT NULL,
  "summary"   VARCHAR(500)   NOT NULL,
  "insights"  JSONB          NOT NULL,
  "read"      BOOLEAN        NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "weekly_insights_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "weekly_insights_clinicId_weekStart_idx"
  ON "weekly_insights"("clinicId", "weekStart");

-- ── patient_satisfactions: NPS 1-5 post-cita ─────────────────────────
CREATE TABLE IF NOT EXISTS "patient_satisfactions" (
  "id"            TEXT           PRIMARY KEY,
  "appointmentId" TEXT           NOT NULL UNIQUE,
  "score"         INTEGER        NOT NULL,
  "comment"       VARCHAR(1000),
  "submittedAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "patient_satisfactions_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE,
  CONSTRAINT "patient_satisfactions_score_check"
    CHECK ("score" >= 1 AND "score" <= 5)
);
CREATE INDEX IF NOT EXISTS "patient_satisfactions_submittedAt_idx"
  ON "patient_satisfactions"("submittedAt");

-- ── tv_displays: pantallas TV configurables ──────────────────────────
CREATE TABLE IF NOT EXISTS "tv_displays" (
  "id"         TEXT           PRIMARY KEY,
  "clinicId"   TEXT           NOT NULL,
  "name"       VARCHAR(120)   NOT NULL,
  "mode"       VARCHAR(20)    NOT NULL,
  "config"     JSONB          NOT NULL,
  "publicSlug" VARCHAR(80)    NOT NULL UNIQUE,
  "active"     BOOLEAN        NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updatedAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "tv_displays_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "tv_displays_clinicId_active_idx"
  ON "tv_displays"("clinicId", "active");
