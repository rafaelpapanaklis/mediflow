-- ═══════════════════════════════════════════════════════════════════════
-- Importar mi clínica: HISTORIAL DE PAGOS MIGRADO — ws1-t6 (28-sep-2026)
-- ⚠️ PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase.
--
-- QUÉ
-- Crea migrated_payments: un pago que YA ocurrió en el sistema anterior
-- (Dentalink "Pagos pacientes" y equivalentes de Excel/otros sistemas), con su
-- fecha original, monto, método, paciente, doctor (si vino) y concepto/folio
-- de origen. Es HISTORIA pura:
--   · NUNCA toca "invoices" ni "payments": el saldo del paciente no cambia
--     (viene del archivo de saldos, tabla balancesHandler ya existente), y
--     Caja/cortes de caja/CFDI/WhatsApp la ignoran SIN código nuevo, porque
--     ninguno de esos lee migrated_payments.
--   · Se ve, de solo lectura, en la ficha del paciente como
--     "Pagos anteriores (migrados)".
--
-- ORDEN: este SQL puede ir ANTES o DESPUÉS del deploy. El código lo tolera
-- ausente (P2021/P2022): la vista previa/commit del importador y la lectura en
-- la ficha del paciente devuelven "sin datos" en vez de tumbar la pantalla,
-- igual que patient-credit.ts con patient_credits.
--
-- IDEMPOTENCIA DE LA IMPORTACIÓN: la llave va en import_external_ids
-- (source="pagos-historial", entity="payment" — misma tabla de
-- sql/import-ids-externos.sql, que debe aplicarse también). Reimportar el
-- mismo archivo no duplica: por ID externo del pago si vino, si no por
-- paciente+fecha+monto+folio.
--
-- SEGURIDAD: igual criterio que patient_credits — SÍ está en schema.prisma
-- (Prisma la usa por su cliente, no por SQL crudo) pero SIN relación
-- declarada a Clinic/Patient (Clinic/Patient no cambian de forma). El
-- aislamiento por clínica es del código (WHERE "clinicId" SIEMPRE de la
-- sesión); la RLS sin políticas niega todo a anon/authenticated y el service
-- role (Prisma) la sigue usando.
--
-- IDEMPOTENTE: CREATE ... IF NOT EXISTS y ALTER ... ENABLE RLS son re-ejecutables.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "migrated_payments" (
    "id" TEXT PRIMARY KEY,
    "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT,
    "concept" TEXT,
    "doctorId" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "origin" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "migrated_payments_clinic_patient_idx"
    ON "migrated_payments"("clinicId", "patientId", "paidAt");

ALTER TABLE "migrated_payments" ENABLE ROW LEVEL SECURITY;
