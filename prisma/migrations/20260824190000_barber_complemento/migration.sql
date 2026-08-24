-- CreateEnum
CREATE TYPE "BarberTimeOffType" AS ENUM ('BREAK', 'VACATION', 'HOLIDAY', 'OTHER');

-- CreateEnum
CREATE TYPE "BarberPhotoKind" AS ENUM ('BEFORE', 'AFTER', 'REFERENCE');

-- CreateEnum
CREATE TYPE "BarberTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_REPLY', 'CLOSED');

-- CreateEnum
CREATE TYPE "BarberTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "BarberTicketAuthor" AS ENUM ('SHOP', 'ADMIN');

-- CreateEnum
CREATE TYPE "BarberStockMovementType" AS ENUM ('IN', 'OUT', 'ADJUST', 'SALE', 'RETURN');

-- DropIndex
DROP INDEX "barber_clients_barbershopId_phone_idx";

-- AlterTable
ALTER TABLE "barber_shops" ADD COLUMN "branchName" TEXT,
ADD COLUMN "isMainBranch" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "barber_clients" ADD COLUMN "portalEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastPortalLoginAt" TIMESTAMP(3),
ADD COLUMN "supabaseId" TEXT;

-- AlterTable
ALTER TABLE "barber_products" ADD COLUMN "minStock" INTEGER,
ADD COLUMN "unit" TEXT;

-- CreateTable
CREATE TABLE "barber_schedules" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "barberId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "barber_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barber_time_off" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "barberId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "type" "BarberTimeOffType" NOT NULL DEFAULT 'OTHER',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "barber_time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barber_visit_photos" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "url" TEXT NOT NULL,
    "kind" "BarberPhotoKind" NOT NULL,
    "visibleToClient" BOOLEAN NOT NULL DEFAULT false,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "barber_visit_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barber_client_auth_tokens" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "barber_client_auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barber_support_tickets" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'DUDA',
    "status" "BarberTicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "BarberTicketPriority" NOT NULL DEFAULT 'NORMAL',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "barber_support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barber_support_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "authorType" "BarberTicketAuthor" NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "barber_support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barber_landing_configs" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "barber_landing_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barber_stock_movements" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "type" "BarberStockMovementType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT,
    "saleId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "barber_stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barber_user_branch_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "barber_user_branch_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "barber_schedules_barbershopId_barberId_dayOfWeek_idx" ON "barber_schedules"("barbershopId", "barberId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "barber_time_off_barbershopId_startAt_endAt_idx" ON "barber_time_off"("barbershopId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "barber_visit_photos_barbershopId_clientId_createdAt_idx" ON "barber_visit_photos"("barbershopId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "barber_visit_photos_appointmentId_idx" ON "barber_visit_photos"("appointmentId");

-- CreateIndex
CREATE INDEX "barber_client_auth_tokens_clientId_expiresAt_idx" ON "barber_client_auth_tokens"("clientId", "expiresAt");

-- CreateIndex
CREATE INDEX "barber_client_auth_tokens_barbershopId_idx" ON "barber_client_auth_tokens"("barbershopId");

-- CreateIndex
CREATE INDEX "barber_support_tickets_barbershopId_status_idx" ON "barber_support_tickets"("barbershopId", "status");

-- CreateIndex
CREATE INDEX "barber_support_tickets_status_updatedAt_idx" ON "barber_support_tickets"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "barber_support_messages_ticketId_createdAt_idx" ON "barber_support_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "barber_landing_configs_barbershopId_key" ON "barber_landing_configs"("barbershopId");

-- CreateIndex
CREATE INDEX "barber_stock_movements_barbershopId_productId_createdAt_idx" ON "barber_stock_movements"("barbershopId", "productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "barber_user_branch_access_userId_barbershopId_key" ON "barber_user_branch_access"("userId", "barbershopId");

-- CreateIndex
CREATE INDEX "barber_user_branch_access_barbershopId_idx" ON "barber_user_branch_access"("barbershopId");

-- CreateIndex
CREATE UNIQUE INDEX "barber_clients_supabaseId_key" ON "barber_clients"("supabaseId");

-- CreateIndex
CREATE UNIQUE INDEX "barber_clients_barbershopId_phone_key" ON "barber_clients"("barbershopId", "phone");

-- AddForeignKey
ALTER TABLE "barber_schedules" ADD CONSTRAINT "barber_schedules_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_schedules" ADD CONSTRAINT "barber_schedules_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "barber_barbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_time_off" ADD CONSTRAINT "barber_time_off_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_time_off" ADD CONSTRAINT "barber_time_off_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "barber_barbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_time_off" ADD CONSTRAINT "barber_time_off_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "barber_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_visit_photos" ADD CONSTRAINT "barber_visit_photos_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_visit_photos" ADD CONSTRAINT "barber_visit_photos_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "barber_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_visit_photos" ADD CONSTRAINT "barber_visit_photos_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "barber_appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_visit_photos" ADD CONSTRAINT "barber_visit_photos_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "barber_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_client_auth_tokens" ADD CONSTRAINT "barber_client_auth_tokens_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "barber_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_client_auth_tokens" ADD CONSTRAINT "barber_client_auth_tokens_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_support_tickets" ADD CONSTRAINT "barber_support_tickets_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_support_tickets" ADD CONSTRAINT "barber_support_tickets_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "barber_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_support_messages" ADD CONSTRAINT "barber_support_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "barber_support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_support_messages" ADD CONSTRAINT "barber_support_messages_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_landing_configs" ADD CONSTRAINT "barber_landing_configs_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_landing_configs" ADD CONSTRAINT "barber_landing_configs_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "barber_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_stock_movements" ADD CONSTRAINT "barber_stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "barber_products"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_stock_movements" ADD CONSTRAINT "barber_stock_movements_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_stock_movements" ADD CONSTRAINT "barber_stock_movements_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "barber_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_stock_movements" ADD CONSTRAINT "barber_stock_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "barber_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_user_branch_access" ADD CONSTRAINT "barber_user_branch_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "barber_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barber_user_branch_access" ADD CONSTRAINT "barber_user_branch_access_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
