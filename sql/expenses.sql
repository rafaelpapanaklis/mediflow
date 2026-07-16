-- ═══════════════════════════════════════════════════════════════════
-- FINANZAS — GASTOS DE LA CLÍNICA (módulo dirección financiera)
-- Tabla expenses ⇄ Expense (ver prisma/schema.prisma, junto a Payment).
--
-- ⚠️  CORRER EN SUPABASE (SQL Editor) ANTES del merge / deploy. Las rutas
--     /api/finanzas y /api/gastos toleran la tabla faltante (P2021 →
--     gastos=0 / tablaFaltante:true), pero sin este SQL no se puede
--     registrar ningún gasto.
--     https://supabase.com/dashboard/project/_/sql/new
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica datos.
-- Columnas camelCase entrecomilladas (espejo exacto de Prisma; sin @map).
-- Delimitador único $expenses$ (nunca $$ pelado — Supabase lo rompe).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Tabla expenses. Dinero en double precision (mismo tipo que payments.amount).
CREATE TABLE IF NOT EXISTS "expenses" (
  "id"          text             NOT NULL,
  "clinicId"    text             NOT NULL,
  "date"        timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "category"    text             NOT NULL,
  "amount"      double precision NOT NULL,
  "note"        text,
  "createdById" text             NOT NULL,
  "createdAt"   timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "expenses_clinicId_date_idx"
  ON "expenses" ("clinicId", "date");

-- 2) Llave foránea (idempotente vía pg_constraint).
--    expenses.clinicId → clinics CASCADE. createdById NO lleva FK: en el
--    schema de Prisma es un String suelto sin relación (espejo exacto).
DO $expenses$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_clinicId_fkey') THEN
    ALTER TABLE "expenses"
      ADD CONSTRAINT "expenses_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla referenciada inexistente — FK saltada (deploy parcial)';
END
$expenses$;

-- 3) Defense-in-depth: RLS deny-all para anon y authenticated (patrón
--    sql/rls-deny-all-policies.sql / sql/caja.sql). DaleControl accede solo
--    vía Prisma + service role (bypassa RLS). Cierra PostgREST si se filtra
--    el anon key.
DO $expenses$
BEGIN
  EXECUTE 'ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'expenses' AND policyname = 'expenses_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "expenses_deny_anon" ON "expenses" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'expenses no existe — RLS saltada';
END
$expenses$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación:
--   SELECT policyname FROM pg_policies WHERE tablename = 'expenses';
--   \d expenses
-- ═══════════════════════════════════════════════════════════════════
