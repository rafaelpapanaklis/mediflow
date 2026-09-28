-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T1 · ORTODONCIA OLA 1, parte «Cobro» (F1-F13).
--
-- Cuatro piezas aditivas, todas nuevas (nada existente se toca):
--   1) "invoices"."orthodonticTreatmentPlanId" — liga una factura EXTRA
--      (F5: reposición, retenedor, microtornillo…) de vuelta al caso. La
--      factura PRINCIPAL del tratamiento sigue enlazada al revés, por
--      "orthodontic_treatment_plans"."invoiceId" (Ola 0, ya aplicado).
--   2) "orthodontic_billing_configs" — política de cobro POR CLÍNICA:
--      recargo por atraso (F10, apagado por default) y catálogo de reglas
--      de descuento (F9: contado/hermanos/pago puntual).
--   3) "orthodontic_case_billing" — datos financieros POR CASO que no le
--      tocan a "Alta del caso": cuántas reposiciones incluye el plan y
--      cuántas ya se usaron (F11), qué descuento se le aplicó (F9).
--   4) "orthodontic_payment_promises" — promesas de pago (F12).
--
-- PLANO: sin bloques DO (el SQL Editor de Rafael no los acepta).
-- IDEMPOTENTE: todo con IF NOT EXISTS; correrlo varias veces no falla.
-- NO usa Prisma Migrate ni toca prisma/schema.prisma a propósito: mismo
-- patrón que sql/factura-condiciones-pago.sql
-- (src/lib/invoices/condiciones-pago-db.ts) — SQL crudo + sonda
-- `to_regclass` en el código, así que ESTE archivo puede pegarse en
-- cualquier momento sin coordinarse con las otras pantallas que sí editan
-- schema.prisma en esta misma ola (Acceso y permisos, Alta del caso,
-- Control y agenda). El código YA tolera que estas tablas/columnas no
-- existan (P2021/P2022 / "no existe la tabla") — no tumba dev.108.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Factura extra del caso (F5) ──────────────────────────────────────
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "orthodonticTreatmentPlanId" TEXT;

CREATE INDEX IF NOT EXISTS "invoices_orthodonticTreatmentPlanId_idx"
  ON "invoices" ("orthodonticTreatmentPlanId");

ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_orthodonticTreatmentPlanId_fkey";
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_orthodonticTreatmentPlanId_fkey"
  FOREIGN KEY ("orthodonticTreatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;


-- ── 2. Política de cobro por clínica (F9 reglas de descuento, F10 recargo) ─
CREATE TABLE IF NOT EXISTS "orthodontic_billing_configs" (
  "clinicId"         TEXT PRIMARY KEY,
  "lateFeeEnabled"   BOOLEAN NOT NULL DEFAULT false,
  "lateFeeType"      TEXT NOT NULL DEFAULT 'PCT',
  "lateFeeValue"     NUMERIC NOT NULL DEFAULT 0,
  "lateFeeGraceDays" INTEGER NOT NULL DEFAULT 5,
  "discountRules"    JSONB NOT NULL DEFAULT '[]',
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "orthodontic_billing_configs" DROP CONSTRAINT IF EXISTS "orthodontic_billing_configs_clinicId_fkey";
ALTER TABLE "orthodontic_billing_configs"
  ADD CONSTRAINT "orthodontic_billing_configs_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


-- ── 3. Datos financieros del caso (F9 descuento elegido, F11 reposiciones) ─
CREATE TABLE IF NOT EXISTS "orthodontic_case_billing" (
  "treatmentPlanId"           TEXT PRIMARY KEY,
  "clinicId"                  TEXT NOT NULL,
  "includedReplacementsTotal" INTEGER NOT NULL DEFAULT 2,
  "includedReplacementsUsed"  INTEGER NOT NULL DEFAULT 0,
  "discountRuleId"            TEXT,
  "discountLabel"             TEXT,
  "discountPct"               NUMERIC,
  "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "orthodontic_case_billing" DROP CONSTRAINT IF EXISTS "orthodontic_case_billing_treatmentPlanId_fkey";
ALTER TABLE "orthodontic_case_billing"
  ADD CONSTRAINT "orthodontic_case_billing_treatmentPlanId_fkey"
  FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "orthodontic_case_billing_clinicId_idx"
  ON "orthodontic_case_billing" ("clinicId");


-- ── 4. Promesas de pago (F12) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "orthodontic_payment_promises" (
  "id"              TEXT PRIMARY KEY,
  "treatmentPlanId" TEXT NOT NULL,
  "clinicId"        TEXT NOT NULL,
  "amount"          NUMERIC NOT NULL,
  "promisedDate"    DATE NOT NULL,
  "note"            TEXT,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fulfilledAt"     TIMESTAMP(3),
  "cancelledAt"     TIMESTAMP(3)
);

ALTER TABLE "orthodontic_payment_promises" DROP CONSTRAINT IF EXISTS "orthodontic_payment_promises_treatmentPlanId_fkey";
ALTER TABLE "orthodontic_payment_promises"
  ADD CONSTRAINT "orthodontic_payment_promises_treatmentPlanId_fkey"
  FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "orthodontic_payment_promises_treatmentPlanId_idx"
  ON "orthodontic_payment_promises" ("treatmentPlanId");
CREATE INDEX IF NOT EXISTS "orthodontic_payment_promises_clinicId_idx"
  ON "orthodontic_payment_promises" ("clinicId");


-- ── 5. Comprobación (solo lee) ───────────────────────────────────────────
SELECT table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE (table_name = 'invoices' AND column_name = 'orthodonticTreatmentPlanId')
   OR (table_name = 'orthodontic_billing_configs')
   OR (table_name = 'orthodontic_case_billing')
   OR (table_name = 'orthodontic_payment_promises')
ORDER BY table_name, column_name;
