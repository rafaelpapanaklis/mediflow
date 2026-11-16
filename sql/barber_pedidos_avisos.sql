-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — AVISOS AL DUEÑO DE LOS PEDIDOS DE LA TIENDA
-- (ws6-t6, 16-nov-2026: correo y WhatsApp por cada pedido nuevo).
--
--   1. Tres columnas en "barber_shops" (los interruptores de Configuración →
--      Notificaciones, uno por sede):
--        · "orderNotifyEmail"    — avisar por CORREO. Nace ENCENDIDO.
--        · "orderNotifyWhatsapp" — avisar por WHATSAPP. Nace APAGADO (Meta
--          cobra cada aviso que sale fuera de la ventana de 24 h).
--        · "orderNotifyPhone"    — el WhatsApp del dueño (10 dígitos) al que
--          se manda. Vacío = no se manda por WhatsApp.
--   2. La tabla "barber_order_notices": UNA fila por (pedido, motivo, canal).
--      Es la marca de «ya se avisó»: el aviso se RECLAMA con un INSERT y, si
--      la fila ya existe, no se manda otra vez (un reintento del webhook de
--      Mercado Pago o dos peticiones a la vez no duplican el correo).
--        motivo  NEW  = entró el pedido · PAID = se pagó en línea
--        canal   EMAIL · WHATSAPP
--        estado  SENDING → SENT | FAILED | SKIPPED (con el porqué en "detail")
--
-- El código funciona ANTES de pegar esto: sin las columnas o sin la tabla NO
-- se manda ningún aviso (ni correo ni WhatsApp), la tarjeta de Notificaciones
-- lo dice, y todo lo demás sigue igual (el pedido se guarda, el numerito del
-- menú y la tarjeta de Inicio funcionan).
--
-- Plano, aditivo e idempotente: se puede pegar dos veces. No reescribe filas
-- (un ADD COLUMN con DEFAULT constante es solo catálogo en Postgres 11+).
-- Requiere sql/barber_tienda.sql (la tabla de pedidos). Supabase → SQL Editor.
--
-- Para deshacerlo (no toca pedidos, tickets ni mensajes):
--   DROP TABLE IF EXISTS "barber_order_notices";
--   ALTER TABLE "barber_shops" DROP COLUMN IF EXISTS "orderNotifyEmail",
--     DROP COLUMN IF EXISTS "orderNotifyWhatsapp", DROP COLUMN IF EXISTS "orderNotifyPhone";
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Interruptores por sede ──────────────────────────────────────────
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "orderNotifyEmail"    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "orderNotifyWhatsapp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "orderNotifyPhone"    TEXT;

-- ── 2. La marca de «ya se avisó» ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "barber_order_notices" (
    "order_id"      TEXT NOT NULL,
    "kind"          TEXT NOT NULL,
    "channel"       TEXT NOT NULL,
    "barbershop_id" TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'SENDING',
    "detail"        TEXT,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "barber_order_notices_pkey" PRIMARY KEY ("order_id", "kind", "channel"),
    CONSTRAINT "barber_order_notices_order_fkey"
        FOREIGN KEY ("order_id") REFERENCES "barber_product_orders"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "barber_order_notices_barbershop_fkey"
        FOREIGN KEY ("barbershop_id") REFERENCES "barber_shops"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "barber_order_notices_kind_chk" CHECK ("kind" IN ('NEW', 'PAID')),
    CONSTRAINT "barber_order_notices_channel_chk" CHECK ("channel" IN ('EMAIL', 'WHATSAPP')),
    CONSTRAINT "barber_order_notices_status_chk" CHECK ("status" IN ('SENDING', 'SENT', 'FAILED', 'SKIPPED'))
);

-- Para revisar los avisos de una barbería (soporte).
CREATE INDEX IF NOT EXISTS "barber_order_notices_shop_idx"
    ON "barber_order_notices" ("barbershop_id", "created_at");
