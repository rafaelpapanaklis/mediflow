-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — ws1-t1 · MERCADO PAGO COMO MÉTODO DE PAGO DE FACTURAS.
--
-- «Mercado Pago es un método de pago: si mandan la factura por correo o
--  WhatsApp, que le llegue el link con un mensaje y el monto; y que haya una
--  opción de ver el link de la factura.»
--
-- Cobra la CLÍNICA con la cuenta de Mercado Pago que ya conectó para los
-- anticipos (tabla "clinic_mercadopago", sql/anticipo-whatsapp.sql). Esto NO
-- vuelve a crear esa tabla: solo guarda cada link de pago de una factura.
--
-- Contenido:
--   1 tabla nueva   · invoice_payment_links
--   2 índices       · de consulta
--   3 llaves foráneas
--   2 CHECK         · solo en la tabla nueva
--   RLS deny-all en la tabla nueva
--
-- NO toca ni una fila que ya exista, ni una columna de "invoices" ni de
-- "payments". El pago que entra por el link se registra como un Payment
-- normal (method = 'mercadopago').
--
-- ORDEN: se puede aplicar antes o después de integrar la rama. Sin esta tabla
-- el código se da cuenta (P2021) y NO ofrece Mercado Pago en facturas; todo
-- lo demás funciona igual que hoy.
--
-- Requiere sql/anticipo-whatsapp.sql ya aplicado (la cuenta de la clínica).
--
-- IDEMPOTENTE: cada bloque comprueba existencia antes de crear; correrlo
-- varias veces no da errores ni duplicados. CERO DROP.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
--
-- Nota sobre $$: delimitadores con nombre ($facturamp$) y NUNCA bloques DO
-- anidados — el parser SQL de Supabase rompe con $$ anidado.
-- Nota sobre los nombres: camelCase ENTRECOMILLADO, como los escribe Prisma.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Cada link de pago de una factura ────────────────────────────────
-- El monto es el SALDO de la factura cuando se creó el link: lo decide el
-- servidor, nunca el navegador. Si el saldo cambia, se hace otro link y el
-- viejo queda REPLACED.
CREATE TABLE IF NOT EXISTS "invoice_payment_links" (
  "id"                 TEXT NOT NULL,
  "clinicId"           TEXT NOT NULL,
  "invoiceId"          TEXT NOT NULL,
  "amount"             DOUBLE PRECISION NOT NULL,
  "status"             TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt"          TIMESTAMPTZ(6) NOT NULL,
  "mpPreferenceId"     TEXT,
  "checkoutUrl"        TEXT,
  "mpCollectorId"      TEXT,
  "mpPaymentId"        TEXT,
  "paidAmount"         DOUBLE PRECISION,
  "paidAt"             TIMESTAMPTZ(6),
  "lastMpStatus"       TEXT,
  "lastMpStatusDetail" TEXT,
  "createdById"        TEXT,
  "createdAt"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_payment_links_pkey" PRIMARY KEY ("id")
);


-- ── 2. Índices ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "invoice_payment_links_clinicId_createdAt_idx"
  ON "invoice_payment_links" ("clinicId", "createdAt");
-- La del botón «ver link»: «el link PENDING de esta factura».
CREATE INDEX IF NOT EXISTS "invoice_payment_links_invoiceId_status_idx"
  ON "invoice_payment_links" ("invoiceId", "status");


-- ── 3. Llaves foráneas ─────────────────────────────────────────────────
-- CASCADE en clínica y factura (igual que "payments"). SET NULL en quien lo
-- creó: si se borra el usuario, el rastro se queda.
DO $facturamp$
BEGIN
  ALTER TABLE "invoice_payment_links"
    ADD CONSTRAINT "invoice_payment_links_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$facturamp$;

DO $facturamp$
BEGIN
  ALTER TABLE "invoice_payment_links"
    ADD CONSTRAINT "invoice_payment_links_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$facturamp$;

DO $facturamp$
BEGIN
  ALTER TABLE "invoice_payment_links"
    ADD CONSTRAINT "invoice_payment_links_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$facturamp$;


-- ── 4. CHECK: lo que la base NO deja escribir ──────────────────────────
DO $facturamp$
BEGIN
  ALTER TABLE "invoice_payment_links" ADD CONSTRAINT "invoice_payment_links_status_chk"
    CHECK ("status" IN ('PENDING', 'PAID', 'REPLACED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END
$facturamp$;

DO $facturamp$
BEGIN
  ALTER TABLE "invoice_payment_links" ADD CONSTRAINT "invoice_payment_links_amount_chk"
    CHECK ("amount" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END
$facturamp$;


-- ── 5. RLS deny-all (patrón sql/rls-deny-all-policies.sql) ─────────────
-- DaleControl lee solo por Prisma + service role, que no pasa por RLS.
DO $facturamp$
DECLARE
  t    text;
  tbls text[] := ARRAY['invoice_payment_links'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        t || '_deny_anon', t
      );
    END IF;
  END LOOP;
END
$facturamp$;


-- ── 6. Comprobación (solo lee) ─────────────────────────────────────────
-- Debe devolver 1 fila con la tabla y rls = true.
SELECT c.relname AS tabla, c.relrowsecurity AS rls
FROM pg_class c
WHERE c.relname = 'invoice_payment_links';
