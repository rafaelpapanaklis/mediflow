-- ═══════════════════════════════════════════════════════════════════
-- CAJA / CORTE DE CAJA DIARIO (WS1-T2, 2026-07-08)
-- Tablas cash_registers ⇄ CashRegister y cash_withdrawals ⇄ CashWithdrawal
-- (ver prisma/schema.prisma, junto a Payment). Enum "CashStatus".
--
-- ⚠️  CORRER EN SUPABASE (SQL Editor) ANTES del merge / deploy. Prisma
--     incluye estas tablas en sus queries: si NO se corre, /dashboard/caja
--     y /api/caja/* responden 500 (mismo patrón que CRM / afiliados —
--     ver MEMORY: lesson_ortho_schema_drift).
--     https://supabase.com/dashboard/project/_/sql/new
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica datos.
-- Columnas camelCase entrecomilladas (espejo exacto de Prisma; sin @map).
--
-- Nota de nombre del enum: Prisma nombra el tipo Postgres igual que el enum
-- del datamodel ("CashStatus"), NO snake_case. Se respeta esa convención del
-- repo (ver sql/ai-billing.sql, sql/affiliates.sql) para que el client no
-- rompa. Delimitador único $caja$ (nunca $$ pelado — Supabase lo rompe).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Enum (idempotente vía pg_type) ────────────────────────────────
DO $caja$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CashStatus') THEN
    CREATE TYPE "CashStatus" AS ENUM ('OPEN', 'CLOSED');
  END IF;
END
$caja$;

-- 2) Tabla cash_registers. Los totales derivados (ingresos/descuentos/IVA/
--    retiros) NO se guardan mientras está OPEN; al CERRAR se congelan en los
--    campos snapshot* para auditoría.
CREATE TABLE IF NOT EXISTS "cash_registers" (
  "id"                    text         NOT NULL,
  "clinicId"              text         NOT NULL,
  "operatorId"            text         NOT NULL,
  "openedAt"              timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "openingBalance"        double precision NOT NULL,
  "closedAt"              timestamp(3),
  "countedClosingBalance" double precision,
  "closingNotes"          text,
  "status"                "CashStatus" NOT NULL DEFAULT 'OPEN',
  "snapshotCashIncome"    double precision,
  "snapshotOtherIncome"   double precision,
  "snapshotDiscounts"     double precision,
  "snapshotTax"           double precision,
  "snapshotWithdrawals"   double precision,
  "snapshotExpectedCash"  double precision,
  "snapshotVariance"      double precision,
  "createdAt"             timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "cash_registers_clinicId_status_idx"
  ON "cash_registers" ("clinicId", "status");

-- 3) Tabla cash_withdrawals. Retiros de efectivo de una caja abierta.
CREATE TABLE IF NOT EXISTS "cash_withdrawals" (
  "id"             text             NOT NULL,
  "cashRegisterId" text             NOT NULL,
  "amount"         double precision NOT NULL,
  "reason"         text             NOT NULL,
  "recordedBy"     text             NOT NULL,
  "recordedAt"     timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_withdrawals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "cash_withdrawals_cashRegisterId_idx"
  ON "cash_withdrawals" ("cashRegisterId");

-- 4) Llaves foráneas (idempotentes vía pg_constraint).
--    cash_registers.clinicId → clinics CASCADE; operatorId → users RESTRICT.
--    cash_withdrawals.cashRegisterId → cash_registers CASCADE;
--    recordedBy → users RESTRICT (espeja el default de Prisma sin onDelete).
DO $caja$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_registers_clinicId_fkey') THEN
    ALTER TABLE "cash_registers"
      ADD CONSTRAINT "cash_registers_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_registers_operatorId_fkey') THEN
    ALTER TABLE "cash_registers"
      ADD CONSTRAINT "cash_registers_operatorId_fkey"
      FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_withdrawals_cashRegisterId_fkey') THEN
    ALTER TABLE "cash_withdrawals"
      ADD CONSTRAINT "cash_withdrawals_cashRegisterId_fkey"
      FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_withdrawals_recordedBy_fkey') THEN
    ALTER TABLE "cash_withdrawals"
      ADD CONSTRAINT "cash_withdrawals_recordedBy_fkey"
      FOREIGN KEY ("recordedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla referenciada inexistente — FKs saltadas (deploy parcial)';
END
$caja$;

-- 5) Defense-in-depth: RLS deny-all para anon y authenticated (patrón
--    sql/rls-deny-all-policies.sql). DaleControl accede solo vía Prisma +
--    service role (bypassa RLS). Cierra PostgREST si se filtra el anon key.
DO $caja$
BEGIN
  EXECUTE 'ALTER TABLE "cash_registers" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cash_registers' AND policyname = 'cash_registers_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "cash_registers_deny_anon" ON "cash_registers" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;

  EXECUTE 'ALTER TABLE "cash_withdrawals" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cash_withdrawals' AND policyname = 'cash_withdrawals_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "cash_withdrawals_deny_anon" ON "cash_withdrawals" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'cash_registers / cash_withdrawals no existe — RLS saltada';
END
$caja$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación:
--   SELECT typname FROM pg_type WHERE typname = 'CashStatus';
--   SELECT policyname FROM pg_policies WHERE tablename IN ('cash_registers','cash_withdrawals');
--   \d cash_registers
--   \d cash_withdrawals
-- ═══════════════════════════════════════════════════════════════════
