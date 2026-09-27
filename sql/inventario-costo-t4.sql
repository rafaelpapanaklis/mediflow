-- ═══════════════════════════════════════════════════════════════════
-- INVENTARIO A (WS1-T4) — costo unitario de InventoryItem.
--
-- ⚠️  CORRER EN SUPABASE (SQL Editor) — https://supabase.com/dashboard/project/_/sql/new
--     Mientras no se pegue, "Valor total" del inventario sigue en $0 y el
--     campo Costo unitario no se puede guardar (el código tolera P2021/
--     P2022 — ver src/lib/inventory/costo.server.ts — así que el resto de
--     Inventario, Ejercicios y Ortopédicos sigue funcionando igual).
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica filas
-- existentes, salvo el backfill del punto 2 (solo toca unitCost, y solo si
-- sigue en su default 0). PLANO: sin bloques DO (regla de la ola dev.108).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Columna nueva. DEFAULT 0 en la propia columna: cualquier INSERT que no
--    la mencione (código viejo, si quedara alguno) cae en 0, no en NULL.
ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "unitCost" double precision NOT NULL DEFAULT 0;

-- 2) Backfill de una sola vez: los artículos que ya tenían `price` capturado
--    (el campo ambiguo de antes de ws1-t4) usan ese valor como mejor
--    aproximación conocida de su costo. Solo toca filas en 0 — no pisa un
--    unitCost que ya se haya editado a mano tras aplicar este SQL.
UPDATE "inventory_items"
  SET "unitCost" = "price"
  WHERE "price" IS NOT NULL AND "unitCost" = 0;

-- 3) Bitácora: InventoryHistory queda con quién y de qué clínica (nada lo
--    llenaba). Nullable — filas viejas se quedan sin estos datos.
ALTER TABLE "inventory_history"
  ADD COLUMN IF NOT EXISTS "clinicId" text;
ALTER TABLE "inventory_history"
  ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "inventory_history"
  ADD COLUMN IF NOT EXISTS "type" text NOT NULL DEFAULT 'adjust';

