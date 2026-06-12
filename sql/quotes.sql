-- ═══════════════════════════════════════════════════════════════════
-- Presupuestos / cotizaciones genéricas para el paciente (WS1-T1, 2026-06-11)
-- Tablas quotes ⇄ Quote y quote_items ⇄ QuoteItem (al final de
-- prisma/schema.prisma).
--
-- IDEMPOTENTE: CREATE ... IF NOT EXISTS + ADD COLUMN IF NOT EXISTS + bloques DO
-- con guardas. Seguro de re-correr. Delimitadores $qt$ (NUNCA $$ pelado — el
-- editor de Supabase rompe el parser con $$).
--
-- Aplicar a mano en Supabase. NO prisma migrate. Hasta aplicarlo, cualquier
-- ruta que toque prisma.quote / prisma.quoteItem revienta en runtime (la
-- pestaña Presupuestos del expediente, /api/quotes*, /presupuesto/[token]).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Tabla quotes. Columnas en camelCase entre comillas: Prisma mapea el nombre
--    del campo tal cual (sin @map) → la columna DEBE llamarse igual.
CREATE TABLE IF NOT EXISTS "quotes" (
  "id"              TEXT NOT NULL,
  "clinicId"        TEXT NOT NULL,
  "patientId"       TEXT NOT NULL,
  "createdById"     TEXT,
  "folio"           TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'DRAFT',
  "validUntil"      TIMESTAMP(3),
  "subtotal"        DECIMAL(10,2) NOT NULL DEFAULT 0,
  "discountPct"     DECIMAL(5,2),
  "discountAmount"  DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total"           DECIMAL(10,2) NOT NULL DEFAULT 0,
  "notes"           TEXT,
  "acceptToken"     TEXT,
  "presentedAt"     TIMESTAMP(3),
  "acceptedAt"      TIMESTAMP(3),
  "rejectedAt"      TIMESTAMP(3),
  "signatureUrl"    TEXT,
  "invoiceId"       TEXT,
  "treatmentPlanId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- Por si la tabla ya existía de una versión previa: columnas idempotentes.
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "discountPct"     DECIMAL(5,2);
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "acceptToken"     TEXT;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "signatureUrl"    TEXT;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "invoiceId"       TEXT;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "treatmentPlanId" TEXT;

-- 2) Únicos: folio por clínica; token de aceptación de un solo presupuesto.
--    El índice único sobre acceptToken tolera múltiples NULL (drafts sin liga).
CREATE UNIQUE INDEX IF NOT EXISTS "quotes_clinicId_folio_key"  ON "quotes" ("clinicId", "folio");
CREATE UNIQUE INDEX IF NOT EXISTS "quotes_acceptToken_key"     ON "quotes" ("acceptToken");

-- 3) Índices de consulta (lista por paciente, filtros por estado).
CREATE INDEX IF NOT EXISTS "quotes_clinicId_patientId_status_idx" ON "quotes" ("clinicId", "patientId", "status");
CREATE INDEX IF NOT EXISTS "quotes_clinicId_status_idx"           ON "quotes" ("clinicId", "status");
CREATE INDEX IF NOT EXISTS "quotes_patientId_idx"                 ON "quotes" ("patientId");

-- 4) Tabla quote_items.
CREATE TABLE IF NOT EXISTS "quote_items" (
  "id"          TEXT NOT NULL,
  "quoteId"     TEXT NOT NULL,
  "procedureId" TEXT,
  "name"        TEXT NOT NULL,
  "toothFdi"    TEXT,
  "quantity"    INTEGER NOT NULL DEFAULT 1,
  "unitPrice"   DECIMAL(10,2) NOT NULL,
  "discount"    DECIMAL(10,2) NOT NULL DEFAULT 0,
  "lineTotal"   DECIMAL(10,2) NOT NULL,
  "phase"       INTEGER,
  "notes"       TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "quote_items_quoteId_idx" ON "quote_items" ("quoteId");

-- 5) Llaves foráneas (idempotentes).
--    quotes.clinicId/patientId → CASCADE; createdById → SET NULL.
--    quote_items.quoteId → CASCADE; procedureId → SET NULL.
DO $qt$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_clinicId_fkey') THEN
    ALTER TABLE "quotes"
      ADD CONSTRAINT "quotes_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_patientId_fkey') THEN
    ALTER TABLE "quotes"
      ADD CONSTRAINT "quotes_patientId_fkey"
      FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_createdById_fkey') THEN
    ALTER TABLE "quotes"
      ADD CONSTRAINT "quotes_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_items_quoteId_fkey') THEN
    ALTER TABLE "quote_items"
      ADD CONSTRAINT "quote_items_quoteId_fkey"
      FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_items_procedureId_fkey') THEN
    ALTER TABLE "quote_items"
      ADD CONSTRAINT "quote_items_procedureId_fkey"
      FOREIGN KEY ("procedureId") REFERENCES "procedure_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla referenciada inexistente — FKs saltadas (deploy parcial)';
END
$qt$;

-- 6) Defense-in-depth: RLS deny-all para anon y authenticated (patrón
--    sql/rls-deny-all-policies.sql). DaleControl accede solo vía Prisma +
--    service role (bypassa RLS). Esto cierra PostgREST si se filtra el anon key.
DO $qt$
BEGIN
  EXECUTE 'ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'quotes' AND policyname = 'quotes_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "quotes_deny_anon" ON "quotes" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;

  EXECUTE 'ALTER TABLE "quote_items" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'quote_items' AND policyname = 'quote_items_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "quote_items_deny_anon" ON "quote_items" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'quotes / quote_items no existe — RLS saltada';
END
$qt$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación:
--   SELECT policyname FROM pg_policies WHERE tablename IN ('quotes','quote_items');
--   \d quotes
--   \d quote_items
-- ═══════════════════════════════════════════════════════════════════
