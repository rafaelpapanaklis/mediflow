-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — ws1-t5 · INVENTARIO B: LOTES, CADUCIDAD Y CONSUMO
-- POR TRATAMIENTO — SOLO ESTRUCTURA.
--
-- ✅ SEGURO DE PEGAR YA, aunque la rama `feat/anticipos-panel` siga sin
-- integrarse: solo crea columnas/tablas/índices/FKs nuevos, NO toca ni una
-- fila. El código (lots.server.ts) NO depende de ningún backfill — ver la
-- nota de "Ajuste 1 del gerente" abajo — así que aplicar esto ya no deja
-- nada a medias.
--
-- ⛔ El backfill masivo (la migración de "existencias de hoy → lote sin
-- lote" para TODOS los artículos de un jalón) va en un archivo APARTE:
-- sql/inventario-lotes-caducidad-t5-backfill-post-integracion.sql — y ESE
-- solo se pega DESPUÉS de que esta rama se integre a `main` y se despliegue
-- a producción. Ver ese archivo para el porqué.
--
-- Ticket de BEVADENT: «lotes, caducidad y consumo por tratamiento»
-- (REPORTE-ws1-t8.md, «3 · INVENTARIO»). Bloque propio, sobre el trabajo de
-- ws1-t4 (costo unitario, proveedores, compras — no se toca aquí).
--
-- Contenido:
--   2 columnas nuevas · "inventory_items".quantityPrecise,
--                        "treatment_sessions".procedureId
--   4 tablas nuevas   · inventory_lots, inventory_lot_movements,
--                        procedure_material_recipes, inventory_alert_settings
--   Índices           · uno por FK/consulta frecuente
--   2 llaves foráneas · inventory_lots.itemId → inventory_items,
--                        treatment_sessions.procedureId → procedure_catalog
--                        (las de procedure_material_recipes van con la
--                        tabla, en su propio bloque)
--
-- IDEMPOTENTE Y PLANO — SIN `DO $$` EN NINGÚN SITIO (el SQL Editor de
-- Supabase no lo digiere de fiar). Para columnas, tablas e índices, los
-- propios `IF NOT EXISTS` bastan. Para las llaves foráneas —que no tienen
-- `IF NOT EXISTS` en Postgres— el patrón es siempre el mismo par de líneas:
-- "ALTER TABLE ... DROP CONSTRAINT IF EXISTS ..." seguido de
-- "ALTER TABLE ... ADD CONSTRAINT ...". Quitar y volver a poner una
-- restricción no toca ni una fila. CERO DROP de tablas o columnas.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
--
-- Nombres de columna: camelCase ENTRECOMILLADO, como los escribe Prisma.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Columnas nuevas en tablas existentes ─────────────────────────────
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "quantityPrecise" DECIMAL(12,3);

ALTER TABLE "treatment_sessions" ADD COLUMN IF NOT EXISTS "procedureId" TEXT;


-- ── 2. inventory_lots ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_lots" (
  "id"             TEXT NOT NULL,
  "clinicId"       TEXT NOT NULL,
  "itemId"         TEXT NOT NULL,
  "lotNumber"      TEXT,
  "expiresAt"      TIMESTAMP(3),
  "quantity"       DECIMAL(12,3) NOT NULL,
  "remaining"      DECIMAL(12,3) NOT NULL,
  "unitCost"       DOUBLE PRECISION,
  "purchaseLineId" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inventory_lots_clinicId_itemId_idx"
  ON "inventory_lots" ("clinicId", "itemId");
CREATE INDEX IF NOT EXISTS "inventory_lots_itemId_remaining_idx"
  ON "inventory_lots" ("itemId", "remaining");
CREATE INDEX IF NOT EXISTS "inventory_lots_clinicId_expiresAt_idx"
  ON "inventory_lots" ("clinicId", "expiresAt");

ALTER TABLE "inventory_lots" DROP CONSTRAINT IF EXISTS "inventory_lots_itemId_fkey";
ALTER TABLE "inventory_lots"
  ADD CONSTRAINT "inventory_lots_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


-- ── 3. inventory_lot_movements ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_lot_movements" (
  "id"                 TEXT NOT NULL,
  "lotId"              TEXT NOT NULL,
  "clinicId"           TEXT NOT NULL,
  "change"             DECIMAL(12,3) NOT NULL,
  "reason"             TEXT NOT NULL,
  "userId"             TEXT,
  "treatmentSessionId" TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inventory_lot_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inventory_lot_movements_lotId_createdAt_idx"
  ON "inventory_lot_movements" ("lotId", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_lot_movements_clinicId_createdAt_idx"
  ON "inventory_lot_movements" ("clinicId", "createdAt");

ALTER TABLE "inventory_lot_movements" DROP CONSTRAINT IF EXISTS "inventory_lot_movements_lotId_fkey";
ALTER TABLE "inventory_lot_movements"
  ADD CONSTRAINT "inventory_lot_movements_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "inventory_lots"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


-- ── 4. procedure_material_recipes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "procedure_material_recipes" (
  "id"          TEXT NOT NULL,
  "clinicId"    TEXT NOT NULL,
  "procedureId" TEXT NOT NULL,
  "itemId"      TEXT NOT NULL,
  "quantity"    DECIMAL(12,3) NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "procedure_material_recipes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "procedure_material_recipes_procedureId_itemId_key"
  ON "procedure_material_recipes" ("procedureId", "itemId");
CREATE INDEX IF NOT EXISTS "procedure_material_recipes_clinicId_idx"
  ON "procedure_material_recipes" ("clinicId");

ALTER TABLE "procedure_material_recipes" DROP CONSTRAINT IF EXISTS "procedure_material_recipes_procedureId_fkey";
ALTER TABLE "procedure_material_recipes"
  ADD CONSTRAINT "procedure_material_recipes_procedureId_fkey"
  FOREIGN KEY ("procedureId") REFERENCES "procedure_catalog"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "procedure_material_recipes" DROP CONSTRAINT IF EXISTS "procedure_material_recipes_itemId_fkey";
ALTER TABLE "procedure_material_recipes"
  ADD CONSTRAINT "procedure_material_recipes_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


-- ── 5. inventory_alert_settings ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_alert_settings" (
  "clinicId"       TEXT NOT NULL,
  "alertDaysAhead" INTEGER NOT NULL DEFAULT 30,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "inventory_alert_settings_pkey" PRIMARY KEY ("clinicId")
);


-- ── 6. treatment_sessions.procedureId → procedure_catalog ────────────────
ALTER TABLE "treatment_sessions" DROP CONSTRAINT IF EXISTS "treatment_sessions_procedureId_fkey";
ALTER TABLE "treatment_sessions"
  ADD CONSTRAINT "treatment_sessions_procedureId_fkey"
  FOREIGN KEY ("procedureId") REFERENCES "procedure_catalog"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;


-- ── 7. Comprobación (solo lee) ────────────────────────────────────────────
-- Debe devolver 4 filas (una por tabla nueva).
SELECT table_name
FROM information_schema.tables
WHERE table_name IN ('inventory_lots', 'inventory_lot_movements', 'procedure_material_recipes', 'inventory_alert_settings')
ORDER BY table_name;
