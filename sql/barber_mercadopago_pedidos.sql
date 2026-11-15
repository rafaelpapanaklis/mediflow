-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — red de la base para el pago en línea de los pedidos
-- de la tienda (ws6-t5).
--
-- ⚠️ ORDEN: pégalo DESPUÉS de sql/barber_tienda.sql (la tabla
-- barber_product_orders es de ws6-t1). Si esa tabla aún no existe, esto
-- falla con «relation "barber_product_orders" does not exist» y no cambia
-- nada: vuelve a pegarlo cuando exista. Va aparte de
-- sql/barber_mercadopago.sql justo para que un fallo aquí no deshaga la
-- tabla de la conexión.
--
-- Un pago de Mercado Pago marca UN solo pedido. El webhook ya lo garantiza
-- con un UPDATE condicionado (status = 'PENDING' AND mp_payment_id IS NULL);
-- este índice es la red de la base si algún otro código escribiera ahí.
--
-- Plano e idempotente. Para deshacerlo:
--   DROP INDEX IF EXISTS barber_product_orders_mp_payment_key;
-- ═══════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS barber_product_orders_mp_payment_key
  ON barber_product_orders (mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;
