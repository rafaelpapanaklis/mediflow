-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — FORMAS DE PAGO: débito, crédito y cheque,
-- meses sin intereses del banco, y el pago dividido de una mensualidad.
--
-- Va DESPUÉS de sql/edu-pagos.sql (necesita "EduPaymentMethod",
-- "edu_payments" y "edu_installments"). En el orden general de aplicación
-- va al FINAL, después del último .sql del vertical que hayas corrido.
-- Producto SEPARADO del dental, que está VIVO en producción: este archivo
-- NO toca ni una tabla, ni una columna, ni una fila del dental, de
-- barbería ni de inmuebles.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada sentencia comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   3 valores de enum · "EduPaymentMethod" += CARD_DEBIT, CARD_CREDIT, CHECK
--   2 columnas        · edu_payments."msiMonths", edu_payments."installmentId"
--   1 índice          · edu_payments_installment_idx
--   1 llave foránea   · edu_payments."installmentId" → edu_installments(id)
--   0 backfill        · no hay keys de permiso nuevas y NADA se migra
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 LO QUE ESTE SCRIPT NO HACE, A PROPÓSITO:
--   · NO borra ni migra 'CARD'. Una fila vieja no sabe si fue débito o
--     crédito, y adivinarlo sería falsear la forma de pago con la que el
--     SAT cruza depósitos. 'CARD' se queda como "Tarjeta (sin
--     especificar)": se lee, se suma en el corte y se factura; deja de
--     ofrecerse en los selectores, que es cosa del código, no de la base.
--   · NO guarda "importe del pago dividido" en ninguna columna nueva:
--     cada forma es su propia fila de edu_payments, con su método y su
--     monto POSITIVO. La suma de las filas de una mensualidad es
--     exactamente su "amountCents", y eso lo garantiza la transacción.
--   · NO guarda intereses de MSI: "msiMonths" es INFORMATIVO. Los meses
--     sin intereses los financia el BANCO y la escuela recibe el total el
--     mismo día; el plan de pagos de la escuela es otra cosa
--     (edu_payment_plans) y ya existe.
--
-- ⚠️ Los ALTER TYPE van SUELTOS y ANTES de todo lo demás, no dentro de un
-- DO: Postgres no deja usar un valor de enum recién agregado en la misma
-- transacción que lo agregó, y dentro de un bloque DO el parser ni
-- siquiera acepta la sentencia.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TYPE "EduPaymentMethod" ADD VALUE IF NOT EXISTS 'CARD_DEBIT';
ALTER TYPE "EduPaymentMethod" ADD VALUE IF NOT EXISTS 'CARD_CREDIT';
ALTER TYPE "EduPaymentMethod" ADD VALUE IF NOT EXISTS 'CHECK';

ALTER TABLE "edu_payments" ADD COLUMN IF NOT EXISTS "msiMonths" INTEGER;
ALTER TABLE "edu_payments" ADD COLUMN IF NOT EXISTS "installmentId" TEXT;

CREATE INDEX IF NOT EXISTS "edu_payments_installment_idx" ON "edu_payments" ("institutionId", "installmentId");

DO $edu$ BEGIN
  ALTER TABLE "edu_payments" ADD CONSTRAINT "edu_payments_installmentId_fkey"
    FOREIGN KEY ("installmentId") REFERENCES "edu_installments" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $edu$;

-- Comprobación: deben dar 7 y 2.
SELECT COUNT(*) AS metodos FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'EduPaymentMethod';
SELECT COUNT(*) AS columnas FROM information_schema.columns WHERE table_name = 'edu_payments' AND column_name IN ('msiMonths','installmentId');
