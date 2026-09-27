-- ═══════════════════════════════════════════════════════════════════
-- INVENTARIO A (WS1-T4) — proveedores propios y compras/entradas.
--
-- ⚠️  CORRER EN SUPABASE (SQL Editor) — https://supabase.com/dashboard/project/_/sql/new
--     Mientras no se pegue, "Registrar compra" y "Proveedores" en Inventario
--     responden 503 (tabla faltante) — el resto del panel sigue igual, el
--     código tolera P2021/P2022.
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica filas
-- existentes. PLANO: sin bloques DO (regla de la ola dev.108); las
-- restricciones se aplican con DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Proveedores propios de la clínica (NO el Supplier del marketplace).
CREATE TABLE IF NOT EXISTS "inventory_providers" (
  "id"        text NOT NULL,
  "clinicId"  text NOT NULL,
  "name"      text NOT NULL,
  "rfc"       varchar(13),
  "contact"   text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_providers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "inventory_providers_clinicId_name_idx"
  ON "inventory_providers" ("clinicId", "name");

ALTER TABLE "inventory_providers" DROP CONSTRAINT IF EXISTS "inventory_providers_clinicId_fkey";
ALTER TABLE "inventory_providers"
  ADD CONSTRAINT "inventory_providers_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) Proveedor opcional en el artículo.
ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "providerId" text;

ALTER TABLE "inventory_items" DROP CONSTRAINT IF EXISTS "inventory_items_providerId_fkey";
ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "inventory_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Compras/entradas.
CREATE TABLE IF NOT EXISTS "inventory_purchases" (
  "id"             text NOT NULL,
  "clinicId"       text NOT NULL,
  "providerId"     text,
  "date"           timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receiptRef"     text,
  "createdById"    text NOT NULL,
  "idempotencyKey" text,
  "createdAt"      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_purchases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_purchases_clinicId_idempotencyKey_key"
  ON "inventory_purchases" ("clinicId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "inventory_purchases_clinicId_date_idx"
  ON "inventory_purchases" ("clinicId", "date");

ALTER TABLE "inventory_purchases" DROP CONSTRAINT IF EXISTS "inventory_purchases_clinicId_fkey";
ALTER TABLE "inventory_purchases"
  ADD CONSTRAINT "inventory_purchases_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_purchases" DROP CONSTRAINT IF EXISTS "inventory_purchases_providerId_fkey";
ALTER TABLE "inventory_purchases"
  ADD CONSTRAINT "inventory_purchases_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "inventory_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Líneas de compra. id ESTABLE — ws1-t5 cuelga su tabla de lotes de aquí
--    (InventoryLot.purchaseLineId, sin FK dura — ver su propio SQL).
CREATE TABLE IF NOT EXISTS "inventory_purchase_lines" (
  "id"         text NOT NULL,
  "purchaseId" text NOT NULL,
  "itemId"     text NOT NULL,
  "quantity"   integer NOT NULL,
  "unitCost"   double precision NOT NULL,
  CONSTRAINT "inventory_purchase_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "inventory_purchase_lines_purchaseId_idx"
  ON "inventory_purchase_lines" ("purchaseId");
CREATE INDEX IF NOT EXISTS "inventory_purchase_lines_itemId_idx"
  ON "inventory_purchase_lines" ("itemId");

ALTER TABLE "inventory_purchase_lines" DROP CONSTRAINT IF EXISTS "inventory_purchase_lines_purchaseId_fkey";
ALTER TABLE "inventory_purchase_lines"
  ADD CONSTRAINT "inventory_purchase_lines_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "inventory_purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_purchase_lines" DROP CONSTRAINT IF EXISTS "inventory_purchase_lines_itemId_fkey";
ALTER TABLE "inventory_purchase_lines"
  ADD CONSTRAINT "inventory_purchase_lines_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5) Gasto ligado a la compra que lo creó (1:1, nullable).
ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "purchaseId" text;
CREATE UNIQUE INDEX IF NOT EXISTS "expenses_purchaseId_key" ON "expenses" ("purchaseId");

ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_purchaseId_fkey";
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "inventory_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
