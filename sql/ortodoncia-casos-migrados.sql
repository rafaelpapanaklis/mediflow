-- ═══════════════════════════════════════════════════════════════════════
-- Importar mi clínica: CASOS DE ORTODONCIA MIGRADOS — ws1-t1 (28-sep-2026)
-- ⚠️ PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase.
--
-- QUÉ
-- Crea migrated_ortho_cases: un caso de ortodoncia YA ABIERTO en el sistema
-- anterior (Dentalink "11_Pacientes_Ortodoncia" y equivalentes de Excel/otros
-- sistemas), con técnica, doctor tratante, fecha de colocación, estado y
-- duración estimada. Es HISTORIA ADMINISTRATIVA, de solo lectura:
--   · NO crea OrthodonticDiagnosis ni OrthodonticTreatmentPlan (el caso
--     clínico VIVO del módulo de Ortodoncia): esos modelos exigen datos de
--     examen clínico (angleClassRight, angleClassLeft, overbiteMm,
--     overbitePercentage, overjetMm, dentalPhase, clinicalSummary…) que
--     Dentalink no exporta. Inventar esos valores sería adivinar en silencio
--     sobre el expediente clínico de un paciente real — prohibido por la
--     tarea. Por eso "technique"/"status" quedan en TEXTO LIBRE, nunca
--     forzados a los enums OrthoTechnique/OrthoTreatmentStatus del caso vivo.
--   · NUNCA toca "invoices" ni "payments": el precio total del caso
--     (totalAmount) es informativo. El saldo del paciente ya debería venir
--     contado en el archivo de saldos (04_Saldos, balancesHandler existente)
--     — crear una factura aparte para este caso duplicaría esa deuda.
--   · Se ve, de solo lectura, en la ficha del paciente (pestaña Ortodoncia)
--     como "Casos de ortodoncia (migrados)", con una llamada a completar el
--     diagnóstico clínico real para activarlo en el tablero si la clínica
--     quiere seguir el caso ahí.
--
-- ORDEN: este SQL puede ir ANTES o DESPUÉS del deploy. El código lo tolera
-- ausente (P2021/P2022): la vista previa/commit del importador y la lectura
-- en la ficha del paciente devuelven "sin datos" en vez de tumbar la
-- pantalla, igual que migrated_payments (sql/pagos-historial-migrados.sql).
--
-- IDEMPOTENCIA DE LA IMPORTACIÓN: la llave va en import_external_ids
-- (source="ortho-casos", entity="orthoCase" — misma tabla de
-- sql/import-ids-externos.sql, que debe aplicarse también). Reimportar el
-- mismo archivo no duplica: por ID externo del caso/paciente si vino, si no
-- por paciente+técnica+fecha de colocación.
--
-- SEGURIDAD: igual criterio que migrated_payments — SÍ está en
-- schema.prisma (Prisma la usa por su cliente) pero SIN relación declarada a
-- Clinic/Patient/User (esos modelos no cambian de forma). El aislamiento por
-- clínica es del código (WHERE "clinicId" SIEMPRE de la sesión); la RLS sin
-- políticas niega todo a anon/authenticated y el service role (Prisma) la
-- sigue usando.
--
-- IDEMPOTENTE: CREATE ... IF NOT EXISTS y ALTER ... ENABLE RLS son
-- re-ejecutables.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "migrated_ortho_cases" (
    "id" TEXT PRIMARY KEY,
    "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "technique" TEXT,
    "treatingDoctorId" TEXT,
    "treatingDoctorName" TEXT,
    "status" TEXT NOT NULL,
    "statusRaw" TEXT,
    "installedAt" TIMESTAMP(3),
    "estimatedDurationMonths" INTEGER,
    "totalAmount" DOUBLE PRECISION,
    "originInvoiceFolio" TEXT,
    "origin" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "migrated_ortho_cases_clinic_patient_idx"
    ON "migrated_ortho_cases"("clinicId", "patientId");

ALTER TABLE "migrated_ortho_cases" ENABLE ROW LEVEL SECURITY;
