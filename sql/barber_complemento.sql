-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — COMPLEMENTO del schema (schema-b).
--
-- Amplía sql/barber.sql (que DEBE estar aplicado antes) con: horarios y
-- bloqueos del barbero, fotos del historial de cortes, portal del cliente
-- (login por teléfono + código de un solo uso), tickets de soporte,
-- configuración de la mini-web, bitácora de inventario y multisucursal.
-- También convierte (barbershopId, phone) de barber_clients en ÚNICO.
--
-- Equivalente idempotente de la migración Prisma
--   prisma/migrations/20260824190000_barber_complemento/migration.sql
--
-- Aplicar manualmente en Supabase (SQL editor). Re-ejecutable: cada bloque
-- comprueba existencia antes de crear/alterar.
--
-- Nota sobre $$: usamos un único delimitador `$barberb$` y NUNCA bloques
-- DO anidados (el parser SQL de Supabase rompe con $$ anidado).
-- ═══════════════════════════════════════════════════════════════════════


-- ── Enums nuevos ───────────────────────────────────────────────────────
DO $barberb$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberTimeOffType') THEN
    CREATE TYPE "BarberTimeOffType" AS ENUM ('BREAK', 'VACATION', 'HOLIDAY', 'OTHER');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberPhotoKind') THEN
    CREATE TYPE "BarberPhotoKind" AS ENUM ('BEFORE', 'AFTER', 'REFERENCE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberTicketStatus') THEN
    CREATE TYPE "BarberTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_REPLY', 'CLOSED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberTicketPriority') THEN
    CREATE TYPE "BarberTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberTicketAuthor') THEN
    CREATE TYPE "BarberTicketAuthor" AS ENUM ('SHOP', 'ADMIN');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberStockMovementType') THEN
    CREATE TYPE "BarberStockMovementType" AS ENUM ('IN', 'OUT', 'ADJUST', 'SALE', 'RETURN');
  END IF;
END
$barberb$;


-- ── Columnas nuevas en tablas existentes ───────────────────────────────
-- Multisucursal en barber_shops.
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "branchName" TEXT;
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "isMainBranch" BOOLEAN NOT NULL DEFAULT true;

-- Portal del cliente en barber_clients.
ALTER TABLE "barber_clients" ADD COLUMN IF NOT EXISTS "portalEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "barber_clients" ADD COLUMN IF NOT EXISTS "lastPortalLoginAt" TIMESTAMP(3);
ALTER TABLE "barber_clients" ADD COLUMN IF NOT EXISTS "supabaseId" TEXT;

-- Inventario en barber_products.
ALTER TABLE "barber_products" ADD COLUMN IF NOT EXISTS "minStock" INTEGER;
ALTER TABLE "barber_products" ADD COLUMN IF NOT EXISTS "unit" TEXT;


-- ── (barbershopId, phone) pasa de índice normal a ÚNICO ────────────────
-- Cierra la carrera de dos reservas simultáneas del mismo teléfono creando
-- clientes duplicados. Las tablas están vacías, así que es seguro; si algún
-- día se re-ejecuta con duplicados ya presentes, el CREATE UNIQUE fallará y
-- hay que depurar los duplicados antes.
DROP INDEX IF EXISTS "barber_clients_barbershopId_phone_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "barber_clients_barbershopId_phone_key" ON "barber_clients"("barbershopId", "phone");
CREATE UNIQUE INDEX IF NOT EXISTS "barber_clients_supabaseId_key" ON "barber_clients"("supabaseId");


-- ── Tablas nuevas ──────────────────────────────────────────────────────
-- Horario recurrente del barbero. dayOfWeek 0-6 (0 = domingo, criterio JS
-- getDay()); startMinute/endMinute = minutos desde medianoche en la zona de
-- la barbería. Varias filas por día = turno partido.
CREATE TABLE IF NOT EXISTS "barber_schedules" (
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

-- Bloqueo puntual. barberId NULL = toda la barbería cerrada (día festivo).
CREATE TABLE IF NOT EXISTS "barber_time_off" (
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

-- Fotos del historial de cortes (varias por visita). El portal del cliente
-- solo muestra las marcadas visibleToClient = true.
CREATE TABLE IF NOT EXISTS "barber_visit_photos" (
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

-- Código de un solo uso del portal del cliente. codeHash = SOLO el hash;
-- el código en claro jamás se guarda.
CREATE TABLE IF NOT EXISTS "barber_client_auth_tokens" (
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

-- Tickets barbería → DaleControl (espejo del soporte dental).
CREATE TABLE IF NOT EXISTS "barber_support_tickets" (
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

-- Mensajes del ticket. authorUserId SIN FK a propósito: SHOP guarda
-- barber_users.id y ADMIN guarda el id del admin DaleControl (otro sistema).
CREATE TABLE IF NOT EXISTS "barber_support_messages" (
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

-- Configuración de la mini-web. version = bloqueo optimista (evita el 409
-- por guardado pisado que sufrió el editor dental).
CREATE TABLE IF NOT EXISTS "barber_landing_configs" (
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

-- Bitácora de inventario. qty SIGNADO: positivo suma stock, negativo resta;
-- stock actual = stock inicial + suma de qty.
CREATE TABLE IF NOT EXISTS "barber_stock_movements" (
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

-- Acceso de un usuario a OTRA sede de su cadena (multisucursal).
CREATE TABLE IF NOT EXISTS "barber_user_branch_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "barber_user_branch_access_pkey" PRIMARY KEY ("id")
);


-- ── Índices ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "barber_schedules_barbershopId_barberId_dayOfWeek_idx" ON "barber_schedules"("barbershopId", "barberId", "dayOfWeek");
CREATE INDEX IF NOT EXISTS "barber_time_off_barbershopId_startAt_endAt_idx" ON "barber_time_off"("barbershopId", "startAt", "endAt");
CREATE INDEX IF NOT EXISTS "barber_visit_photos_barbershopId_clientId_createdAt_idx" ON "barber_visit_photos"("barbershopId", "clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "barber_visit_photos_appointmentId_idx" ON "barber_visit_photos"("appointmentId");
CREATE INDEX IF NOT EXISTS "barber_client_auth_tokens_clientId_expiresAt_idx" ON "barber_client_auth_tokens"("clientId", "expiresAt");
CREATE INDEX IF NOT EXISTS "barber_client_auth_tokens_barbershopId_idx" ON "barber_client_auth_tokens"("barbershopId");
CREATE INDEX IF NOT EXISTS "barber_support_tickets_barbershopId_status_idx" ON "barber_support_tickets"("barbershopId", "status");
CREATE INDEX IF NOT EXISTS "barber_support_tickets_status_updatedAt_idx" ON "barber_support_tickets"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "barber_support_messages_ticketId_createdAt_idx" ON "barber_support_messages"("ticketId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "barber_landing_configs_barbershopId_key" ON "barber_landing_configs"("barbershopId");
CREATE INDEX IF NOT EXISTS "barber_stock_movements_barbershopId_productId_createdAt_idx" ON "barber_stock_movements"("barbershopId", "productId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "barber_user_branch_access_userId_barbershopId_key" ON "barber_user_branch_access"("userId", "barbershopId");
CREATE INDEX IF NOT EXISTS "barber_user_branch_access_barbershopId_idx" ON "barber_user_branch_access"("barbershopId");


-- ── Foreign keys (idempotentes vía pg_constraint) ─────────────────────
-- ADD CONSTRAINT no soporta IF NOT EXISTS, así que cada uno se envuelve
-- en un IF NOT EXISTS contra pg_constraint dentro de un único bloque DO.
DO $barberb$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_schedules_barbershopId_fkey') THEN
    ALTER TABLE "barber_schedules" ADD CONSTRAINT "barber_schedules_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_schedules_barberId_fkey') THEN
    ALTER TABLE "barber_schedules" ADD CONSTRAINT "barber_schedules_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "barber_barbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_time_off_barbershopId_fkey') THEN
    ALTER TABLE "barber_time_off" ADD CONSTRAINT "barber_time_off_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- Cascade A PROPÓSITO (no SetNull): un SetNull convertiría el bloqueo
  -- personal de un barbero borrado en "barbería cerrada".
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_time_off_barberId_fkey') THEN
    ALTER TABLE "barber_time_off" ADD CONSTRAINT "barber_time_off_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "barber_barbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_time_off_createdByUserId_fkey') THEN
    ALTER TABLE "barber_time_off" ADD CONSTRAINT "barber_time_off_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "barber_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_visit_photos_barbershopId_fkey') THEN
    ALTER TABLE "barber_visit_photos" ADD CONSTRAINT "barber_visit_photos_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_visit_photos_clientId_fkey') THEN
    ALTER TABLE "barber_visit_photos" ADD CONSTRAINT "barber_visit_photos_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "barber_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_visit_photos_appointmentId_fkey') THEN
    ALTER TABLE "barber_visit_photos" ADD CONSTRAINT "barber_visit_photos_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "barber_appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_visit_photos_uploadedByUserId_fkey') THEN
    ALTER TABLE "barber_visit_photos" ADD CONSTRAINT "barber_visit_photos_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "barber_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_client_auth_tokens_clientId_fkey') THEN
    ALTER TABLE "barber_client_auth_tokens" ADD CONSTRAINT "barber_client_auth_tokens_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "barber_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_client_auth_tokens_barbershopId_fkey') THEN
    ALTER TABLE "barber_client_auth_tokens" ADD CONSTRAINT "barber_client_auth_tokens_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_support_tickets_barbershopId_fkey') THEN
    ALTER TABLE "barber_support_tickets" ADD CONSTRAINT "barber_support_tickets_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_support_tickets_createdByUserId_fkey') THEN
    ALTER TABLE "barber_support_tickets" ADD CONSTRAINT "barber_support_tickets_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "barber_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_support_messages_ticketId_fkey') THEN
    ALTER TABLE "barber_support_messages" ADD CONSTRAINT "barber_support_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "barber_support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_support_messages_barbershopId_fkey') THEN
    ALTER TABLE "barber_support_messages" ADD CONSTRAINT "barber_support_messages_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_landing_configs_barbershopId_fkey') THEN
    ALTER TABLE "barber_landing_configs" ADD CONSTRAINT "barber_landing_configs_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_landing_configs_updatedByUserId_fkey') THEN
    ALTER TABLE "barber_landing_configs" ADD CONSTRAINT "barber_landing_configs_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "barber_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- NO ACTION: un producto con bitácora no se borra (se retira con
  -- isActive = false), mismo criterio que barberId en comisiones.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_stock_movements_productId_fkey') THEN
    ALTER TABLE "barber_stock_movements" ADD CONSTRAINT "barber_stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "barber_products"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_stock_movements_barbershopId_fkey') THEN
    ALTER TABLE "barber_stock_movements" ADD CONSTRAINT "barber_stock_movements_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_stock_movements_saleId_fkey') THEN
    ALTER TABLE "barber_stock_movements" ADD CONSTRAINT "barber_stock_movements_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "barber_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_stock_movements_userId_fkey') THEN
    ALTER TABLE "barber_stock_movements" ADD CONSTRAINT "barber_stock_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "barber_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_user_branch_access_userId_fkey') THEN
    ALTER TABLE "barber_user_branch_access" ADD CONSTRAINT "barber_user_branch_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "barber_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_user_branch_access_barbershopId_fkey') THEN
    ALTER TABLE "barber_user_branch_access" ADD CONSTRAINT "barber_user_branch_access_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$barberb$;
