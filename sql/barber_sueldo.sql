-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — SUELDO DEL BARBERO (ws6-t6, 16-nov-2026).
--
-- Rafael: «Que sea opcional que se ponga su sueldo semanal, quincenal o
-- mensual, si trae sueldo».
--
-- Dos cosas, las dos ADITIVAS:
--
--   1. Dos columnas en "barber_barbers": cuánto gana ("salaryAmount", MXN) y
--      cada cuándo ("salaryPeriod": WEEKLY / BIWEEKLY / MONTHLY). Nacen
--      vacías: pegar esto no le pone sueldo a nadie. Solo cuentan mientras
--      el barbero cobra por «Sueldo»; si se cambia a Comisión o Renta, el
--      monto se conserva pero deja de sumar.
--
--   2. La tabla "barber_salary_payments": el sueldo PAGADO de un barbero en
--      un periodo de Comisiones ("YYYY-MM"), con el monto CONGELADO al
--      pagar. Un renglón por barbero y periodo: el sueldo de un mes no se
--      puede pagar dos veces. Lo escribe «Marcar pagado» en Comisiones, en
--      la misma transacción que marca las comisiones y propinas.
--
-- El código funciona ANTES de pegar esto: sin las columnas, «Sueldo» se ve
-- como hoy (sin monto) y Comisiones no suma ningún sueldo.
--
-- Plano e idempotente: se puede pegar dos veces. Supabase → SQL Editor.
--
-- Para deshacerlo (no toca tickets, comisiones ni el corte):
--   DROP TABLE IF EXISTS "barber_salary_payments";
--   ALTER TABLE "barber_barbers" DROP COLUMN IF EXISTS "salaryAmount",
--     DROP COLUMN IF EXISTS "salaryPeriod";
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Sueldo en la ficha del barbero ──────────────────────────────────
ALTER TABLE "barber_barbers" ADD COLUMN IF NOT EXISTS "salaryAmount" DECIMAL(10,2);
ALTER TABLE "barber_barbers" ADD COLUMN IF NOT EXISTS "salaryPeriod" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_barbers_salary_amount_chk') THEN
    ALTER TABLE "barber_barbers" ADD CONSTRAINT "barber_barbers_salary_amount_chk"
      CHECK ("salaryAmount" IS NULL OR "salaryAmount" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_barbers_salary_period_chk') THEN
    ALTER TABLE "barber_barbers" ADD CONSTRAINT "barber_barbers_salary_period_chk"
      CHECK ("salaryPeriod" IS NULL OR "salaryPeriod" IN ('WEEKLY', 'BIWEEKLY', 'MONTHLY'));
  END IF;
  -- Monto y periodo van juntos: los dos o ninguno.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_barbers_salary_pair_chk') THEN
    ALTER TABLE "barber_barbers" ADD CONSTRAINT "barber_barbers_salary_pair_chk"
      CHECK (("salaryAmount" IS NULL) = ("salaryPeriod" IS NULL));
  END IF;
END $$;

-- ── 2. Sueldo pagado por periodo ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "barber_salary_payments" (
    "id"            TEXT NOT NULL,
    "barbershopId"  TEXT NOT NULL,
    "barberId"      TEXT NOT NULL,
    "periodKey"     TEXT NOT NULL,
    "amount"        DECIMAL(10,2) NOT NULL,
    -- true = el mes no era un número exacto de semanas/quincenas: se prorrateó por días.
    "approx"        BOOLEAN NOT NULL DEFAULT false,
    "salaryAmount"  DECIMAL(10,2) NOT NULL,
    "salaryPeriod"  TEXT NOT NULL,
    "paidAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "paidByUserId"  TEXT,
    CONSTRAINT "barber_salary_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "barber_salary_payments_barbershop_fkey"
        FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "barber_salary_payments_barber_fkey"
        FOREIGN KEY ("barberId") REFERENCES "barber_barbers"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "barber_salary_payments_period_chk" CHECK ("periodKey" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "barber_salary_payments_amount_chk" CHECK ("amount" >= 0),
    CONSTRAINT "barber_salary_payments_salary_period_chk"
        CHECK ("salaryPeriod" IN ('WEEKLY', 'BIWEEKLY', 'MONTHLY'))
);

-- Un sueldo por barbero y periodo: nunca se paga dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS "barber_salary_payments_barber_period_key"
    ON "barber_salary_payments" ("barberId", "periodKey");

CREATE INDEX IF NOT EXISTS "barber_salary_payments_shop_period_idx"
    ON "barber_salary_payments" ("barbershopId", "periodKey");
