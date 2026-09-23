-- ═══════════════════════════════════════════════════════════════════════
-- El anticipo se descuenta de la factura (WS1-T4) — 2026-09-23
-- ⚠️ PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase.
--    Puede ir antes o después del deploy: sin estas columnas el código NO
--    aplica nada (la factura se crea exactamente como hoy) y en cuanto existan
--    empieza a aplicar el saldo a favor a las facturas NUEVAS.
--
-- QUÉ
-- patient_credits pasa de «suma de créditos» a LIBRO de movimientos:
--   · fila POSITIVA  = dinero a favor (anticipo MP, saldo migrado, devolución);
--   · fila NEGATIVA  = saldo aplicado a una factura (source 'aplicado_a_factura'),
--                      nacida junto al Payment «anticipo» que abona la factura.
-- El saldo a favor sigue siendo SUM(amount): las lecturas de hoy no cambian.
--
-- Este script SOLO añade columnas nulas, índices y restricciones.
--   ⛔ Ni un UPDATE, ni un DELETE, ni un backfill: las facturas y los créditos
--      que ya existen se quedan EXACTAMENTE como están.
--   · El CHECK va NOT VALID: no se comprueba contra las filas viejas, solo
--     contra las que se escriban desde ahora.
--
-- AISLAMIENTO POR CLÍNICA = Prisma-side (where clinicId), como el resto.
-- IDEMPOTENTE: IF NOT EXISTS y guardas por nombre. Re-ejecutable.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Columnas del rastro (todas NULL: las filas existentes no cambian) ──
ALTER TABLE "patient_credits" ADD COLUMN IF NOT EXISTS "invoiceId"   TEXT;
ALTER TABLE "patient_credits" ADD COLUMN IF NOT EXISTS "paymentId"   TEXT;
ALTER TABLE "patient_credits" ADD COLUMN IF NOT EXISTS "reversesId"  TEXT;
ALTER TABLE "patient_credits" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

-- ── 2. Índices ────────────────────────────────────────────────────────────
-- Un Payment abona UNA aplicación; una aplicación se devuelve UNA vez.
CREATE UNIQUE INDEX IF NOT EXISTS "patient_credits_paymentId_key"
    ON "patient_credits"("paymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "patient_credits_reversesId_key"
    ON "patient_credits"("reversesId");
CREATE INDEX IF NOT EXISTS "patient_credits_clinicId_invoiceId_idx"
    ON "patient_credits"("clinicId", "invoiceId");
-- Una factura recibe saldo a favor UNA sola vez (la segunda red, por debajo
-- de la comprobación que el servidor ya hace bajo candado).
CREATE UNIQUE INDEX IF NOT EXISTS "patient_credits_una_aplicacion_por_factura"
    ON "patient_credits"("invoiceId")
    WHERE "source" = 'aplicado_a_factura';

-- ── 3. FKs ────────────────────────────────────────────────────────────────
-- invoiceId SIN «ON DELETE»: una factura que tiene saldo a favor aplicado o
-- devuelto NO se puede borrar (el dinero del paciente quedaría sin factura a
-- la que cancelar). Solo se borran borradores, que nunca lo tienen. NO ACTION
-- (y no RESTRICT) para que el CASCADE de borrar un paciente o una clínica, que
-- se lleva facturas y créditos en la misma sentencia, siga funcionando.
-- El resto SET NULL: borrar un pago o un usuario nunca se bloquea por el rastro.
DO $saldo$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_credits_invoiceId_fkey') THEN
    ALTER TABLE "patient_credits"
      ADD CONSTRAINT "patient_credits_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
      ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_credits_paymentId_fkey') THEN
    ALTER TABLE "patient_credits"
      ADD CONSTRAINT "patient_credits_paymentId_fkey"
      FOREIGN KEY ("paymentId") REFERENCES "payments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_credits_reversesId_fkey') THEN
    ALTER TABLE "patient_credits"
      ADD CONSTRAINT "patient_credits_reversesId_fkey"
      FOREIGN KEY ("reversesId") REFERENCES "patient_credits"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_credits_createdById_fkey') THEN
    ALTER TABLE "patient_credits"
      ADD CONSTRAINT "patient_credits_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$saldo$;

-- ── 4. CHECK: solo una aplicación puede restar ──────────────────────────
-- Negativo ⇔ source 'aplicado_a_factura'. NOT VALID: las filas de antes no se
-- revisan (ni se tocan); desde ahora ninguna fila puede restar saldo a favor
-- por otro camino, ni una aplicación puede sumar.
DO $saldo$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_credits_signo_chk') THEN
    ALTER TABLE "patient_credits"
      ADD CONSTRAINT "patient_credits_signo_chk"
      CHECK (("amount" < 0) = ("source" = 'aplicado_a_factura'))
      NOT VALID;
  END IF;
END
$saldo$;
