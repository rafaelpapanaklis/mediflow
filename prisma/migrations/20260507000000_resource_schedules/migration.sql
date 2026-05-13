-- ═══════════════════════════════════════════════════════════════════════
-- Resource Schedules — horario semanal por sillón / sala / equipo.
--
-- Una row = una ventana (start–end) en un día concreto. Multi-ventana
-- permitida (mañana/tarde = dos rows con mismo resourceId + dayOfWeek).
-- Resource sin rows = "siempre abierto" (backward-compat).
--
-- IDEMPOTENTE: usa IF NOT EXISTS en CREATE TABLE / CREATE INDEX y
-- DO $$ ... $$ guards para ADD CONSTRAINT (Postgres no soporta
-- IF NOT EXISTS en ADD CONSTRAINT).
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "resource_schedules" (
  "id"         TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "dayOfWeek"  INTEGER NOT NULL,
  "startTime"  VARCHAR(5) NOT NULL,
  "endTime"    VARCHAR(5) NOT NULL,
  "createdAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "resource_schedules_pkey" PRIMARY KEY ("id")
);

-- FK Resource(id) con cascade — al borrar un Resource sus horarios desaparecen.
DO $$ BEGIN
  ALTER TABLE "resource_schedules"
    ADD CONSTRAINT "resource_schedules_resourceId_fkey"
    FOREIGN KEY ("resourceId") REFERENCES "Resource"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sanidad de datos a nivel DB (la app también valida con Zod).
DO $$ BEGIN
  ALTER TABLE "resource_schedules"
    ADD CONSTRAINT "resource_schedules_dayOfWeek_range"
    CHECK ("dayOfWeek" >= 0 AND "dayOfWeek" <= 6);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "resource_schedules"
    ADD CONSTRAINT "resource_schedules_time_format"
    CHECK (
      "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND "startTime" < "endTime"
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "resource_schedules_resourceId_dayOfWeek_idx"
  ON "resource_schedules" ("resourceId", "dayOfWeek");
