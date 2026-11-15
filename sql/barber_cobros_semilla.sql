-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — SEMILLA del cobro de UNA barbería que ya paga.
--
-- ORDEN OBLIGATORIO (no te saltes ninguno):
--   1. Stripe → Developers → Webhooks → el endpoint que termina en
--      /api/barber/stripe/webhook → marcar invoice.paid e invoice.payment_failed.
--   2. Pegar sql/barber_cobros.sql.
--   3. Correr la CONSULTA 1 de abajo y copiar el id de la barbería.
--   4. Poner ese id en la línea «WHERE s.id = …» del paso 2 (es el único lugar) y
--      pegar el paso 2. Correr la CONSULTA 3 para comprobar.
--   5. Tras su siguiente cobro (14-dic), comprobar que aparece una fila NUEVA
--      en barber_subscription_payments (consulta 3 sin el filtro de semilla).
--
-- Por qué: el registro de cobros nace hoy. La barbería que contrató por
-- Stripe el 14-nov-2026 pagó ANTES de que existiera y no tiene fila hasta su
-- siguiente cobro; sin la semilla el admin la cuenta como «cortesía» y $0.
--
-- Solo siembra la barbería cuyo id pegues. Si dejas el texto de ejemplo tal
-- cual, no inserta NADA. Además exige que sea matriz, con suscripción de
-- Stripe, en "active" y sin ningún cobro registrado todavía.
--
-- El importe sale de barber_plan_configs (su plan, precio mensual): ningún
-- número de dinero va escrito aquí. Antes de pegarla, confirma en Stripe que
-- es MENSUAL, de $749, y la fecha del periodo actual (14-nov → 14-dic). La
-- hora no importa para el corte: cuenta el día de México, y si Stripe ya
-- renovó el periodo y sigue «active», no se corta aunque el cobro del 14-dic
-- llegue tarde.
--
-- Alternativa sin SQL: reenviar desde Stripe (Developers → Events) el
-- invoice.paid del 14-nov a /api/barber/stripe/webhook, después del paso 1.
-- UNA de las dos, no ambas: la semilla y el evento real tienen ids de
-- factura distintos y noviembre contaría $749 dos veces.
--
-- Plano (sin DO $$) e idempotente: si se pega dos veces no duplica nada.
-- ═══════════════════════════════════════════════════════════════════════

-- 1) CONSULTA: a quién se sembraría. Copia el «id» de la barbería del 14-nov.
SELECT s.id, s.name, s.plan, s."subscriptionStatus", s."stripeSubscriptionId", s."createdAt",
       c."priceMonthly",
       (SELECT count(*) FROM barber_subscription_payments p WHERE p.barbershop_id = s.id) AS cobros_registrados
  FROM barber_shops s
  LEFT JOIN barber_plan_configs c ON c."planId" = s.plan::text
 WHERE s."parentId" IS NULL
   AND s."stripeSubscriptionId" IS NOT NULL
   AND s."subscriptionStatus" = 'active';

-- 2) SEMILLA de UNA barbería: su cobro del 14-nov (periodo 14-nov → 14-dic, a
--    mediodía de México para que ninguna zona horaria lo mueva de día) y lo
--    que Stripe le cobra hoy. ⬇ Pon el id de la consulta 1 entre las comillas de la
--    línea «WHERE s.id = …» (es el ÚNICO lugar).
WITH objetivo AS (
  SELECT s.id,
         s."stripeSubscriptionId" AS sub_id,
         s.plan::text            AS plan_id,
         (round(c."priceMonthly" * 100))::integer AS cents
    FROM barber_shops s
    JOIN barber_plan_configs c ON c."planId" = s.plan::text
   WHERE s.id = 'PEGA_AQUI_EL_ID'
     AND s."parentId" IS NULL
     AND s."stripeSubscriptionId" IS NOT NULL
     AND s."subscriptionStatus" = 'active'
     AND NOT EXISTS (SELECT 1 FROM barber_subscription_payments p WHERE p.barbershop_id = s.id)
),
pago AS (
  INSERT INTO barber_subscription_payments (
    id, barbershop_id, stripe_invoice_id, stripe_subscription_id, status,
    amount_cents, currency, plan_id, billing_interval,
    period_start, period_end, paid_at
  )
  SELECT gen_random_uuid()::text, o.id, 'semilla-alta-' || o.id, o.sub_id, 'paid',
         o.cents, 'mxn', o.plan_id, 'month',
         timestamptz '2026-11-14 12:00:00-06',
         timestamptz '2026-12-14 12:00:00-06',
         timestamptz '2026-11-14 12:00:00-06'
    FROM objetivo o
  ON CONFLICT (stripe_invoice_id) DO NOTHING
  RETURNING barbershop_id
)
INSERT INTO barber_subscriptions (
  barbershop_id, stripe_subscription_id, stripe_status, price_cents, currency,
  billing_interval, plan_id, current_period_end
)
SELECT o.id, o.sub_id, 'active', o.cents, 'mxn', 'month', o.plan_id, timestamptz '2026-12-14 12:00:00-06'
  FROM objetivo o
  JOIN pago ON pago.barbershop_id = o.id
ON CONFLICT (barbershop_id) DO NOTHING;

-- 3) COMPROBAR: una fila «paid» de 749.00 con periodo hasta el 14-dic, solo
--    de esa barbería.
SELECT p.barbershop_id, p.status, (p.amount_cents / 100.0)::numeric(12,2) AS pesos, p.period_end,
       t.price_cents, t.billing_interval
  FROM barber_subscription_payments p
  LEFT JOIN barber_subscriptions t ON t.barbershop_id = p.barbershop_id
 WHERE p.stripe_invoice_id LIKE 'semilla-alta-%';
