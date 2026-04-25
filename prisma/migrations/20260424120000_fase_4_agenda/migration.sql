-- Fase 4 — Agenda pro
-- Migración del shape (date, startTime, endTime, durationMins) →
-- (startsAt, endsAt) en timestamptz, con btree_gist + EXCLUDE constraints.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Nuevos valores en el enum AppointmentStatus (Fase 4 #3A).
-- PENDING se mantiene deprecado por compat de datos legacy.
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'CHECKED_IN';

CREATE TYPE "AppointmentSource" AS ENUM ('STAFF', 'PATIENT_PORTAL', 'WEBSITE', 'WHATSAPP');
CREATE TYPE "ResourceKind"      AS ENUM ('CHAIR', 'ROOM', 'EQUIPMENT');
CREATE TYPE "WaitlistPriority"  AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- NOTA: la tabla Clinic se llama "clinics" (via @@map). Misma para "appointments", "users", "patients".
ALTER TABLE "clinics"
  ADD COLUMN IF NOT EXISTS "defaultSlotMinutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "agendaDayStart"     INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS "agendaDayEnd"       INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "timezone"           TEXT    NOT NULL DEFAULT 'America/Mexico_City';

CREATE TABLE "Resource" (
  "id"          TEXT            NOT NULL,
  "clinicId"    TEXT            NOT NULL,
  "name"        VARCHAR(120)    NOT NULL,
  "kind"        "ResourceKind"  NOT NULL DEFAULT 'CHAIR',
  "color"       VARCHAR(9),
  "isActive"    BOOLEAN         NOT NULL DEFAULT true,
  "orderIndex"  INTEGER         NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMPTZ(6)  NOT NULL,
  CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Resource"
  ADD CONSTRAINT "Resource_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Resource_clinicId_isActive_orderIndex_idx"
  ON "Resource"("clinicId", "isActive", "orderIndex");

CREATE TABLE "WaitlistEntry" (
  "id"                    TEXT                NOT NULL,
  "clinicId"              TEXT                NOT NULL,
  "patientId"             TEXT                NOT NULL,
  "createdByUserId"       TEXT                NOT NULL,
  "reason"                VARCHAR(200),
  "priority"              "WaitlistPriority"  NOT NULL DEFAULT 'NORMAL',
  "preferredDoctorId"     TEXT,
  "preferredWindow"       VARCHAR(80),
  "notes"                 VARCHAR(500),
  "resolvedAt"            TIMESTAMPTZ(6),
  "resolvedAppointmentId" TEXT,
  "createdAt"             TIMESTAMPTZ(6)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMPTZ(6)      NOT NULL,
  CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "WaitlistEntry"
  ADD CONSTRAINT "WaitlistEntry_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE;
ALTER TABLE "WaitlistEntry"
  ADD CONSTRAINT "WaitlistEntry_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE;
ALTER TABLE "WaitlistEntry"
  ADD CONSTRAINT "WaitlistEntry_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "WaitlistEntry"
  ADD CONSTRAINT "WaitlistEntry_preferredDoctorId_fkey"
  FOREIGN KEY ("preferredDoctorId") REFERENCES "users"("id") ON DELETE SET NULL;
CREATE INDEX "WaitlistEntry_clinicId_resolvedAt_idx"
  ON "WaitlistEntry"("clinicId", "resolvedAt");
CREATE INDEX "WaitlistEntry_patientId_idx"
  ON "WaitlistEntry"("patientId");

ALTER TABLE "appointments"
  ADD COLUMN "startsAt"           TIMESTAMPTZ(6),
  ADD COLUMN "endsAt"             TIMESTAMPTZ(6),
  ADD COLUMN "resourceId"         TEXT,
  ADD COLUMN "source"             "AppointmentSource" NOT NULL DEFAULT 'STAFF',
  ADD COLUMN "requiresValidation" BOOLEAN             NOT NULL DEFAULT false,
  ADD COLUMN "overrideReason"     VARCHAR(500),
  ADD COLUMN "overriddenBy"       TEXT,
  ADD COLUMN "overriddenAt"       TIMESTAMPTZ(6),
  ADD COLUMN "checkedInAt"        TIMESTAMPTZ(6),
  ADD COLUMN "startedAt"          TIMESTAMPTZ(6),
  ADD COLUMN "completedAt"        TIMESTAMPTZ(6);

ALTER TABLE "appointments"
  ADD CONSTRAINT "Appointment_resourceId_fkey"
  FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL;
ALTER TABLE "appointments"
  ADD CONSTRAINT "Appointment_overriddenBy_fkey"
  FOREIGN KEY ("overriddenBy") REFERENCES "users"("id") ON DELETE SET NULL;

UPDATE "appointments" a
SET
  "startsAt" = CASE
    WHEN a."startTime" IS NOT NULL AND a."startTime" <> ''
      THEN ((a."date"::date + a."startTime"::time) AT TIME ZONE c."timezone")
    ELSE NULL
  END,
  "endsAt" = CASE
    WHEN a."endTime" IS NOT NULL AND a."endTime" <> ''
      THEN ((a."date"::date + a."endTime"::time) AT TIME ZONE c."timezone")
    WHEN a."startTime" IS NOT NULL AND a."startTime" <> ''
      THEN ((a."date"::date + a."startTime"::time) AT TIME ZONE c."timezone")
           + (COALESCE(a."durationMins", 30) * interval '1 minute')
    ELSE NULL
  END
FROM "clinics" c
WHERE c.id = a."clinicId"
  AND a."startsAt" IS NULL;

DO $$
DECLARE
  null_count INT;
  zero_dur_count INT;
BEGIN
  SELECT COUNT(*) INTO null_count FROM "appointments"
    WHERE "startsAt" IS NULL OR "endsAt" IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION
      'Backfill incompleto: % appointments con null en startsAt/endsAt. Revisa rows con date/startTime/endTime inválidos antes de re-ejecutar.', null_count;
  END IF;

  SELECT COUNT(*) INTO zero_dur_count FROM "appointments"
    WHERE "endsAt" <= "startsAt";
  IF zero_dur_count > 0 THEN
    RAISE EXCEPTION
      'Encontrados % appointments con duración no positiva (endsAt <= startsAt). Resolver manualmente antes de re-ejecutar.', zero_dur_count;
  END IF;
END$$;

ALTER TABLE "appointments"
  ALTER COLUMN "startsAt" SET NOT NULL,
  ALTER COLUMN "endsAt"   SET NOT NULL;

-- Defaults transitorios — habilitan que los routes legacy (que no setean
-- startsAt/endsAt explícitos) sigan funcionando hasta M2.b. M2.b los
-- remueve cuando todos los callers pasen los timestamps explícitamente.
ALTER TABLE "appointments"
  ALTER COLUMN "startsAt" SET DEFAULT now(),
  ALTER COLUMN "endsAt"   SET DEFAULT (now() + interval '30 minutes');

CREATE INDEX "Appointment_clinicId_startsAt_endsAt_status_idx"
  ON "appointments"("clinicId", "startsAt", "endsAt", "status");
CREATE INDEX "Appointment_doctorId_startsAt_idx"
  ON "appointments"("doctorId", "startsAt");
CREATE INDEX "Appointment_resourceId_startsAt_idx"
  ON "appointments"("resourceId", "startsAt");
CREATE INDEX "Appointment_clinicId_requiresValidation_idx"
  ON "appointments"("clinicId", "requiresValidation");

ALTER TABLE "appointments"
  ADD CONSTRAINT appt_positive_duration
  CHECK ("endsAt" > "startsAt");

ALTER TABLE "appointments"
  ADD CONSTRAINT appt_doctor_no_overlap
  EXCLUDE USING gist (
    "doctorId" WITH =,
    "clinicId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (
    "status" NOT IN ('CANCELLED', 'NO_SHOW')
    AND "overrideReason" IS NULL
  );

ALTER TABLE "appointments"
  ADD CONSTRAINT appt_resource_no_overlap
  EXCLUDE USING gist (
    "resourceId" WITH =,
    "clinicId"   WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (
    "resourceId" IS NOT NULL
    AND "status" NOT IN ('CANCELLED', 'NO_SHOW')
    AND "overrideReason" IS NULL
  );

COMMENT ON CONSTRAINT appt_doctor_no_overlap ON "appointments" IS
  'Fase 4: evita dos citas activas del mismo doctor. Admin puede bypasear con overrideReason.';
COMMENT ON CONSTRAINT appt_resource_no_overlap ON "appointments" IS
  'Fase 4: evita dos citas activas en el mismo sillón/sala.';
COMMENT ON CONSTRAINT appt_positive_duration ON "appointments" IS
  'Fase 4: duración estrictamente positiva (endsAt > startsAt).';
