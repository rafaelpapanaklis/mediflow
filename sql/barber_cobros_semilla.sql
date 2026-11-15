-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — SEMILLA del cobro de la barbería que YA paga.
--
-- Se pega DESPUÉS de sql/barber_cobros.sql, una sola vez (es idempotente: si
-- se repite no duplica nada).
--
-- Por qué: el registro de cobros nace hoy. La barbería que contrató por
-- Stripe el 14-nov-2026 (Profesional mensual, $749) pagó ANTES de que
-- existiera, así que no tiene fila hasta su siguiente cobro (14-dic). Sin
-- esta semilla, el admin la contaría como «cortesía» y su MRR en $0 hasta
-- entonces. Con ella:
--   · /admin/barberias la cuenta como «paga» con $749 al mes y «cobrado
--     este mes» $749 (noviembre);
--   · su periodo pagado termina el 14-dic: ese día trabaja completo; si el
--     cobro del 14-dic no entra, el 15-dic a las 00:00 (México) se suspende.
--
-- QUÉ BARBERÍA: la matriz con suscripción de Stripe y estado "active". El
-- 15-nov había UNA (ver la consulta 1). El importe sale de barber_plan_configs
-- (su plan, precio mensual): ningún número de dinero va escrito aquí.
--
-- ⚠️ ANTES DE PEGAR, confirma en Stripe (Customers → la barbería →
--    Subscription) que es MENSUAL, que el periodo actual va del 14-nov al
--    14-dic y que cobró $749. Si algo no cuadra, NO la pegues: dímelo y la
--    ajusto. (Alternativa sin SQL: en Stripe → Developers → Events, reenviar
--    a /api/barber/stripe/webhook el evento invoice.paid del 14-nov, una vez
--    marcado invoice.paid en el endpoint. Usa UNA de las dos, no ambas: la
--    semilla y el evento real tienen ids de factura distintos y el
--    «cobrado este mes» de noviembre contaría $749 dos veces.)
--
-- Plano (sin DO $$) e idempotente.
-- ═══════════════════════════════════════════════════════════════════════

-- 1) VER antes de escribir: debe salir UNA fila (la del 14-nov) con su precio.
SELECT s.id, s.name, s.plan, s."subscriptionStatus", s."stripeSubscriptionId", s."createdAt",
       c."priceMonthly"
  FROM barber_shops s
  LEFT JOIN barber_plan_configs c ON c."planId" = s.plan::text
 WHERE s."parentId" IS NULL
   AND s."stripeSubscriptionId" IS NOT NULL
   AND s."subscriptionStatus" = 'active';

-- 2) El cobro del 14-nov (periodo 14-nov → 14-dic, a mediodía de México para
--    que ninguna zona horaria lo mueva de día). Solo si esa barbería todavía
--    no tiene NINGÚN cobro registrado.
INSERT INTO barber_subscription_payments (
  id, barbershop_id, stripe_invoice_id, stripe_subscription_id, status,
  amount_cents, currency, plan_id, billing_interval,
  period_start, period_end, paid_at
)
SELECT gen_random_uuid()::text,
       s.id,
       'semilla-alta-' || s.id,
       s."stripeSubscriptionId",
       'paid',
       (round(c."priceMonthly" * 100))::integer,
       'mxn',
       s.plan::text,
       'month',
       timestamptz '2026-11-14 12:00:00-06',
       timestamptz '2026-12-14 12:00:00-06',
       timestamptz '2026-11-14 12:00:00-06'
  FROM barber_shops s
  JOIN barber_plan_configs c ON c."planId" = s.plan::text
 WHERE s."parentId" IS NULL
   AND s."stripeSubscriptionId" IS NOT NULL
   AND s."subscriptionStatus" = 'active'
   AND NOT EXISTS (SELECT 1 FROM barber_subscription_payments p WHERE p.barbershop_id = s.id)
ON CONFLICT (stripe_invoice_id) DO NOTHING;

-- 3) Lo que Stripe le cobra hoy (para el MRR), si el webhook todavía no lo
--    guardó. El siguiente evento de su suscripción lo reescribe con el dato
--    exacto de Stripe.
INSERT INTO barber_subscriptions (
  barbershop_id, stripe_subscription_id, stripe_status, price_cents, currency,
  billing_interval, plan_id, current_period_end
)
SELECT s.id,
       s."stripeSubscriptionId",
       'active',
       (round(c."priceMonthly" * 100))::integer,
       'mxn',
       'month',
       s.plan::text,
       timestamptz '2026-12-14 12:00:00-06'
  FROM barber_shops s
  JOIN barber_plan_configs c ON c."planId" = s.plan::text
 WHERE s."parentId" IS NULL
   AND s."stripeSubscriptionId" IS NOT NULL
   AND s."subscriptionStatus" = 'active'
   AND EXISTS (SELECT 1 FROM barber_subscription_payments p WHERE p.barbershop_id = s.id AND p.stripe_invoice_id = 'semilla-alta-' || s.id)
ON CONFLICT (barbershop_id) DO NOTHING;

-- 4) Comprobar: una fila «paid» de 749.00 con periodo hasta el 14-dic.
SELECT p.barbershop_id, p.status, (p.amount_cents / 100.0)::numeric(12,2) AS pesos, p.period_end, t.price_cents, t.billing_interval
  FROM barber_subscription_payments p
  LEFT JOIN barber_subscriptions t ON t.barbershop_id = p.barbershop_id
 WHERE p.stripe_invoice_id LIKE 'semilla-alta-%';
