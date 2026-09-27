-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — ws1-t5 · INVENTARIO B: BACKFILL "SIN LOTE".
--
-- ⛔⛔⛔ NO PEGAR TODAVÍA. PEGAR SOLO DESPUÉS DE INTEGRAR `feat/anticipos-panel`
-- A `main` Y DESPLEGAR A PRODUCCIÓN. ⛔⛔⛔
--
-- POR QUÉ: este INSERT toma "quantity" de "inventory_items" TAL COMO ESTÁ
-- en el momento de correrlo y la congela como "remaining" del lote "sin
-- lote". Mientras esta rama no esté integrada, producción (main) sigue
-- moviendo "quantity" con el código VIEJO, que no sabe nada de lotes. Si
-- este backfill se pega ANTES de integrar, los "remaining" quedarían
-- desfasados de las existencias reales en cuanto una clínica ajustara stock
-- después de pegarlo y antes del deploy.
--
-- Ajuste 1 del gerente (27-sep-2026): por eso el SQL de estructura
-- (sql/inventario-lotes-caducidad-t5-estructura.sql) se separó de este
-- backfill, y el CÓDIGO YA NO DEPENDE DE ESTE ARCHIVO PARA FUNCIONAR BIEN:
-- si un artículo no tiene ningún lote todavía, lots.server.ts
-- (reconcileAndLock) le crea el lote "sin lote" AL VUELO, leyendo
-- "quantity" en ESE INSTANTE — nunca uno viejo. Este backfill es ahora solo
-- una OPTIMIZACIÓN (evita que el primer touch de cada artículo pague el
-- costo extra de crear su lote sin lote) y una comodidad para ver algo en
-- la pantalla de Inventario → Lotes sin haber tocado nada todavía. Se puede
-- pegar en cualquier momento después del deploy, o nunca: el sistema
-- funciona igual de bien sin él, lote por lote, según se va usando.
--
-- IDEMPOTENTE Y PLANO — SIN `DO $$`. El WHERE NOT EXISTS excluye los
-- artículos que ya tienen al menos un lote (con nombre o "sin lote"),
-- vengan de una corrida anterior de este mismo archivo o de la creación al
-- vuelo del código.
--
-- Requiere sql/inventario-lotes-caducidad-t5-estructura.sql ya aplicado.
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Backfill: existencias de HOY (al momento de correr esto) → lote
--       "sin lote" ──────────────────────────────────────────────────────
INSERT INTO "inventory_lots" ("id", "clinicId", "itemId", "lotNumber", "expiresAt", "quantity", "remaining", "unitCost", "purchaseLineId", "createdAt", "updatedAt")
SELECT
  'sinlote_' || i."id",
  i."clinicId",
  i."id",
  NULL,
  NULL,
  i."quantity",
  i."quantity",
  i."price",
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "inventory_items" i
WHERE NOT EXISTS (
  SELECT 1 FROM "inventory_lots" l WHERE l."itemId" = i."id"
);


-- ── 2. Comprobación (solo lee) ────────────────────────────────────────────
-- Debe devolver 0: ningún InventoryItem debería quedar sin al menos un lote
-- tras el backfill (y si queda alguno, el código se lo crea solo en su
-- primer touch — no es grave, solo informativo).
SELECT COUNT(*) AS items_sin_lote
FROM "inventory_items" i
WHERE NOT EXISTS (SELECT 1 FROM "inventory_lots" l WHERE l."itemId" = i."id");
