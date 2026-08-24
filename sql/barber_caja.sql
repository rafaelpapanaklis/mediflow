-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — caja, comisiones e inventario (ola T6 "dinero").
--
-- NO crea tablas ni columnas: las tablas viven en sql/barber.sql y
-- sql/barber_complemento.sql (ambos deben estar aplicados antes). Este
-- archivo agrega SOLO constraints e índices de refuerzo que el código ya
-- respeta por sí mismo — son la red de seguridad de base de datos.
--
-- Aplicar manualmente en Supabase (SQL editor). Re-ejecutable: cada bloque
-- comprueba existencia antes de crear. Un único delimitador `$barberc$` y
-- sin DO anidados (el parser de Supabase rompe con $$ anidado).
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Un solo turno ABIERTO por barbería ──────────────────────────────
-- openCashSession() ya lo verifica dentro de su transacción; este índice
-- único parcial cierra la ventana de carrera entre dos aperturas
-- simultáneas (la segunda recibe P2002 → 409 SESSION_ALREADY_OPEN).
CREATE UNIQUE INDEX IF NOT EXISTS "barber_cash_sessions_one_open_idx"
  ON "barber_cash_sessions" ("barbershopId")
  WHERE "closedAt" IS NULL;


-- ── 2. El stock JAMÁS negativo ─────────────────────────────────────────
-- applyStockDelta() resta con `WHERE stock >= n` en la misma transacción de
-- la venta (una de dos ventas simultáneas del último producto falla con
-- OUT_OF_STOCK). El CHECK es defensa en profundidad ante cualquier UPDATE
-- que no pase por ahí.
DO $barberc$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_products_stock_nonnegative'
  ) THEN
    ALTER TABLE "barber_products"
      ADD CONSTRAINT "barber_products_stock_nonnegative" CHECK ("stock" >= 0);
  END IF;
END
$barberc$;


-- ── 3. Cantidades del ticket y del movimiento ──────────────────────────
-- Una línea de ticket siempre tiene qty ≥ 1 (el signo del descuento va en
-- unitPrice, nunca en qty). Un movimiento de inventario nunca es 0 (su
-- signo ES la convención: + suma, − resta).
DO $barberc$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_sale_items_qty_positive'
  ) THEN
    ALTER TABLE "barber_sale_items"
      ADD CONSTRAINT "barber_sale_items_qty_positive" CHECK ("qty" >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_stock_movements_qty_nonzero'
  ) THEN
    ALTER TABLE "barber_stock_movements"
      ADD CONSTRAINT "barber_stock_movements_qty_nonzero" CHECK ("qty" <> 0);
  END IF;
END
$barberc$;


-- ── 4. Montos del ticket y del turno nunca negativos ───────────────────
-- subtotal/tip/total viven en Decimal(10,2); un ticket cancelado queda en
-- 0 (soft-cancel), nunca por debajo. El fondo y el contado tampoco.
DO $barberc$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_sales_amounts_nonnegative'
  ) THEN
    ALTER TABLE "barber_sales"
      ADD CONSTRAINT "barber_sales_amounts_nonnegative"
      CHECK ("subtotal" >= 0 AND "tip" >= 0 AND "total" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_cash_sessions_amounts_nonnegative'
  ) THEN
    ALTER TABLE "barber_cash_sessions"
      ADD CONSTRAINT "barber_cash_sessions_amounts_nonnegative"
      CHECK (
        "openingAmount" >= 0
        AND ("countedAmount" IS NULL OR "countedAmount" >= 0)
      );
  END IF;
END
$barberc$;


-- ── 5. Índices de lectura de la ola ────────────────────────────────────
-- Tickets por barbería + turno (resumen del turno y cierre).
CREATE INDEX IF NOT EXISTS "barber_sales_barbershopId_cashSessionId_idx"
  ON "barber_sales" ("barbershopId", "cashSessionId");

-- Movimientos ligados a un ticket (cancelación devuelve por saleId).
CREATE INDEX IF NOT EXISTS "barber_stock_movements_saleId_idx"
  ON "barber_stock_movements" ("saleId");

-- Comisiones pendientes por barbería/barbero/periodo (marcar pagado).
CREATE INDEX IF NOT EXISTS "barber_commission_entries_pending_idx"
  ON "barber_commission_entries" ("barbershopId", "barberId", "periodKey", "paidAt");

-- Líneas por producto (más vendidos del periodo).
CREATE INDEX IF NOT EXISTS "barber_sale_items_productId_idx"
  ON "barber_sale_items" ("productId");
