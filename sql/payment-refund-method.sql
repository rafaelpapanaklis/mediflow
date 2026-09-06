-- ═══════════════════════════════════════════════════════════════════
-- REEMBOLSOS: CON QUÉ MÉTODO SALIÓ EL DINERO (WS1-T6, hallazgo 18a)
-- Tabla "payments" ⇄ model Payment (prisma/schema.prisma).
--
-- POR QUÉ. El reembolso se guarda como un Payment con method='refund' y monto
-- POSITIVO (ver /api/invoices/[id]/refund). Esa fila dice CUÁNTO se devolvió,
-- pero no CÓMO: hoy un reembolso pagado del cajón es indistinguible de uno
-- devuelto a la tarjeta. Por eso el corte de caja NO puede restar lo devuelto
-- del efectivo esperado: restarlo todo cambiaría el faltante fantasma actual
-- (cobras $3,000 en efectivo, los devuelves en efectivo, el corte reclama
-- $3,000 que nadie se llevó) por un sobrante fantasma en las clínicas que
-- devuelven a la tarjeta. Con esta columna, el corte resta SOLO lo que salió
-- del cajón.
--
-- ⚠️  CORRER EN SUPABASE (SQL Editor). Es ADITIVO e IDEMPOTENTE: no borra ni
--     modifica ninguna fila, y la columna nace NULL. Se puede correr ANTES de
--     integrar cualquier rama sin romper nada: el código de hoy no la lee.
--     https://supabase.com/dashboard/project/_/sql/new
--
-- SIN BACKFILL, a propósito. Los reembolsos ya registrados se quedan en NULL
-- ("no se sabe"), que es la verdad. Adivinarles un método volvería a inventar
-- dinero, que es justo el bug que esto viene a cerrar.
--
-- Columna camelCase entrecomillada: espejo exacto de Prisma, que en Payment no
-- usa @map (ver sql/caja.sql).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "refundMethod" text;

COMMENT ON COLUMN "payments"."refundMethod" IS
  'Solo en filas con method=''refund'': método por el que SALIÓ el dinero '
  '("cash" | "debit" | "credit" | "transfer" | "check" | "other"). NULL = no '
  'registrado (reembolsos anteriores a esta columna): el corte de caja NO lo '
  'descuenta del efectivo esperado.';

-- ── Lo que hay que añadir a prisma/schema.prisma en el MISMO push ──────────
-- (no está en este archivo porque el SQL no genera el client; sin el campo en
--  el schema, Prisma no lo selecciona y el corte lo sigue ignorando)
--
--   model Payment {
--     ...
--     method       String
--     refundMethod String?   // solo en reembolsos: método por el que salió el dinero
--     ...
--   }
--
-- Y en /api/invoices/[id]/refund, al crear el Payment del reembolso:
--   data: { invoiceId, amount, method: "refund", refundMethod, notes }
-- con `refundMethod` elegido por quien reembolsa (el modal tiene que pedirlo:
-- si no se pide, la columna nace NULL y no arregla nada).
