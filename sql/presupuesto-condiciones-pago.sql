-- ═══════════════════════════════════════════════════════════════════
-- PRESUPUESTOS · CONDICIONES DE PAGO (WS1-T8)
-- Tabla quote_payment_terms — una fila por presupuesto, o ninguna.
-- Lector/escritor: src/lib/quotes/condiciones-pago-db.ts
-- Aritmética:      src/lib/quotes/condiciones-pago.ts
--
-- Se corre en Supabase (SQL Editor). Lo aplica Rafael, nunca una terminal.
--     https://supabase.com/dashboard/project/_/sql/new
--
-- SIN ESTE SQL NO SE ROMPE NADA. El lector pregunta primero si la tabla
-- existe (to_regclass, que no falla) y, si no está, devuelve "sin
-- condiciones": el presupuesto se crea, se edita, se factura y se imprime
-- exactamente igual que hoy, solo que sin la sección de formas de pago.
-- Por eso la tabla es NUEVA y no añade ni una columna a "quotes": la
-- pantalla de Presupuestos no depende de que esto esté aplicado.
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No lee, no borra y no
-- modifica datos de ninguna otra tabla.
-- Columnas camelCase entrecomilladas (mismo estilo que el resto del repo).
-- SIN bloques DO $$ … $$: todo plano, sentencia por sentencia.
-- ═══════════════════════════════════════════════════════════════════

-- 1) La tabla. Cuelga de "quotes" con ON DELETE CASCADE: si se borra un
--    presupuesto en borrador, sus condiciones se van con él y no queda
--    basura huérfana. La FK va DENTRO del CREATE TABLE justamente para no
--    necesitar un ALTER … ADD CONSTRAINT, que no es idempotente.
--
--    No lleva "clinicId": el inquilino se resuelve contra "quotes" en cada
--    lectura y en cada escritura (condiciones-pago-db.ts comprueba que el
--    presupuesto sea de la clínica de la sesión antes de escribir).
CREATE TABLE IF NOT EXISTS "quote_payment_terms" (
  -- Un presupuesto, unas condiciones. La PK es la propia FK.
  "quoteId"           text         NOT NULL,
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
  CONSTRAINT "quote_payment_terms_pkey" PRIMARY KEY ("quoteId"),
  CONSTRAINT "quote_payment_terms_quoteId_fkey"
    FOREIGN KEY ("quoteId") REFERENCES "quotes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- 2) Defense-in-depth: RLS deny-all para anon y authenticated, igual que el
--    resto de tablas nuevas (sql/rls-deny-all-policies.sql). DaleControl lee
--    solo vía Prisma con service role, que bypassa RLS.
--    ENABLE es idempotente; la política se recrea (DROP IF EXISTS + CREATE)
--    porque CREATE POLICY no admite IF NOT EXISTS.
ALTER TABLE "quote_payment_terms" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quote_payment_terms_deny_anon" ON "quote_payment_terms";

CREATE POLICY "quote_payment_terms_deny_anon" ON "quote_payment_terms"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- 3) Comprobación. Debe devolver una fila con existe = true y 0 condiciones
--    (la tabla nace vacía; las filas las escribe el panel al guardar un
--    presupuesto con formas de pago).
SELECT to_regclass('public.quote_payment_terms') IS NOT NULL AS existe,
       (SELECT count(*) FROM "quote_payment_terms")          AS condiciones_guardadas,
       (SELECT count(*) FROM "quotes")                       AS presupuestos;

-- ═══════════════════════════════════════════════════════════════════
-- A mano, cuando haga falta:
--
--   Ver las condiciones de un presupuesto por folio:
--     SELECT q."folio", t.*
--       FROM "quote_payment_terms" t
--       JOIN "quotes" q ON q."id" = t."quoteId"
--      WHERE q."folio" = 'P-0001';
--
--   Quitarle las condiciones a un presupuesto (vuelve a verse como antes):
--     DELETE FROM "quote_payment_terms"
--      WHERE "quoteId" = (SELECT "id" FROM "quotes" WHERE "folio" = 'P-0001');
--
--   Deshacer del todo (la pantalla sigue funcionando, sin formas de pago):
--     DROP TABLE IF EXISTS "quote_payment_terms";
-- ═══════════════════════════════════════════════════════════════════
