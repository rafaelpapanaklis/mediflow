-- ═══════════════════════════════════════════════════════════════════
-- SPEI POR TRANSFERENCIA DIRECTA (pantalla de pago /dashboard/suspended)
-- Tablas platform_bank_accounts y spei_transfer_requests
--   ⇄ modelos Prisma PlatformBankAccount y SpeiTransferRequest
-- Lector/escritor: src/lib/billing/spei-directo.ts
--
-- Se corre en Supabase (SQL Editor). Lo aplica Rafael, nunca una terminal.
--
-- ORDEN RESPECTO AL DEPLOY: se puede pegar ANTES o DESPUÉS. Sin estas tablas
-- nada se rompe: el código trata «no existe» como «no hay cuenta configurada»
-- y la pantalla de pago simplemente NO ofrece SPEI. Después de pegarlo, entra a
-- /admin/settings → Datos banco y captura banco, beneficiario y CLABE: hasta
-- entonces SPEI sigue sin ofrecerse. No hay datos bancarios en este archivo.
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No toca ninguna tabla existente
-- (ni clinics ni subscription_invoices) y no borra nada. SQL plano, sin bloques
-- DO. Columnas camelCase entrecomilladas (espejo exacto de Prisma; sin @map).
-- ═══════════════════════════════════════════════════════════════════

-- 1) La cuenta de la plataforma. Una sola fila: id = 'spei'.
CREATE TABLE IF NOT EXISTS "platform_bank_accounts" (
  "id"           text         NOT NULL,
  "banco"        text         NOT NULL,
  "beneficiario" text         NOT NULL,
  "clabe"        text         NOT NULL,
  "updatedBy"    text,
  "updatedAt"    timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- 2) Transferencias que las clínicas declaran haber hecho. La FK va inline: si
--    se borra la clínica, sus solicitudes se van con ella.
CREATE TABLE IF NOT EXISTS "spei_transfer_requests" (
  "id"            text         NOT NULL,
  "clinicId"      text         NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "requestedBy"   text,
  "plan"          text         NOT NULL,
  "billing"       text         NOT NULL,
  "subtotalCents" integer      NOT NULL,
  "ivaCents"      integer      NOT NULL,
  "amountCents"   integer      NOT NULL,
  "reference"     text         NOT NULL,
  "status"        text         NOT NULL DEFAULT 'pending',
  "bankSnapshot"  jsonb        NOT NULL,
  "createdAt"     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"    timestamp(3),
  "resolvedBy"    text,
  "rejectReason"  text,
  "invoiceId"     text,
  CONSTRAINT "spei_transfer_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "spei_transfer_requests_status_check" CHECK ("status" IN ('pending', 'confirmed', 'rejected')),
  CONSTRAINT "spei_transfer_requests_billing_check" CHECK ("billing" IN ('monthly', 'annual'))
);

-- La referencia es el folio ESTABLE de la clínica (el mismo en cada pago), por
-- eso no es única: solo se indexa para buscarla.
CREATE INDEX IF NOT EXISTS "spei_transfer_requests_reference_idx"
  ON "spei_transfer_requests" ("reference");

-- Una sola pendiente por clínica: el doble clic o una segunda pestaña no
-- pueden crear dos (el código devuelve la que ya existe).
CREATE UNIQUE INDEX IF NOT EXISTS "spei_transfer_requests_una_pendiente_por_clinica"
  ON "spei_transfer_requests" ("clinicId") WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "spei_transfer_requests_status_createdAt_idx"
  ON "spei_transfer_requests" ("status", "createdAt");

CREATE INDEX IF NOT EXISTS "spei_transfer_requests_clinicId_createdAt_idx"
  ON "spei_transfer_requests" ("clinicId", "createdAt");

-- 3) Defense-in-depth: RLS activada y SIN políticas = anon y authenticated no
--    ven nada. DaleControl lee solo vía Prisma + service role (bypassa RLS).
--    (ENABLE es idempotente.)
ALTER TABLE "platform_bank_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spei_transfer_requests" ENABLE ROW LEVEL SECURITY;

-- Verificación (opcional): debe devolver las dos tablas.
-- SELECT table_name FROM information_schema.tables
--  WHERE table_name IN ('platform_bank_accounts', 'spei_transfer_requests');
