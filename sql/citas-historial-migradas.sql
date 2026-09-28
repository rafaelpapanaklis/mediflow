-- ═══════════════════════════════════════════════════════════════════════
-- Importar mi clínica: HISTORIAL DE CITAS PASADAS MIGRADO — ws1-t12 (28-sep-2026)
-- ⚠️ PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase.
--
-- QUÉ
-- Crea migrated_visits: una cita del sistema anterior que YA terminó
-- (atendida, no asistió, cancelada) — Dentalink "05b_Citas_Estados_Historico"
-- y equivalentes. El importador de citas vivas (appointmentsHandler,
-- entities.ts) omite a propósito las citas pasadas: sin esta tabla esa
-- historia se perdía por completo. Es HISTORIA pura:
--   · NUNCA toca "appointments": no dispara un recordatorio de WhatsApp ni un
--     cobro, porque ningún código nuevo lee migrated_visits (el barrido de
--     recordatorios y el de seguimiento post-cita solo consultan Appointment).
--   · Se ve, de solo lectura, en la ficha del paciente como
--     "Citas anteriores (migradas)".
--
-- ORDEN: este SQL puede ir ANTES o DESPUÉS del deploy. El código lo tolera
-- ausente (P2021/P2022): la vista previa/commit del importador y la lectura en
-- la ficha del paciente devuelven "sin datos" en vez de tumbar la pantalla,
-- igual que migrated_payments.
--
-- IDEMPOTENCIA DE LA IMPORTACIÓN: sin tabla de IDs externos — la llave es
-- paciente + instante exacto + estado (import y lectura comparan contra las
-- filas ya guardadas). Reimportar el mismo archivo no duplica.
--
-- SEGURIDAD: igual criterio que migrated_payments/migrated_installments — SÍ
-- está en schema.prisma (Prisma la usa por su cliente) pero SIN relación
-- declarada a Clinic/Patient/User (esos modelos no cambian de forma). El
-- aislamiento por clínica es del código (WHERE "clinicId" SIEMPRE de la
-- sesión); la RLS sin políticas niega todo a anon/authenticated y el service
-- role (Prisma) la sigue usando.
--
-- IDEMPOTENTE: CREATE ... IF NOT EXISTS y ALTER ... ENABLE RLS son re-ejecutables.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "migrated_visits" (
    "id" TEXT PRIMARY KEY,
    "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "doctorId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL,
    "type" TEXT,
    "notes" TEXT,
    "origin" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "migrated_visits_clinic_patient_idx"
    ON "migrated_visits"("clinicId", "patientId", "startsAt");

ALTER TABLE "migrated_visits" ENABLE ROW LEVEL SECURITY;
