-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — schema completo del vertical (producto separado).
--
-- Equivalente idempotente de la migración Prisma
--   prisma/migrations/20260824120000_barber_foundation/migration.sql
--
-- Aplicar manualmente en Supabase (SQL editor). Re-ejecutable: cada
-- bloque comprueba existencia antes de crear, así que correrlo varias
-- veces no produce errores ni duplicados.
--
-- Nota sobre $$: usamos un único delimitador `$barber$` y NUNCA bloques
-- DO anidados (el parser SQL de Supabase rompe con $$ anidado).
-- ═══════════════════════════════════════════════════════════════════════


-- ── Enums ──────────────────────────────────────────────────────────────
DO $barber$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberPlan') THEN
    CREATE TYPE "BarberPlan" AS ENUM ('BASICO', 'AVANZADO', 'PROFESIONAL');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberWhatsappSender') THEN
    CREATE TYPE "BarberWhatsappSender" AS ENUM ('PLATFORM', 'OWN_WABA');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberRole') THEN
    CREATE TYPE "BarberRole" AS ENUM ('OWNER', 'MANAGER', 'BARBER', 'RECEPTION');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberCommissionType') THEN
    CREATE TYPE "BarberCommissionType" AS ENUM ('COMMISSION', 'CHAIR_RENT', 'SALARY');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberAppointmentStatus') THEN
    CREATE TYPE "BarberAppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'DONE', 'NO_SHOW', 'CANCELLED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberAppointmentSource') THEN
    CREATE TYPE "BarberAppointmentSource" AS ENUM ('PANEL', 'PUBLIC', 'WALKIN', 'WHATSAPP');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberDepositStatus') THEN
    CREATE TYPE "BarberDepositStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'FORFEITED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberWalkInStatus') THEN
    CREATE TYPE "BarberWalkInStatus" AS ENUM ('WAITING', 'CALLED', 'SERVED', 'LEFT');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberClientMembershipStatus') THEN
    CREATE TYPE "BarberClientMembershipStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberPaymentMethod') THEN
    CREATE TYPE "BarberPaymentMethod" AS ENUM ('CASH', 'CARD', 'SPEI', 'STRIPE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberMessageDirection') THEN
    CREATE TYPE "BarberMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberMessageStatus') THEN
    CREATE TYPE "BarberMessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');
  END IF;
END
$barber$;


-- ── Tablas ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "barber_shops" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "locale" TEXT NOT NULL DEFAULT 'es',
    "logoUrl" TEXT,
    "teamSize" TEXT,
    "plan" "BarberPlan" NOT NULL DEFAULT 'BASICO',
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'pending_payment',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "whatsappSenderMode" "BarberWhatsappSender" NOT NULL DEFAULT 'PLATFORM',
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "whatsappToken" TEXT,
    "whatsappVerifiedAt" TIMESTAMP(3),
    "messagesUsedPeriod" INTEGER NOT NULL DEFAULT 0,
    "messagesPeriodStart" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_shops_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_users" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "supabaseId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "BarberRole" NOT NULL DEFAULT 'OWNER',
    "barberId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "permissionsOverride" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_barbers" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nickname" TEXT,
    "photoUrl" TEXT,
    "bio" TEXT,
    "commissionType" "BarberCommissionType" NOT NULL DEFAULT 'COMMISSION',
    "commissionPct" DECIMAL(5,2),
    "chairRent" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_barbers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_clients" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "birthday" TIMESTAMP(3),
    "notes" TEXT,
    "preferences" JSONB,
    "photoUrl" TEXT,
    "loyaltyCount" INTEGER NOT NULL DEFAULT 0,
    "totalVisits" INTEGER NOT NULL DEFAULT 0,
    "lastVisitAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_services" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMin" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_appointments" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "clientId" TEXT,
    "clientName" TEXT,
    "clientPhone" TEXT,
    "barberId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "BarberAppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "source" "BarberAppointmentSource" NOT NULL DEFAULT 'PANEL',
    "depositAmount" DECIMAL(10,2),
    "depositStatus" "BarberDepositStatus",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_appointments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_appointment_services" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "priceAtBooking" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "barber_appointment_services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_walkins" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "phone" TEXT,
    "barberId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calledAt" TIMESTAMP(3),
    "servedAt" TIMESTAMP(3),
    "status" "BarberWalkInStatus" NOT NULL DEFAULT 'WAITING',
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_walkins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_memberships" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "includedCuts" INTEGER,
    "periodDays" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_client_memberships" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "status" "BarberClientMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3) NOT NULL,
    "cutsUsed" INTEGER NOT NULL DEFAULT 0,
    "paymentMethod" "BarberPaymentMethod" NOT NULL DEFAULT 'CASH',
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_client_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_sales" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "clientId" TEXT,
    "barberId" TEXT,
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tip" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paymentMethod" "BarberPaymentMethod" NOT NULL DEFAULT 'CASH',
    "cashSessionId" TEXT,
    "soldByUserId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_sales_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_sale_items" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "serviceId" TEXT,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "barber_sale_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_products" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "cost" DECIMAL(10,2),
    "stock" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_cash_sessions" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "countedAmount" DECIMAL(10,2),
    "expectedAmount" DECIMAL(10,2),
    "notes" TEXT,
    "openedByUserId" TEXT NOT NULL,
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_cash_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_commission_entries" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "barberId" TEXT NOT NULL,
    "saleId" TEXT,
    "appointmentId" TEXT,
    "base" DECIMAL(10,2) NOT NULL,
    "pct" DECIMAL(5,2),
    "amount" DECIMAL(10,2) NOT NULL,
    "periodKey" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "barber_commission_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_messages" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "direction" "BarberMessageDirection" NOT NULL,
    "waMessageId" TEXT,
    "phone" TEXT NOT NULL,
    "body" TEXT,
    "templateName" TEXT,
    "status" "BarberMessageStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "clientId" TEXT,
    "appointmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "barber_plan_configs" (
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthly" DECIMAL(10,2) NOT NULL,
    "priceYearly" DECIMAL(10,2),
    "firstMonthPrice" DECIMAL(10,2),
    "maxBarbers" INTEGER NOT NULL DEFAULT 1,
    "maxBranches" INTEGER NOT NULL DEFAULT 1,
    "messageQuota" INTEGER NOT NULL DEFAULT 200,
    "features" JSONB NOT NULL,
    "stripePriceIdMonthly" TEXT,
    "stripePriceIdYearly" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_plan_configs_pkey" PRIMARY KEY ("planId")
);


-- ── Índices ───────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "barber_shops_slug_key" ON "barber_shops"("slug");
CREATE INDEX IF NOT EXISTS "barber_shops_parentId_idx" ON "barber_shops"("parentId");
CREATE INDEX IF NOT EXISTS "barber_users_supabaseId_idx" ON "barber_users"("supabaseId");
CREATE INDEX IF NOT EXISTS "barber_users_barbershopId_idx" ON "barber_users"("barbershopId");
CREATE UNIQUE INDEX IF NOT EXISTS "barber_users_supabaseId_barbershopId_key" ON "barber_users"("supabaseId", "barbershopId");
CREATE INDEX IF NOT EXISTS "barber_barbers_barbershopId_isActive_idx" ON "barber_barbers"("barbershopId", "isActive");
CREATE INDEX IF NOT EXISTS "barber_clients_barbershopId_phone_idx" ON "barber_clients"("barbershopId", "phone");
CREATE INDEX IF NOT EXISTS "barber_clients_barbershopId_name_idx" ON "barber_clients"("barbershopId", "name");
CREATE INDEX IF NOT EXISTS "barber_services_barbershopId_isActive_idx" ON "barber_services"("barbershopId", "isActive");
CREATE INDEX IF NOT EXISTS "barber_appointments_barbershopId_startAt_idx" ON "barber_appointments"("barbershopId", "startAt");
CREATE INDEX IF NOT EXISTS "barber_appointments_barberId_startAt_idx" ON "barber_appointments"("barberId", "startAt");
CREATE INDEX IF NOT EXISTS "barber_appointments_barbershopId_status_idx" ON "barber_appointments"("barbershopId", "status");
CREATE INDEX IF NOT EXISTS "barber_appointment_services_appointmentId_idx" ON "barber_appointment_services"("appointmentId");
CREATE INDEX IF NOT EXISTS "barber_appointment_services_serviceId_idx" ON "barber_appointment_services"("serviceId");
CREATE INDEX IF NOT EXISTS "barber_walkins_barbershopId_status_position_idx" ON "barber_walkins"("barbershopId", "status", "position");
CREATE INDEX IF NOT EXISTS "barber_walkins_barbershopId_joinedAt_idx" ON "barber_walkins"("barbershopId", "joinedAt");
CREATE INDEX IF NOT EXISTS "barber_memberships_barbershopId_isActive_idx" ON "barber_memberships"("barbershopId", "isActive");
CREATE INDEX IF NOT EXISTS "barber_client_memberships_barbershopId_status_idx" ON "barber_client_memberships"("barbershopId", "status");
CREATE INDEX IF NOT EXISTS "barber_client_memberships_clientId_idx" ON "barber_client_memberships"("clientId");
CREATE INDEX IF NOT EXISTS "barber_client_memberships_membershipId_idx" ON "barber_client_memberships"("membershipId");
CREATE INDEX IF NOT EXISTS "barber_sales_barbershopId_createdAt_idx" ON "barber_sales"("barbershopId", "createdAt");
CREATE INDEX IF NOT EXISTS "barber_sales_barberId_createdAt_idx" ON "barber_sales"("barberId", "createdAt");
CREATE INDEX IF NOT EXISTS "barber_sales_cashSessionId_idx" ON "barber_sales"("cashSessionId");
CREATE INDEX IF NOT EXISTS "barber_sale_items_saleId_idx" ON "barber_sale_items"("saleId");
CREATE INDEX IF NOT EXISTS "barber_products_barbershopId_isActive_idx" ON "barber_products"("barbershopId", "isActive");
CREATE INDEX IF NOT EXISTS "barber_cash_sessions_barbershopId_openedAt_idx" ON "barber_cash_sessions"("barbershopId", "openedAt");
CREATE INDEX IF NOT EXISTS "barber_commission_entries_barbershopId_periodKey_idx" ON "barber_commission_entries"("barbershopId", "periodKey");
CREATE INDEX IF NOT EXISTS "barber_commission_entries_barberId_periodKey_idx" ON "barber_commission_entries"("barberId", "periodKey");
CREATE INDEX IF NOT EXISTS "barber_messages_barbershopId_createdAt_idx" ON "barber_messages"("barbershopId", "createdAt");
CREATE INDEX IF NOT EXISTS "barber_messages_barbershopId_phone_idx" ON "barber_messages"("barbershopId", "phone");
CREATE INDEX IF NOT EXISTS "barber_messages_waMessageId_idx" ON "barber_messages"("waMessageId");


-- ── Foreign keys (idempotentes vía pg_constraint) ─────────────────────
-- ADD CONSTRAINT no soporta IF NOT EXISTS, así que cada uno se envuelve
-- en un IF NOT EXISTS contra pg_constraint dentro de un único bloque DO.
DO $barber$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_shops_parentId_fkey') THEN
    ALTER TABLE "barber_shops" ADD CONSTRAINT "barber_shops_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "barber_shops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_users_barbershopId_fkey') THEN
    ALTER TABLE "barber_users" ADD CONSTRAINT "barber_users_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_users_barberId_fkey') THEN
    ALTER TABLE "barber_users" ADD CONSTRAINT "barber_users_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "barber_barbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_barbers_barbershopId_fkey') THEN
    ALTER TABLE "barber_barbers" ADD CONSTRAINT "barber_barbers_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_clients_barbershopId_fkey') THEN
    ALTER TABLE "barber_clients" ADD CONSTRAINT "barber_clients_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_services_barbershopId_fkey') THEN
    ALTER TABLE "barber_services" ADD CONSTRAINT "barber_services_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_appointments_barbershopId_fkey') THEN
    ALTER TABLE "barber_appointments" ADD CONSTRAINT "barber_appointments_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_appointments_clientId_fkey') THEN
    ALTER TABLE "barber_appointments" ADD CONSTRAINT "barber_appointments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "barber_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_appointments_barberId_fkey') THEN
    ALTER TABLE "barber_appointments" ADD CONSTRAINT "barber_appointments_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "barber_barbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_appointment_services_appointmentId_fkey') THEN
    ALTER TABLE "barber_appointment_services" ADD CONSTRAINT "barber_appointment_services_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "barber_appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_appointment_services_serviceId_fkey') THEN
    ALTER TABLE "barber_appointment_services" ADD CONSTRAINT "barber_appointment_services_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "barber_services"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_walkins_barbershopId_fkey') THEN
    ALTER TABLE "barber_walkins" ADD CONSTRAINT "barber_walkins_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_walkins_barberId_fkey') THEN
    ALTER TABLE "barber_walkins" ADD CONSTRAINT "barber_walkins_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "barber_barbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_memberships_barbershopId_fkey') THEN
    ALTER TABLE "barber_memberships" ADD CONSTRAINT "barber_memberships_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_client_memberships_barbershopId_fkey') THEN
    ALTER TABLE "barber_client_memberships" ADD CONSTRAINT "barber_client_memberships_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_client_memberships_clientId_fkey') THEN
    ALTER TABLE "barber_client_memberships" ADD CONSTRAINT "barber_client_memberships_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "barber_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_client_memberships_membershipId_fkey') THEN
    ALTER TABLE "barber_client_memberships" ADD CONSTRAINT "barber_client_memberships_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "barber_memberships"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_sales_barbershopId_fkey') THEN
    ALTER TABLE "barber_sales" ADD CONSTRAINT "barber_sales_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_sales_appointmentId_fkey') THEN
    ALTER TABLE "barber_sales" ADD CONSTRAINT "barber_sales_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "barber_appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_sales_clientId_fkey') THEN
    ALTER TABLE "barber_sales" ADD CONSTRAINT "barber_sales_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "barber_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_sales_barberId_fkey') THEN
    ALTER TABLE "barber_sales" ADD CONSTRAINT "barber_sales_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "barber_barbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_sales_cashSessionId_fkey') THEN
    ALTER TABLE "barber_sales" ADD CONSTRAINT "barber_sales_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "barber_cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_sales_soldByUserId_fkey') THEN
    ALTER TABLE "barber_sales" ADD CONSTRAINT "barber_sales_soldByUserId_fkey" FOREIGN KEY ("soldByUserId") REFERENCES "barber_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_sale_items_saleId_fkey') THEN
    ALTER TABLE "barber_sale_items" ADD CONSTRAINT "barber_sale_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "barber_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_sale_items_serviceId_fkey') THEN
    ALTER TABLE "barber_sale_items" ADD CONSTRAINT "barber_sale_items_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "barber_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_sale_items_productId_fkey') THEN
    ALTER TABLE "barber_sale_items" ADD CONSTRAINT "barber_sale_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "barber_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_products_barbershopId_fkey') THEN
    ALTER TABLE "barber_products" ADD CONSTRAINT "barber_products_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_cash_sessions_barbershopId_fkey') THEN
    ALTER TABLE "barber_cash_sessions" ADD CONSTRAINT "barber_cash_sessions_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_cash_sessions_openedByUserId_fkey') THEN
    ALTER TABLE "barber_cash_sessions" ADD CONSTRAINT "barber_cash_sessions_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "barber_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_cash_sessions_closedByUserId_fkey') THEN
    ALTER TABLE "barber_cash_sessions" ADD CONSTRAINT "barber_cash_sessions_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "barber_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_commission_entries_barbershopId_fkey') THEN
    ALTER TABLE "barber_commission_entries" ADD CONSTRAINT "barber_commission_entries_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_commission_entries_barberId_fkey') THEN
    ALTER TABLE "barber_commission_entries" ADD CONSTRAINT "barber_commission_entries_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "barber_barbers"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_commission_entries_saleId_fkey') THEN
    ALTER TABLE "barber_commission_entries" ADD CONSTRAINT "barber_commission_entries_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "barber_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_commission_entries_appointmentId_fkey') THEN
    ALTER TABLE "barber_commission_entries" ADD CONSTRAINT "barber_commission_entries_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "barber_appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_messages_barbershopId_fkey') THEN
    ALTER TABLE "barber_messages" ADD CONSTRAINT "barber_messages_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_messages_clientId_fkey') THEN
    ALTER TABLE "barber_messages" ADD CONSTRAINT "barber_messages_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "barber_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_messages_appointmentId_fkey') THEN
    ALTER TABLE "barber_messages" ADD CONSTRAINT "barber_messages_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "barber_appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$barber$;


-- ── Seed de los 3 planes (editables después desde la tabla) ───────────
-- Precios en MXN/mes. -1 = ilimitado (maxBarbers / maxBranches /
-- messageQuota). messageQuota 200/600/-1 es PROVISIONAL: el número
-- final depende del costo de Meta (Rafael lo confirma y lo edita AQUÍ,
-- en la tabla — no en código).
INSERT INTO "barber_plan_configs"
  ("planId", "name", "priceMonthly", "priceYearly", "firstMonthPrice", "maxBarbers", "maxBranches", "messageQuota", "features", "stripePriceIdMonthly", "stripePriceIdYearly", "sortOrder", "isActive", "updatedAt")
VALUES
  ('BASICO', 'Básico', 199, NULL, NULL, 1, 1, 200, '{"agenda":true,"clients":true,"publicBooking":true,"whatsappReminders":true,"cash":true,"tips":true,"loyalty":true}'::jsonb, NULL, NULL, 0, true, CURRENT_TIMESTAMP)
ON CONFLICT ("planId") DO NOTHING;

INSERT INTO "barber_plan_configs"
  ("planId", "name", "priceMonthly", "priceYearly", "firstMonthPrice", "maxBarbers", "maxBranches", "messageQuota", "features", "stripePriceIdMonthly", "stripePriceIdYearly", "sortOrder", "isActive", "updatedAt")
VALUES
  ('AVANZADO', 'Avanzado', 329, NULL, NULL, 5, 1, 600, '{"agenda":true,"clients":true,"publicBooking":true,"whatsappReminders":true,"cash":true,"tips":true,"loyalty":true,"commissions":true,"walkinQueue":true,"memberships":true,"deposits":true,"whatsappInbox":true,"miniWebEditor":true,"products":true}'::jsonb, NULL, NULL, 1, true, CURRENT_TIMESTAMP)
ON CONFLICT ("planId") DO NOTHING;

INSERT INTO "barber_plan_configs"
  ("planId", "name", "priceMonthly", "priceYearly", "firstMonthPrice", "maxBarbers", "maxBranches", "messageQuota", "features", "stripePriceIdMonthly", "stripePriceIdYearly", "sortOrder", "isActive", "updatedAt")
VALUES
  ('PROFESIONAL', 'Profesional', 749, NULL, NULL, -1, -1, -1, '{"agenda":true,"clients":true,"publicBooking":true,"whatsappReminders":true,"cash":true,"tips":true,"loyalty":true,"commissions":true,"walkinQueue":true,"memberships":true,"deposits":true,"whatsappInbox":true,"miniWebEditor":true,"products":true,"multiBranch":true,"whatsappBot":true,"advancedRoles":true,"analytics":true,"affiliates":true}'::jsonb, NULL, NULL, 2, true, CURRENT_TIMESTAMP)
ON CONFLICT ("planId") DO NOTHING;
