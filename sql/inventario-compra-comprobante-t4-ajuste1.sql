-- ═══════════════════════════════════════════════════════════════════
-- INVENTARIO A (WS1-T4, AJUSTE 1) — comprobante de compra como archivo.
--
-- ⚠️  CORRER EN SUPABASE (SQL Editor) — https://supabase.com/dashboard/project/_/sql/new
--     Mientras no se pegue, subir un comprobante responde 503 (tabla/columna
--     faltante) — el resto de "Registrar compra" y el historial siguen
--     funcionando igual, sin comprobante de archivo (el código tolera
--     P2021/P2022, ver src/lib/inventory/comprobante.server.ts).
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica filas
-- existentes. PLANO: sin bloques DO (regla de la ola dev.108).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "inventory_purchases"
  ADD COLUMN IF NOT EXISTS "receiptFilePath" text;
ALTER TABLE "inventory_purchases"
  ADD COLUMN IF NOT EXISTS "receiptFileName" text;
ALTER TABLE "inventory_purchases"
  ADD COLUMN IF NOT EXISTS "receiptFileMime" text;
