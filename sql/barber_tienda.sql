-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — TIENDA DE PRODUCTOS (ws6-t1, 15-nov-2026).
--
-- Dos cosas, las dos ADITIVAS:
--
--   1. Cinco columnas nuevas en "barber_products" para que un producto se
--      pueda enseñar fuera del panel: foto, categoría, descripción corta,
--      «Mostrar en mi página web» y «Se puede apartar en línea». Los dos
--      interruptores nacen APAGADOS: pegar esto no publica nada.
--
--   2. La tabla "barber_product_orders": los pedidos que el cliente aparta
--      desde /b/<slug>/tienda. Es el CONTRATO con ws6-t5 (Mercado Pago):
--        · t1 crea el pedido (PENDING) con los precios CONGELADOS en `items`;
--        · t5 lo marca PAID_ONLINE (paid_at, mp_payment_id) desde su webhook,
--          una sola vez, y no toca ninguna otra columna;
--        · t1 lo pasa a READY / PICKED_UP (con sale_id, la venta de Caja) /
--          CANCELLED / EXPIRED (72 h sin recoger).
--      barbershop_id = la sede dueña de las existencias (la misma que vende
--      en Caja); branch_id = la sede donde se recoge (hoy, la misma).
--
-- El código funciona ANTES de pegar esto: sin las columnas, Productos se ve
-- con tarjetas pero sin foto ni categoría y la tienda pública no aparece;
-- sin la tabla, no se puede apartar y la pestaña Pedidos lo dice.
--
-- Plano e idempotente: se puede pegar dos veces. Supabase → SQL Editor.
--
-- Para deshacerlo (no toca tickets, existencias ni el corte):
--   DROP TABLE IF EXISTS "barber_product_orders";
--   ALTER TABLE "barber_products" DROP COLUMN IF EXISTS "photoUrl",
--     DROP COLUMN IF EXISTS "category", DROP COLUMN IF EXISTS "description",
--     DROP COLUMN IF EXISTS "showOnWeb", DROP COLUMN IF EXISTS "onlineOrder";
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Producto para la tienda ─────────────────────────────────────────
ALTER TABLE "barber_products" ADD COLUMN IF NOT EXISTS "photoUrl"    TEXT;
ALTER TABLE "barber_products" ADD COLUMN IF NOT EXISTS "category"    TEXT;
ALTER TABLE "barber_products" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "barber_products" ADD COLUMN IF NOT EXISTS "showOnWeb"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "barber_products" ADD COLUMN IF NOT EXISTS "onlineOrder" BOOLEAN NOT NULL DEFAULT false;

-- La tienda pública lee «los de esta sede que se muestran».
CREATE INDEX IF NOT EXISTS "barber_products_web_idx"
    ON "barber_products" ("barbershopId", "showOnWeb", "isActive");

-- ── 2. Pedidos de la tienda ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "barber_product_orders" (
    "id"               TEXT NOT NULL,
    "barbershop_id"    TEXT NOT NULL,
    "branch_id"        TEXT NOT NULL,
    "folio"            TEXT NOT NULL,
    "client_id"        TEXT,
    "client_name"      TEXT NOT NULL,
    "client_phone"     TEXT NOT NULL,
    "items"            JSONB NOT NULL,
    "total"            DECIMAL(10,2) NOT NULL,
    "status"           TEXT NOT NULL DEFAULT 'PENDING',
    "pay_method"       TEXT NOT NULL DEFAULT 'STORE',
    "mp_preference_id" TEXT,
    "mp_payment_id"    TEXT,
    "paid_at"          TIMESTAMPTZ,
    "picked_up_at"     TIMESTAMPTZ,
    "sale_id"          TEXT,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "barber_product_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "barber_product_orders_barbershop_fkey"
        FOREIGN KEY ("barbershop_id") REFERENCES "barber_shops"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "barber_product_orders_branch_fkey"
        FOREIGN KEY ("branch_id") REFERENCES "barber_shops"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "barber_product_orders_client_fkey"
        FOREIGN KEY ("client_id") REFERENCES "barber_clients"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "barber_product_orders_sale_fkey"
        FOREIGN KEY ("sale_id") REFERENCES "barber_sales"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "barber_product_orders_status_chk"
        CHECK ("status" IN ('PENDING', 'PAID_ONLINE', 'READY', 'PICKED_UP', 'CANCELLED', 'EXPIRED')),
    CONSTRAINT "barber_product_orders_pay_method_chk"
        CHECK ("pay_method" IN ('STORE', 'MERCADOPAGO')),
    CONSTRAINT "barber_product_orders_items_chk"
        CHECK (jsonb_typeof("items") = 'array' AND jsonb_array_length("items") > 0),
    CONSTRAINT "barber_product_orders_total_chk" CHECK ("total" >= 0),
    -- Entregado ⇔ tiene venta de Caja.
    CONSTRAINT "barber_product_orders_picked_chk"
        CHECK (("status" = 'PICKED_UP') = ("sale_id" IS NOT NULL)),
    -- Pagado en línea ⇒ con fecha de pago.
    CONSTRAINT "barber_product_orders_paid_chk"
        CHECK ("status" <> 'PAID_ONLINE' OR "paid_at" IS NOT NULL)
);

-- Folio corto, único dentro de la barbería.
CREATE UNIQUE INDEX IF NOT EXISTS "barber_product_orders_folio_key"
    ON "barber_product_orders" ("barbershop_id", "folio");

-- La lista del panel y el cálculo de lo apartado.
CREATE INDEX IF NOT EXISTS "barber_product_orders_status_idx"
    ON "barber_product_orders" ("barbershop_id", "status", "created_at");

-- Un pago de Mercado Pago marca UN pedido (idempotencia del webhook de t5).
CREATE UNIQUE INDEX IF NOT EXISTS "barber_product_orders_mp_payment_key"
    ON "barber_product_orders" ("mp_payment_id") WHERE "mp_payment_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "barber_product_orders_sale_idx"
    ON "barber_product_orders" ("sale_id") WHERE "sale_id" IS NOT NULL;
