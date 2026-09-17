-- ═══════════════════════════════════════════════════════════════════
-- FACTURACIÓN · CONDICIONES DE PAGO (ws1-t1)
-- Tabla invoice_payment_terms — una fila por factura, o ninguna.
-- Lector/escritor: src/lib/invoices/condiciones-pago-db.ts
-- Aritmética:      src/lib/quotes/condiciones-pago.ts (la MISMA de Presupuestos)
--
-- Se corre en Supabase (SQL Editor). Lo aplica Rafael, nunca una terminal.
--     https://supabase.com/dashboard/project/_/sql/new
--
-- SIN ESTE SQL NO SE ROMPE NADA, PERO TAMPOCO SE GUARDA EL TRATO. El lector
-- pregunta primero si la tabla existe (to_regclass, que no falla). Si no
-- está: la factura se crea, se cobra y se timbra exactamente igual que hoy;
-- lo único que pasa es que «un pago / a plazos» no se guarda, y el popup de
-- Nueva factura LO DICE con todas las letras en vez de callarse.
--
-- Es una ANOTACIÓN del trato, no dinero: no toca "invoices", ni "payments",
-- ni "payment_plans". Nada de cobro, reembolso, timbrado o cancelación lee
-- esta tabla.
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No lee, no borra y no
-- modifica datos de ninguna otra tabla.
-- Columnas camelCase entrecomilladas (mismo estilo que el resto del repo).
-- SIN bloques DO $$ … $$: todo plano, sentencia por sentencia.
-- ═══════════════════════════════════════════════════════════════════

-- 1) La tabla. Cuelga de "invoices" con ON DELETE CASCADE: si se elimina un
--    borrador, sus condiciones se van con él. La FK va DENTRO del CREATE
--    TABLE para no necesitar un ALTER … ADD CONSTRAINT, que no es idempotente.
--
--    No lleva "clinicId": el inquilino se resuelve contra "invoices" en cada
--    lectura y en cada escritura (condiciones-pago-db.ts).
CREATE TABLE IF NOT EXISTS "invoice_payment_terms" (
  -- Una factura, unas condiciones. La PK es la propia FK.
  "invoiceId"         text         NOT NULL,
  -- 'unico' | 'plazos'
  "modo"              text         NOT NULL DEFAULT 'unico',
  -- Uno de los SEIS del selector de cobros:
  -- cash | debit | credit | transfer | check | other. NULL = sin elegir.
  "metodo"            text,
  -- Enganche en pesos (primer pago mayor). 0 = sin enganche.
  "enganche"          numeric(10,2) NOT NULL DEFAULT 0,
  -- Cuántas mensualidades DESPUÉS del enganche. 0 cuando modo = 'unico'.
  "numPagos"          integer      NOT NULL DEFAULT 0,
  -- 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' (mismas palabras que payment_plans).
  "frecuencia"        text         NOT NULL DEFAULT 'MONTHLY',
  -- Fecha del primer pago. `date`, sin hora: un vencimiento no tiene huso.
  "primerPago"        date,
  -- El paciente difiere el cargo a meses con SU banco (MSI de la terminal).
  -- Es una ANOTACIÓN, no un cálculo: la clínica cobra el total de una vez.
  "difiereConSuBanco" boolean      NOT NULL DEFAULT false,
  "createdAt"         timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_payment_terms_pkey" PRIMARY KEY ("invoiceId"),
  CONSTRAINT "invoice_payment_terms_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- 2) Defense-in-depth: RLS deny-all para anon y authenticated, igual que el
--    resto de tablas nuevas (sql/rls-deny-all-policies.sql). DaleControl lee
--    solo vía Prisma con service role, que bypassa RLS.
ALTER TABLE "invoice_payment_terms" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_payment_terms_deny_anon" ON "invoice_payment_terms";

CREATE POLICY "invoice_payment_terms_deny_anon" ON "invoice_payment_terms"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- 3) Comprobación. Debe devolver una fila con existe = true y 0 condiciones.
SELECT to_regclass('public.invoice_payment_terms') IS NOT NULL AS existe,
       (SELECT count(*) FROM "invoice_payment_terms")          AS condiciones_guardadas,
       (SELECT count(*) FROM "invoices")                       AS facturas;
