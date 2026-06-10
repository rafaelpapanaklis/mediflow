-- ═══════════════════════════════════════════════════════════════════════
-- Reagendar/cancelar citas desde el portal del paciente (WS1-T5).
--
-- Equivalente idempotente del modelo Prisma AppointmentChangeRequest +
-- 2 columnas nuevas en la tabla de clínicas (patientChangesAutoApprove,
-- patientChangesMinHours).
--
-- Aplicar manualmente en Supabase (SQL editor). Re-ejecutable: cada bloque
-- comprueba existencia antes de crear.
--
-- Nota sobre $$: usar un único delimitador `$rc$` y NUNCA bloques DO
-- anidados (el parser SQL de Supabase rompe con $$ anidado).
-- ═══════════════════════════════════════════════════════════════════════


-- ── Tabla ─────────────────────────────────────────────────────────────

-- Solicitud de cambio (reagendar/cancelar) hecha por el paciente desde el
-- portal. type: 'RESCHEDULE' | 'CANCEL'. status: 'PENDING' | 'APPROVED' |
-- 'REJECTED'. accountId guarda el PatientAccount.id que solicitó (solo
-- auditoría): SIN FK a "patient_accounts" a propósito, para no acoplar el
-- portal a este módulo.
CREATE TABLE IF NOT EXISTS "appointment_change_requests" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(500),
    "proposedStartsAt" TIMESTAMPTZ(6),
    "proposedEndsAt" TIMESTAMPTZ(6),
    "autoApproved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMPTZ(6),
    "resolutionNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "appointment_change_requests_pkey" PRIMARY KEY ("id")
);


-- ── Índices ───────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "appointment_change_requests_clinicId_status_createdAt_idx"
    ON "appointment_change_requests"("clinicId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "appointment_change_requests_appointmentId_status_idx"
    ON "appointment_change_requests"("appointmentId", "status");

-- UNIQUE parcial: una sola solicitud PENDING viva por cita. Prisma no puede
-- declarar índices parciales, por eso solo existe en este SQL.
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_change_requests_one_pending_key"
    ON "appointment_change_requests"("appointmentId") WHERE "status" = 'PENDING';


-- ── Foreign keys ──────────────────────────────────────────────────────
-- accountId queda SIN FK (ver nota de la tabla).

DO $rc$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointment_change_requests_clinicId_fkey'
  ) THEN
    ALTER TABLE "appointment_change_requests"
      ADD CONSTRAINT "appointment_change_requests_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointment_change_requests_appointmentId_fkey'
  ) THEN
    ALTER TABLE "appointment_change_requests"
      ADD CONSTRAINT "appointment_change_requests_appointmentId_fkey"
      FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointment_change_requests_patientId_fkey'
  ) THEN
    ALTER TABLE "appointment_change_requests"
      ADD CONSTRAINT "appointment_change_requests_patientId_fkey"
      FOREIGN KEY ("patientId") REFERENCES "patients"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointment_change_requests_resolvedById_fkey'
  ) THEN
    ALTER TABLE "appointment_change_requests"
      ADD CONSTRAINT "appointment_change_requests_resolvedById_fkey"
      FOREIGN KEY ("resolvedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$rc$;


-- ── Config por clínica ────────────────────────────────────────────────
-- Si patientChangesAutoApprove está OFF, las solicitudes quedan PENDING
-- hasta que la clínica las resuelva. patientChangesMinHours = ventana
-- mínima en horas antes de la cita para aceptar solicitudes del portal.

ALTER TABLE "clinics"
  ADD COLUMN IF NOT EXISTS "patientChangesAutoApprove" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "patientChangesMinHours"    INTEGER NOT NULL DEFAULT 24;


-- ── RLS deny-all (defense-in-depth) ───────────────────────────────────
-- MediFlow accede a esta tabla SOLO vía Prisma + service role (server-side).
-- El cliente nunca hace supabase.from('appointment_change_requests').
-- Cerramos la puerta a accesos vía PostgREST con una policy RESTRICTIVE
-- deny-all para anon y authenticated. El service role bypassa RLS por diseño.
-- Sigue el patrón de sql/rls-deny-all-policies.sql.

ALTER TABLE "appointment_change_requests" ENABLE ROW LEVEL SECURITY;

DO $rc$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'appointment_change_requests'
      AND policyname = 'appointment_change_requests_deny_anon'
  ) THEN
    CREATE POLICY "appointment_change_requests_deny_anon" ON "appointment_change_requests"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END
$rc$;
