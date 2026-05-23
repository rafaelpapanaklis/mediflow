-- ═══════════════════════════════════════════════════════════════════════
-- Proveedores / Compras — fundación del marketplace B2B.
--
-- El proveedor es GLOBAL (sin clinicId). Carrito, pedidos y chat son por
-- (clinicId, supplierId). Al final crea el bucket de Storage
-- 'supplier-products' (público) con sus policies de lectura pública y
-- escritura solo para usuarios autenticados.
--
-- IDEMPOTENTE: CREATE TYPE con guard DO $$ ... WHEN duplicate_object,
-- CREATE TABLE / INDEX con IF NOT EXISTS, ADD CONSTRAINT con guard DO $$
-- (Postgres no soporta IF NOT EXISTS en ADD CONSTRAINT).
-- ═══════════════════════════════════════════════════════════════════════

-- ── Enums ────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "SupplierStatus" AS ENUM ('PENDING','APPROVED','REJECTED','SUSPENDED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SupplierUserRole" AS ENUM ('OWNER','MANAGER','STAFF'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SupplierOrderStatus" AS ENUM ('PENDING','CONFIRMED','SHIPPED','DELIVERED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SupplierPaymentStatus" AS ENUM ('UNPAID','PAID'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SupplierChatSender" AS ENUM ('CLINIC','SUPPLIER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── suppliers ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "suppliers" (
  "id"             TEXT NOT NULL,
  "businessName"   TEXT NOT NULL,
  "slug"           TEXT NOT NULL,
  "rfc"            VARCHAR(13),
  "email"          TEXT NOT NULL,
  "phone"          TEXT,
  "address"        TEXT,
  "city"           TEXT,
  "state"          TEXT,
  "logoUrl"        TEXT,
  "description"    TEXT,
  "categories"     TEXT[] NOT NULL DEFAULT '{}',
  "paymentMethods" TEXT[] NOT NULL DEFAULT '{}',
  "status"         "SupplierStatus" NOT NULL DEFAULT 'PENDING',
  "approvedAt"     TIMESTAMP(3),
  "rejectedReason" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_slug_key" ON "suppliers" ("slug");
CREATE INDEX IF NOT EXISTS "suppliers_status_idx" ON "suppliers" ("status");

-- ── supplier_users ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "supplier_users" (
  "id"         TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "supabaseId" TEXT NOT NULL,
  "email"      TEXT NOT NULL,
  "firstName"  TEXT NOT NULL,
  "lastName"   TEXT NOT NULL,
  "role"       "SupplierUserRole" NOT NULL DEFAULT 'OWNER',
  "isActive"   BOOLEAN NOT NULL DEFAULT true,
  "lastLogin"  TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_users_supabaseId_supplierId_key" ON "supplier_users" ("supabaseId", "supplierId");
CREATE INDEX IF NOT EXISTS "supplier_users_supabaseId_idx" ON "supplier_users" ("supabaseId");

-- ── supplier_products ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "supplier_products" (
  "id"          TEXT NOT NULL,
  "supplierId"  TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "category"    TEXT,
  "sku"         TEXT,
  "price"       DOUBLE PRECISION NOT NULL,
  "unit"        TEXT NOT NULL DEFAULT 'pza',
  "stock"       INTEGER NOT NULL DEFAULT 0,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "supplier_products_supplierId_isActive_idx" ON "supplier_products" ("supplierId", "isActive");

-- ── supplier_product_images ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "supplier_product_images" (
  "id"        TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "url"       TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_product_images_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "supplier_product_images_productId_idx" ON "supplier_product_images" ("productId");

-- ── supplier_carts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "supplier_carts" (
  "id"         TEXT NOT NULL,
  "clinicId"   TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_carts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_carts_clinicId_supplierId_key" ON "supplier_carts" ("clinicId", "supplierId");

-- ── supplier_cart_items ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "supplier_cart_items" (
  "id"        TEXT NOT NULL,
  "cartId"    TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity"  INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_cart_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_cart_items_cartId_productId_key" ON "supplier_cart_items" ("cartId", "productId");

-- ── supplier_orders ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "supplier_orders" (
  "id"            TEXT NOT NULL,
  "orderNumber"   TEXT NOT NULL,
  "clinicId"      TEXT NOT NULL,
  "supplierId"    TEXT NOT NULL,
  "status"        "SupplierOrderStatus" NOT NULL DEFAULT 'PENDING',
  "paymentStatus" "SupplierPaymentStatus" NOT NULL DEFAULT 'UNPAID',
  "paymentMethod" TEXT,
  "subtotal"      DOUBLE PRECISION NOT NULL,
  "total"         DOUBLE PRECISION NOT NULL,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_orders_orderNumber_key" ON "supplier_orders" ("orderNumber");
CREATE INDEX IF NOT EXISTS "supplier_orders_clinicId_status_idx" ON "supplier_orders" ("clinicId", "status");
CREATE INDEX IF NOT EXISTS "supplier_orders_supplierId_status_idx" ON "supplier_orders" ("supplierId", "status");

-- ── supplier_order_items ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "supplier_order_items" (
  "id"          TEXT NOT NULL,
  "orderId"     TEXT NOT NULL,
  "productId"   TEXT,
  "productName" TEXT NOT NULL,
  "unitPrice"   DOUBLE PRECISION NOT NULL,
  "quantity"    INTEGER NOT NULL,
  "lineTotal"   DOUBLE PRECISION NOT NULL,
  CONSTRAINT "supplier_order_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "supplier_order_items_orderId_idx" ON "supplier_order_items" ("orderId");

-- ── supplier_chat_threads ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "supplier_chat_threads" (
  "id"             TEXT NOT NULL,
  "clinicId"       TEXT NOT NULL,
  "supplierId"     TEXT NOT NULL,
  "lastMessageAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clinicUnread"   INTEGER NOT NULL DEFAULT 0,
  "supplierUnread" INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_chat_threads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_chat_threads_clinicId_supplierId_key" ON "supplier_chat_threads" ("clinicId", "supplierId");
CREATE INDEX IF NOT EXISTS "supplier_chat_threads_clinicId_lastMessageAt_idx" ON "supplier_chat_threads" ("clinicId", "lastMessageAt" DESC);
CREATE INDEX IF NOT EXISTS "supplier_chat_threads_supplierId_lastMessageAt_idx" ON "supplier_chat_threads" ("supplierId", "lastMessageAt" DESC);

-- ── supplier_chat_messages ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "supplier_chat_messages" (
  "id"        TEXT NOT NULL,
  "threadId"  TEXT NOT NULL,
  "sender"    "SupplierChatSender" NOT NULL,
  "senderId"  TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "supplier_chat_messages_threadId_createdAt_idx" ON "supplier_chat_messages" ("threadId", "createdAt");

-- ── Foreign keys (guards DO $$ — PG no soporta IF NOT EXISTS en ADD CONSTRAINT) ──
DO $$ BEGIN
  ALTER TABLE "supplier_users" ADD CONSTRAINT "supplier_users_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_product_images" ADD CONSTRAINT "supplier_product_images_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "supplier_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_carts" ADD CONSTRAINT "supplier_carts_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_carts" ADD CONSTRAINT "supplier_carts_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_cart_items" ADD CONSTRAINT "supplier_cart_items_cartId_fkey"
    FOREIGN KEY ("cartId") REFERENCES "supplier_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_cart_items" ADD CONSTRAINT "supplier_cart_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "supplier_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_order_items" ADD CONSTRAINT "supplier_order_items_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "supplier_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_order_items" ADD CONSTRAINT "supplier_order_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "supplier_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_chat_threads" ADD CONSTRAINT "supplier_chat_threads_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_chat_threads" ADD CONSTRAINT "supplier_chat_threads_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "supplier_chat_messages" ADD CONSTRAINT "supplier_chat_messages_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "supplier_chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Storage bucket 'supplier-products' (público) + policies ─────────────────
-- Lectura pública (las imágenes de producto se muestran en el browse de la
-- clínica sin auth). Escritura (insert/update/delete) solo autenticados.
INSERT INTO storage.buckets (id, name, public)
VALUES ('supplier-products', 'supplier-products', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "supplier_products_public_read" ON storage.objects;
CREATE POLICY "supplier_products_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'supplier-products');

DROP POLICY IF EXISTS "supplier_products_auth_insert" ON storage.objects;
CREATE POLICY "supplier_products_auth_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'supplier-products');

DROP POLICY IF EXISTS "supplier_products_auth_update" ON storage.objects;
CREATE POLICY "supplier_products_auth_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'supplier-products');

DROP POLICY IF EXISTS "supplier_products_auth_delete" ON storage.objects;
CREATE POLICY "supplier_products_auth_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'supplier-products');
