-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — la cuenta de MERCADO PAGO de cada barbería (ws6-t5).
--
-- Rafael (15-nov-2026): los productos de la tienda se pueden pagar «con
-- Mercado Pago de la misma forma que lo incluimos en dental». Mismo modelo:
-- la barbería conecta SU cuenta por OAuth (la aplicación «DaleControl» de
-- Mercado Pago), el dinero va directo a ella y DaleControl no lo toca. La
-- comisión (marketplace_fee) está construida y arranca en 0.
--
-- UNA TABLA NUEVA, CERO COLUMNAS EN TABLAS QUE YA EXISTEN, y NADA en las
-- tablas del dental (clinic_mercadopago no se toca). Una fila por CADENA:
-- barbershop_id es la MATRIZ (barber_shops.parentId NULL); sus sucursales
-- cobran con la misma cuenta.
--
-- Los tokens se guardan CIFRADOS (AES-256-GCM con DATA_ENCRYPTION_KEY, igual
-- que el dental: src/lib/crypto/envelope.ts). Sin la llave el código no
-- guarda nada y la pantalla dice «vuelve a conectar».
--
-- Se lee y escribe con SQL crudo desde src/lib/barber/mercadopago.ts; NO está
-- en prisma/schema.prisma. El código funciona ANTES de pegar esto: sin la
-- tabla, «Pagos en línea» dice que falta este archivo y la tienda no ofrece
-- pagar en línea. ⚠️ Un `prisma db push` en una base de desarrollo la
-- borraría: si pasa, vuelve a correr este archivo.
--
-- Plano (sin DO $$) e idempotente: se puede pegar las veces que haga falta.
-- Para deshacerlo:  DROP TABLE IF EXISTS barber_mercadopago_accounts;
-- (Solo se pierde la conexión: la barbería vuelve a conectar su cuenta.)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS barber_mercadopago_accounts (
  -- La MATRIZ de la cadena.
  barbershop_id         text        PRIMARY KEY REFERENCES barber_shops(id) ON DELETE CASCADE,
  -- user_id de Mercado Pago de la cuenta conectada: el «collector» de los pagos.
  mp_user_id            text,
  mp_nickname           text,
  mp_email              text,
  live_mode             boolean,
  -- CIFRADOS («v1:…»). NULL = desconectada.
  access_token          text,
  refresh_token         text,
  token_expires_at      timestamptz,
  connected_at          timestamptz,
  -- barber_users.id de quien conectó (el dueño). Sin FK a propósito: si esa
  -- persona se borra, la conexión sigue siendo de la barbería.
  connected_by_id       text,
  disconnected_at       timestamptz,
  -- Comisión de DaleControl (marketplace_fee de Mercado Pago). ARRANCA EN 0:
  -- sale apagada. 'fixed' = pesos por pedido · 'percent' = % del pedido.
  marketplace_fee_mode  text        NOT NULL DEFAULT 'fixed',
  marketplace_fee_value double precision NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT barber_mercadopago_accounts_fee_mode_check
    CHECK (marketplace_fee_mode IN ('fixed', 'percent')),
  CONSTRAINT barber_mercadopago_accounts_fee_value_check
    CHECK (marketplace_fee_value >= 0),
  -- Conectada = token Y cuenta; nunca un token sin saber de quién es.
  CONSTRAINT barber_mercadopago_accounts_token_owner_check
    CHECK (access_token IS NULL OR mp_user_id IS NOT NULL)
);

COMMENT ON TABLE barber_mercadopago_accounts IS
  'Cuenta de Mercado Pago (OAuth) de cada cadena de barberías, tokens cifrados. La escribe src/lib/barber/mercadopago.ts. No es la del dental (clinic_mercadopago).';

-- Igual que el resto de las tablas del vertical: solo el servidor (Prisma con
-- la conexión de servicio) la toca; nada de leerla desde el navegador.
ALTER TABLE barber_mercadopago_accounts ENABLE ROW LEVEL SECURITY;
