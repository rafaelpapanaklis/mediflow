-- ═══════════════════════════════════════════════════════════════════════
-- Laboratorios dentales (marketplace B2B) — schema completo.
--
-- Equivalente idempotente de la migración Prisma
--   prisma/migrations/20260527130000_laboratorios/migration.sql
--
-- Aplicar manualmente en Supabase (SQL editor). Re-ejecutable: cada
-- bloque comprueba existencia antes de crear, así que correrlo varias
-- veces no produce errores ni duplicados.
--
-- Nota sobre $$: usamos un único delimitador `$lab$` y NUNCA bloques
-- DO anidados (el parser SQL de Supabase rompe con $$ anidado).
-- ═══════════════════════════════════════════════════════════════════════


-- ── Enums ──────────────────────────────────────────────────────────────
DO $lab$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DentalLabStatus') THEN
    CREATE TYPE "DentalLabStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DentalLabUserRole') THEN
    CREATE TYPE "DentalLabUserRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DentalLabOrderStatus') THEN
    CREATE TYPE "DentalLabOrderStatus" AS ENUM ('SOLICITADA', 'RECIBIDA', 'ATENDIENDO', 'ENVIADA', 'ENTREGADA', 'CANCELADA');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DentalLabTrafficLevel') THEN
    CREATE TYPE "DentalLabTrafficLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DentalLabTrafficSource') THEN
    CREATE TYPE "DentalLabTrafficSource" AS ENUM ('MANUAL', 'AUTO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DentalLabOrderActor') THEN
    CREATE TYPE "DentalLabOrderActor" AS ENUM ('CLINIC', 'LAB', 'SYSTEM');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DentalLabPaymentStatus') THEN
    CREATE TYPE "DentalLabPaymentStatus" AS ENUM ('UNPAID', 'PAID');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DentalLabInvoiceStatus') THEN
    CREATE TYPE "DentalLabInvoiceStatus" AS ENUM ('PAID', 'PENDING', 'OVERDUE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DentalLabChatSender') THEN
    CREATE TYPE "DentalLabChatSender" AS ENUM ('CLINIC', 'LAB');
  END IF;
END
$lab$;


-- ── Tablas ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "dental_labs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "rfc" VARCHAR(13),
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "whatsapp" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "logoUrl" TEXT,
    "coverImageUrl" TEXT,
    "description" TEXT,
    "founded" INTEGER,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hours" JSONB,
    "coverageZones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rating" DOUBLE PRECISION DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "onTimePct" INTEGER,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "status" "DentalLabStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "trafficLevel" "DentalLabTrafficLevel" NOT NULL DEFAULT 'LOW',
    "trafficManualMin" INTEGER,
    "trafficManualMax" INTEGER,
    "trafficNote" TEXT,
    "trafficUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paySpeiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payCardEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payCardStripeConnected" BOOLEAN NOT NULL DEFAULT false,
    "payCashEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payInvoiceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dental_labs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dental_lab_users" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "supabaseId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "DentalLabUserRole" NOT NULL DEFAULT 'OWNER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dental_lab_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dental_lab_services" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceFrom" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'pieza',
    "daysMin" INTEGER,
    "daysMax" INTEGER,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dental_lab_services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dental_lab_orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "serviceId" TEXT,
    "patientId" TEXT,
    "patientName" TEXT,
    "internalRef" TEXT,
    "status" "DentalLabOrderStatus" NOT NULL DEFAULT 'SOLICITADA',
    "notes" TEXT,
    "basePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "extrasTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentStatus" "DentalLabPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "paymentMethod" TEXT,
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "pickupAt" TIMESTAMP(3),
    "etaAt" TIMESTAMP(3),
    "courier" JSONB,
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dental_lab_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dental_lab_order_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "DentalLabOrderStatus" NOT NULL,
    "at" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "actorId" TEXT,
    "actorName" TEXT,
    "actorRole" "DentalLabOrderActor",
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dental_lab_order_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dental_lab_order_files" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dental_lab_order_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dental_lab_traffic_history" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "fromLevel" "DentalLabTrafficLevel",
    "toLevel" "DentalLabTrafficLevel",
    "source" "DentalLabTrafficSource" NOT NULL,
    "byUserId" TEXT,
    "byName" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dental_lab_traffic_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dental_lab_bank_accounts" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "clabe" VARCHAR(18) NOT NULL,
    "accountNumber" TEXT,
    "holderName" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dental_lab_bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dental_lab_fiscal_data" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "rfc" VARCHAR(13) NOT NULL,
    "taxRegimeCode" TEXT NOT NULL,
    "taxRegimeLabel" TEXT NOT NULL,
    "zipCode" VARCHAR(5) NOT NULL,
    "cfdiUseCode" TEXT NOT NULL,
    "cfdiUseLabel" TEXT NOT NULL,
    "state" TEXT,
    "certificateUrl" TEXT,
    "certificateValidUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dental_lab_fiscal_data_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dental_lab_invoices" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "clinicId" TEXT,
    "clinicName" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "DentalLabInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dental_lab_invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dental_lab_chat_threads" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "orderId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clinicUnread" INTEGER NOT NULL DEFAULT 0,
    "labUnread" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dental_lab_chat_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dental_lab_chat_messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "sender" "DentalLabChatSender" NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dental_lab_chat_messages_pkey" PRIMARY KEY ("id")
);


-- ── Índices ───────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "dental_labs_slug_key" ON "dental_labs"("slug");
CREATE INDEX IF NOT EXISTS "dental_labs_status_idx" ON "dental_labs"("status");

CREATE INDEX IF NOT EXISTS "dental_lab_users_supabaseId_idx" ON "dental_lab_users"("supabaseId");
CREATE UNIQUE INDEX IF NOT EXISTS "dental_lab_users_supabaseId_labId_key" ON "dental_lab_users"("supabaseId", "labId");

CREATE INDEX IF NOT EXISTS "dental_lab_services_labId_isActive_idx" ON "dental_lab_services"("labId", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "dental_lab_orders_orderNumber_key" ON "dental_lab_orders"("orderNumber");
CREATE INDEX IF NOT EXISTS "dental_lab_orders_clinicId_status_idx" ON "dental_lab_orders"("clinicId", "status");
CREATE INDEX IF NOT EXISTS "dental_lab_orders_labId_status_idx" ON "dental_lab_orders"("labId", "status");

CREATE INDEX IF NOT EXISTS "dental_lab_order_events_orderId_idx" ON "dental_lab_order_events"("orderId");

CREATE INDEX IF NOT EXISTS "dental_lab_order_files_orderId_idx" ON "dental_lab_order_files"("orderId");

CREATE INDEX IF NOT EXISTS "dental_lab_traffic_history_labId_at_idx" ON "dental_lab_traffic_history"("labId", "at" DESC);

CREATE INDEX IF NOT EXISTS "dental_lab_bank_accounts_labId_idx" ON "dental_lab_bank_accounts"("labId");

CREATE UNIQUE INDEX IF NOT EXISTS "dental_lab_fiscal_data_labId_key" ON "dental_lab_fiscal_data"("labId");

CREATE INDEX IF NOT EXISTS "dental_lab_invoices_labId_status_idx" ON "dental_lab_invoices"("labId", "status");

CREATE INDEX IF NOT EXISTS "dental_lab_chat_threads_clinicId_lastMessageAt_idx" ON "dental_lab_chat_threads"("clinicId", "lastMessageAt" DESC);
CREATE INDEX IF NOT EXISTS "dental_lab_chat_threads_labId_lastMessageAt_idx" ON "dental_lab_chat_threads"("labId", "lastMessageAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "dental_lab_chat_threads_clinicId_labId_key" ON "dental_lab_chat_threads"("clinicId", "labId");

CREATE INDEX IF NOT EXISTS "dental_lab_chat_messages_threadId_createdAt_idx" ON "dental_lab_chat_messages"("threadId", "createdAt");


-- ── Foreign keys (idempotentes vía pg_constraint) ─────────────────────
-- ADD CONSTRAINT no soporta IF NOT EXISTS, así que cada uno se envuelve
-- en un IF NOT EXISTS contra pg_constraint dentro de un único bloque DO.
DO $lab$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dental_lab_users_labId_fkey') THEN
    ALTER TABLE "dental_lab_users" ADD CONSTRAINT "dental_lab_users_labId_fkey"
      FOREIGN KEY ("labId") REFERENCES "dental_labs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dental_lab_services_labId_fkey') THEN
    ALTER TABLE "dental_lab_services" ADD CONSTRAINT "dental_lab_services_labId_fkey"
      FOREIGN KEY ("labId") REFERENCES "dental_labs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dental_lab_orders_clinicId_fkey') THEN
    ALTER TABLE "dental_lab_orders" ADD CONSTRAINT "dental_lab_orders_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dental_lab_orders_labId_fkey') THEN
    ALTER TABLE "dental_lab_orders" ADD CONSTRAINT "dental_lab_orders_labId_fkey"
      FOREIGN KEY ("labId") REFERENCES "dental_labs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dental_lab_orders_serviceId_fkey') THEN
    ALTER TABLE "dental_lab_orders" ADD CONSTRAINT "dental_lab_orders_serviceId_fkey"
      FOREIGN KEY ("serviceId") REFERENCES "dental_lab_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dental_lab_order_events_orderId_fkey') THEN
    ALTER TABLE "dental_lab_order_events" ADD CONSTRAINT "dental_lab_order_events_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "dental_lab_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dental_lab_order_files_orderId_fkey') THEN
    ALTER TABLE "dental_lab_order_files" ADD CONSTRAINT "dental_lab_order_files_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "dental_lab_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dental_lab_traffic_history_labId_fkey') THEN
    ALTER TABLE "dental_lab_traffic_history" ADD CONSTRAINT "dental_lab_traffic_history_labId_fkey"
      FOREIGN KEY ("labId") REFERENCES "dental_labs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dental_lab_bank_accounts_labId_fkey') THEN
    ALTER TABLE "dental_lab_bank_accounts" ADD CONSTRAINT "dental_lab_bank_accounts_labId_fkey"
      FOREIGN KEY ("labId") REFERENCES "dental_labs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dental_lab_fiscal_data_labId_fkey') THEN
    ALTER TABLE "dental_lab_fiscal_data" ADD CONSTRAINT "dental_lab_fiscal_data_labId_fkey"
      FOREIGN KEY ("labId") REFERENCES "dental_labs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dental_lab_invoices_labId_fkey') THEN
    ALTER TABLE "dental_lab_invoices" ADD CONSTRAINT "dental_lab_invoices_labId_fkey"
      FOREIGN KEY ("labId") REFERENCES "dental_labs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dental_lab_chat_threads_clinicId_fkey') THEN
    ALTER TABLE "dental_lab_chat_threads" ADD CONSTRAINT "dental_lab_chat_threads_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dental_lab_chat_threads_labId_fkey') THEN
    ALTER TABLE "dental_lab_chat_threads" ADD CONSTRAINT "dental_lab_chat_threads_labId_fkey"
      FOREIGN KEY ("labId") REFERENCES "dental_labs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dental_lab_chat_messages_threadId_fkey') THEN
    ALTER TABLE "dental_lab_chat_messages" ADD CONSTRAINT "dental_lab_chat_messages_threadId_fkey"
      FOREIGN KEY ("threadId") REFERENCES "dental_lab_chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$lab$;
