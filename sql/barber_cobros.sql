-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — cada COBRO de la suscripción de la barbería y los
-- términos REALES de su suscripción (importe y ciclo que cobra Stripe).
--
-- Decisión de Rafael (15-nov-2026, #5): «registrar cada pago de las
-- barberías para ver "cobrado este mes" en el admin y que el ingreso sea lo
-- que cobra Stripe, no el precio de lista».
--
-- DOS TABLAS NUEVAS, CERO COLUMNAS NUEVAS EN barber_shops (a propósito):
--   una columna nueva en barber_shops hace que TODA lectura de barbería sin
--   `select` (el cliente Prisma pide todas las columnas que conoce) truene
--   con «column does not exist» mientras este archivo no se pegue. Con tablas
--   aparte el código funciona ANTES de pegarlo: lo que falta se lee como
--   «sin registro» (isMissingTableError) y todo sigue como hasta hoy.
--
--   barber_subscription_payments — una fila por FACTURA de Stripe de la
--     suscripción (pagada o rechazada), idempotente por stripe_invoice_id.
--     La escribe el webhook /api/barber/stripe/webhook (invoice.paid /
--     invoice.payment_failed). Una factura rechazada que luego se paga es
--     la MISMA fila: pasa de 'failed' a 'paid' y nunca al revés.
--   barber_subscriptions — UNA fila por matriz con lo que Stripe le cobra
--     HOY (importe en centavos, moneda, ciclo month/year, plan) y la marca
--     de «reactivada a mano». La escribe el mismo webhook en cada evento de
--     la suscripción, y admin.ts al reactivar a mano.
--
-- PARA QUÉ SE USAN
--   · /admin/barberias y la portada de /admin: «Cobrado este mes» = suma de
--     amount_cents de las filas 'paid' con paid_at en el mes; el MRR usa
--     price_cents (÷ 12 si el ciclo es anual); «paga» = tiene un cobro
--     VIGENTE (period_end de un cobro pagado que no ha vencido).
--   · El corte sin días de gracia: la barbería queda suspendida al terminar
--     el día (de México) en que termina su último periodo PAGADO.
--
-- Nada se borra: no hay DELETE en el código; ON DELETE CASCADE solo actúa
-- si alguien borrara la barbería entera (igual que barber_admin_actions).
--
-- Plano (sin DO $$) e idempotente: se puede correr las veces que haga falta.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS barber_subscription_payments (
  id                     text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  -- La MATRIZ que paga (parentId NULL). Una sucursal nunca tiene cobros.
  barbershop_id          text        NOT NULL REFERENCES barber_shops(id) ON DELETE CASCADE,
  -- in_… de Stripe. La llave de idempotencia: un evento repetido no duplica.
  stripe_invoice_id      text        NOT NULL,
  stripe_subscription_id text,
  -- 'paid' | 'failed'
  status                 text        NOT NULL,
  -- Lo que Stripe COBRÓ (amount_paid) o intentó cobrar (amount_due), en
  -- centavos enteros: nunca un float.
  amount_cents           integer     NOT NULL,
  currency               text        NOT NULL DEFAULT 'mxn',
  plan_id                text,
  -- 'month' | 'year'
  billing_interval       text,
  -- Periodo de servicio que paga esta factura (líneas de la suscripción).
  period_start           timestamptz,
  period_end             timestamptz,
  paid_at                timestamptz,
  failure_code           text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT barber_subscription_payments_status_check CHECK (status IN ('paid', 'failed')),
  CONSTRAINT barber_subscription_payments_amount_check CHECK (amount_cents >= 0),
  CONSTRAINT barber_subscription_payments_interval_check
    CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year'))
);

CREATE UNIQUE INDEX IF NOT EXISTS barber_subscription_payments_invoice_key
  ON barber_subscription_payments (stripe_invoice_id);

-- «Cobrado este mes» y el último periodo pagado de una barbería.
CREATE INDEX IF NOT EXISTS barber_subscription_payments_shop_idx
  ON barber_subscription_payments (barbershop_id, status, period_end DESC);

CREATE INDEX IF NOT EXISTS barber_subscription_payments_paid_at_idx
  ON barber_subscription_payments (paid_at DESC);

COMMENT ON TABLE barber_subscription_payments IS
  'Cada factura de Stripe de la suscripción de una barbería (pagada o rechazada), idempotente por stripe_invoice_id. La escribe el webhook de barber (src/lib/barber/cobros.ts).';

CREATE TABLE IF NOT EXISTS barber_subscriptions (
  -- La MATRIZ (una fila por barbería que paga).
  barbershop_id          text        PRIMARY KEY REFERENCES barber_shops(id) ON DELETE CASCADE,
  stripe_subscription_id text,
  -- Estado tal cual lo manda Stripe (active, past_due, canceled…).
  stripe_status          text,
  -- unit_amount × quantity del precio vigente en Stripe, en centavos.
  price_cents            integer,
  currency               text,
  -- 'month' | 'year'
  billing_interval       text,
  plan_id                text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean     NOT NULL DEFAULT false,
  -- Cuándo DaleControl la reactivó A MANO desde /admin/barberias. Mientras
  -- no llegue un cobro posterior, el corte por fecha no la vuelve a cerrar
  -- (es una cortesía, y como tal no cuenta como «paga»).
  manual_access_at       timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT barber_subscriptions_price_check CHECK (price_cents IS NULL OR price_cents >= 0),
  CONSTRAINT barber_subscriptions_interval_check
    CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year'))
);

COMMENT ON TABLE barber_subscriptions IS
  'Lo que Stripe le cobra HOY a cada barbería (importe, ciclo, plan) y la marca de reactivación manual. La escribe el webhook de barber y admin.ts (src/lib/barber/cobros.ts).';
