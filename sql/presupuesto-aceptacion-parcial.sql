-- ═══════════════════════════════════════════════════════════════════
-- PRESUPUESTOS · ACEPTACIÓN PARCIAL Y CARGOS (ws1-t6, ticket 3, 7c y 7d)
-- Tablas: quote_item_acceptance (qué conceptos aceptó el paciente y a qué
--         precio) y quote_charges (qué factura cargó qué concepto o abono).
-- Lector/escritor: src/lib/quotes/aceptacion-db.ts
-- Reglas (puras):  src/lib/quotes/aceptacion.ts
--
-- Se corre en Supabase (SQL Editor). Lo aplica Rafael, nunca una terminal.
--
-- SIN ESTE SQL NO SE ROMPE NADA. El código pregunta antes si las tablas
-- existen (to_regclass, que no falla). Mientras no estén, Presupuestos
-- funciona exactamente como hoy: «Marcar aceptado» acepta todo y
-- «Generar factura» crea UNA factura por el total. Con el SQL aplicado
-- se encienden las casillas por concepto (panel y liga pública) y la
-- revisión «Se cobrará hoy».
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No modifica ninguna tabla
-- existente ni sus datos. Sin bloques DO $$ … $$.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Qué aceptó el paciente, concepto por concepto, con la COPIA del
--    precio que firmó (nombre, cantidad, precio, descuento e importe). Un
--    renglón por concepto del presupuesto, aceptado o no: así queda dicho
--    también lo que NO aceptó. Sin filas = presupuesto aceptado antes de
--    esta función: se trata como aceptado completo, igual que hoy.
CREATE TABLE IF NOT EXISTS "quote_item_acceptance" (
  "quoteItemId"  text          NOT NULL,
  "quoteId"      text          NOT NULL,
  "clinicId"     text          NOT NULL,
  "aceptado"     boolean       NOT NULL,
  "nombre"       text          NOT NULL,
  "toothFdi"     text,
  "cantidad"     integer       NOT NULL DEFAULT 1,
  "precio"       numeric(10,2) NOT NULL DEFAULT 0,
  "descuento"    numeric(10,2) NOT NULL DEFAULT 0,
  "importe"      numeric(10,2) NOT NULL DEFAULT 0,
  -- Parte del descuento GLOBAL del presupuesto que le toca a este
  -- concepto (reparto proporcional en centavos). 0 si no lo aceptó.
  "descuentoGlobal" numeric(10,2) NOT NULL DEFAULT 0,
  -- 'panel' (recepción lo marcó) | 'liga' (lo firmó el paciente)
  "via"          text          NOT NULL DEFAULT 'panel',
  "aceptadoPorId" text,
  "createdAt"    timestamp(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_item_acceptance_pkey" PRIMARY KEY ("quoteItemId"),
  CONSTRAINT "quote_item_acceptance_quoteItemId_fkey"
    FOREIGN KEY ("quoteItemId") REFERENCES "quote_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quote_item_acceptance_quoteId_fkey"
    FOREIGN KEY ("quoteId") REFERENCES "quotes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "quote_item_acceptance_quoteId_idx"
  ON "quote_item_acceptance" ("quoteId");

-- 2) Cargos: el enlace presupuesto ↔ facturas. Cada factura generada desde
--    el presupuesto deja una fila por concepto que carga ("quoteItemId") o
--    una fila de abono ("quoteItemId" NULL: pago inicial pactado o cuota).
--    Si la factura se borra (un borrador), sus filas se van con ella; si se
--    CANCELA, el código deja de contarla y el concepto vuelve a «por cargar».
CREATE TABLE IF NOT EXISTS "quote_charges" (
  "id"           text          NOT NULL,
  "clinicId"     text          NOT NULL,
  "quoteId"      text          NOT NULL,
  "quoteItemId"  text,
  "invoiceId"    text          NOT NULL,
  -- 'concepto' | 'abono'
  "tipo"         text          NOT NULL,
  -- Lo que esta fila suma a la factura (neto, con su parte de descuento).
  "monto"        numeric(10,2) NOT NULL,
  "createdById"  text,
  "createdAt"    timestamp(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_charges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quote_charges_quoteId_fkey"
    FOREIGN KEY ("quoteId") REFERENCES "quotes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quote_charges_quoteItemId_fkey"
    FOREIGN KEY ("quoteItemId") REFERENCES "quote_items"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "quote_charges_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "quote_charges_quoteId_idx"   ON "quote_charges" ("quoteId");
CREATE INDEX IF NOT EXISTS "quote_charges_invoiceId_idx" ON "quote_charges" ("invoiceId");

-- 3) RLS deny-all para anon y authenticated, como el resto de tablas nuevas.
--    DaleControl lee solo vía Prisma con service role, que bypassa RLS.
ALTER TABLE "quote_item_acceptance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_charges"         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quote_item_acceptance_deny_anon" ON "quote_item_acceptance";
CREATE POLICY "quote_item_acceptance_deny_anon" ON "quote_item_acceptance"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "quote_charges_deny_anon" ON "quote_charges";
CREATE POLICY "quote_charges_deny_anon" ON "quote_charges"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- 4) Comprobación: dos filas con existe = true y 0 registros.
SELECT 'quote_item_acceptance' AS tabla,
       to_regclass('public.quote_item_acceptance') IS NOT NULL AS existe,
       (SELECT count(*) FROM "quote_item_acceptance") AS filas
UNION ALL
SELECT 'quote_charges',
       to_regclass('public.quote_charges') IS NOT NULL,
       (SELECT count(*) FROM "quote_charges");

-- ═══════════════════════════════════════════════════════════════════
-- A mano, cuando haga falta:
--
--   Qué aceptó un presupuesto y qué se ha cargado:
--     SELECT a."nombre", a."aceptado", a."importe", a."descuentoGlobal",
--            c."monto", i."invoiceNumber", i."status"
--       FROM "quote_item_acceptance" a
--       JOIN "quotes" q ON q."id" = a."quoteId"
--       LEFT JOIN "quote_charges" c ON c."quoteItemId" = a."quoteItemId"
--       LEFT JOIN "invoices" i ON i."id" = c."invoiceId"
--      WHERE q."folio" = 'P-0001' AND q."clinicId" = '<clinicId>';
--
--   Deshacer del todo (Presupuestos vuelve a aceptar y facturar todo junto;
--   las facturas ya creadas NO se tocan):
--     DROP TABLE IF EXISTS "quote_charges";
--     DROP TABLE IF EXISTS "quote_item_acceptance";
-- ═══════════════════════════════════════════════════════════════════
