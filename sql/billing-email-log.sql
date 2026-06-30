-- ═══════════════════════════════════════════════════════════════════
-- Correos de ciclo de vida del plan — tabla de idempotencia
--
-- ⚠️  CORRER EN SUPABASE (SQL Editor) ANTES / AL MOMENTO DEL DEPLOY.
--     Espeja prisma/schema.prisma (model BillingEmailLog → "billing_email_logs").
--     Si NO se corre, el webhook NO rompe (el INSERT se captura y se omite el
--     correo), pero NO se enviarán los correos "plan activado" / "plan renovado".
--
--     https://supabase.com/dashboard/project/_/sql/new
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica datos.
--
-- Qué hace: registra UNA fila por factura de Stripe que disparó un correo de
-- billing. La unicidad de "invoiceId" es el candado anti-duplicado: Stripe
-- emite invoice.paid + invoice.payment_succeeded para la MISMA factura y el
-- case del webhook corre dos veces; solo el primer INSERT gana y envía.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "billing_email_logs" (
  "id"        text         NOT NULL,
  "invoiceId" text         NOT NULL,
  "clinicId"  text         NOT NULL,
  "kind"      text         NOT NULL, -- "plan_activated" | "plan_renewed"
  "email"     text         NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_email_logs_pkey" PRIMARY KEY ("id")
);

-- Candado de idempotencia: UNA fila por factura (Prisma: invoiceId @unique).
CREATE UNIQUE INDEX IF NOT EXISTS "billing_email_logs_invoiceId_key"
  ON "billing_email_logs" ("invoiceId");

-- Lookups operativos por clínica (debug/soporte). Barato y opcional.
CREATE INDEX IF NOT EXISTS "billing_email_logs_clinicId_idx"
  ON "billing_email_logs" ("clinicId");

-- RLS deny-all (defense-in-depth). Prisma usa el service role y bypassa RLS;
-- el cliente nunca toca esta tabla. Sigue sql/rls-deny-all-policies.sql /
-- sql/affiliates.sql.
DO $$ BEGIN
  ALTER TABLE "billing_email_logs" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'billing_email_logs'
      AND policyname = 'billing_email_logs_deny_anon'
  ) THEN
    CREATE POLICY "billing_email_logs_deny_anon" ON "billing_email_logs"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- Verificación:
-- SELECT "invoiceId", "clinicId", "kind", "email", "createdAt"
--   FROM "billing_email_logs" ORDER BY "createdAt" DESC LIMIT 20;
