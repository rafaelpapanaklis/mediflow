-- ═══════════════════════════════════════════════════════════════════════
-- Importar mi clínica: CUOTAS POR VENCER MIGRADAS — ws1-t6 (28-sep-2026)
-- ⚠️ PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase.
--
-- QUÉ
-- Crea migrated_installments: el CALENDARIO de una deuda migrada (Dentalink
-- "08c_Pagos_Por_Vencimiento" y equivalentes) — qué cuota vence cuándo, por
-- cuánto y si ya se pagó en el sistema anterior. NO es dinero nuevo:
--   · La deuda YA está contada en la factura "Saldo inicial migrado"
--     (balancesHandler, sql/patient-credits.sql / la migración de saldos) o en
--     el totalAmount de un MigratedOrthoCase (ws1-t1,
--     sql/ortodoncia-casos-migrados.sql). Esta tabla solo reparte esa MISMA
--     cantidad en fechas — nunca la suma dos veces.
--   · NUNCA toca "invoices" ni "payments": Caja, cortes de caja, CFDI y
--     WhatsApp la ignoran SIN código nuevo, porque ninguno lee
--     migrated_installments.
--   · Se ve, de solo lectura, en la ficha del paciente como
--     "Plan de pagos a plazos (migrado)".
--
-- ORDEN: este SQL puede ir ANTES o DESPUÉS del deploy. El código lo tolera
-- ausente (P2021/P2022): la vista previa/commit del importador y la lectura en
-- la ficha del paciente devuelven "sin datos" en vez de tumbar la pantalla,
-- igual que patient-credit.ts con patient_credits.
--
-- IDEMPOTENCIA DE LA IMPORTACIÓN: la llave va en import_external_ids
-- (source="cuotas-plan", entity="installment" — misma tabla de
-- sql/import-ids-externos.sql, que debe aplicarse también). Reimportar el
-- mismo archivo no duplica: por ID externo de la cuota si vino, si no por
-- paciente+vencimiento+monto+folio del plan.
--
-- SEGURIDAD: igual criterio que migrated_payments/migrated_ortho_cases — SÍ
-- está en schema.prisma (Prisma la usa por su cliente) pero SIN relación
-- declarada a Clinic/Patient/Invoice (esos modelos no cambian de forma). El
-- aislamiento por clínica es del código (WHERE "clinicId" SIEMPRE de la
-- sesión); la RLS sin políticas niega todo a anon/authenticated y el service
-- role (Prisma) la sigue usando.
--
-- IDEMPOTENTE: CREATE ... IF NOT EXISTS y ALTER ... ENABLE RLS son re-ejecutables.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "migrated_installments" (
    "id" TEXT PRIMARY KEY,
    "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "invoiceId" TEXT,
    "migratedOrthoCaseId" TEXT,
    "planExternalId" TEXT,
    "installmentNumber" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "concept" TEXT,
    "origin" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "migrated_installments_clinic_patient_due_idx"
    ON "migrated_installments"("clinicId", "patientId", "dueDate");

CREATE INDEX IF NOT EXISTS "migrated_installments_clinic_invoice_idx"
    ON "migrated_installments"("clinicId", "invoiceId");

ALTER TABLE "migrated_installments" ENABLE ROW LEVEL SECURITY;
