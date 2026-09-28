-- ═══════════════════════════════════════════════════════════════════════
-- Importar mi clínica: HISTORIAL DE GASTOS DE LABORATORIO MIGRADO — ws1-t2 (28-sep-2026)
-- ⚠️ PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase.
--
-- QUÉ
-- Crea migrated_lab_expenses: una acción de laboratorio YA pagada en el
-- sistema anterior (Dentalink "Laboratorio → Acciones/Costos" y equivalentes
-- de Excel/otros sistemas), con su fecha original, laboratorio, acción,
-- costo para la clínica, precio al paciente (si vino), paciente y doctor (si
-- vino). Es HISTORIA pura:
--   · El panel NO tiene un módulo de costos de laboratorio: LabOrder/
--     LabPartner (prisma/schema.prisma) son el flujo CLÍNICO de órdenes
--     (spec/status/pdf), sin campo de costo — no es el lugar para esto.
--   · NUNCA toca "invoices" ni "payments": el saldo del paciente no cambia,
--     y Caja/cortes de caja/CFDI/WhatsApp la ignoran SIN código nuevo, porque
--     ninguno de esos lee migrated_lab_expenses.
--   · Se ve, de solo lectura, en la ficha del paciente como
--     "Gastos de laboratorio (migrados)".
--
-- ORDEN: este SQL puede ir ANTES o DESPUÉS del deploy. El código lo tolera
-- ausente (P2021/P2022): la vista previa/commit del importador y la lectura en
-- la ficha del paciente devuelven "sin datos" en vez de tumbar la pantalla,
-- igual que migrated_payments (sql/pagos-historial-migrados.sql).
--
-- IDEMPOTENCIA DE LA IMPORTACIÓN: la llave va en import_external_ids
-- (source="laboratorio-historial", entity="labExpense" — misma tabla de
-- sql/import-ids-externos.sql, que debe aplicarse también). Reimportar el
-- mismo archivo no duplica: por ID externo de la acción si vino, si no por
-- paciente+fecha+costo+acción.
--
-- SEGURIDAD: igual criterio que migrated_payments/patient_credits — SÍ está
-- en schema.prisma (Prisma la usa por su cliente, no por SQL crudo) pero SIN
-- relación declarada a Clinic/Patient (Clinic/Patient no cambian de forma).
-- El aislamiento por clínica es del código (WHERE "clinicId" SIEMPRE de la
-- sesión); la RLS sin políticas niega todo a anon/authenticated y el service
-- role (Prisma) la sigue usando.
--
-- IDEMPOTENTE: CREATE ... IF NOT EXISTS y ALTER ... ENABLE RLS son re-ejecutables.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "migrated_lab_expenses" (
    "id" TEXT PRIMARY KEY,
    "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "labName" TEXT,
    "action" TEXT NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "patientPrice" DOUBLE PRECISION,
    "doctorId" TEXT,
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "origin" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "migrated_lab_expenses_clinic_patient_idx"
    ON "migrated_lab_expenses"("clinicId", "patientId", "incurredAt");

ALTER TABLE "migrated_lab_expenses" ENABLE ROW LEVEL SECURITY;
