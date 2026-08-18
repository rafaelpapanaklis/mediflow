-- ─────────────────────────────────────────────────────────────────────────────
-- SUB-01 · ¿Qué clínicas están hoy "activas para siempre" sin volver a pagar?
--
-- SOLO LECTURA. No hay un solo INSERT/UPDATE/DELETE. Se puede pegar entero en el
-- editor SQL de Supabase.
--
-- QUÉ PASABA: `activatePlatformSubscription` atiende igual el pago con tarjeta y
-- el `checkout.session.async_payment_succeeded` de SPEI/OXXO, y en los dos casos
-- escribe subscriptionStatus = 'active'. Pero en SPEI/OXXO no hay suscripción de
-- Stripe: nadie renueva y nadie avisa. Y el gate (isPlanExpired) da por viva
-- cualquier clínica 'active' mire la fecha que mire. Un pago único = acceso
-- indefinido. Además /admin/payments lista las morosas con `!= 'active'`, así que
-- estas clínicas ni salían en la lista.
--
-- La consulta 1 es la lista que el cron nuevo va a caducar EN SU PRIMERA PASADA.
-- Conviene mirarla ANTES de que corra: es gente a la que se le va a cortar el
-- panel. La 2 y la 3 existen para poder confiar en la 1.
-- ─────────────────────────────────────────────────────────────────────────────


-- ══ 1 · LO QUE EL CRON VA A CADUCAR EN LA PRIMERA PASADA ════════════════════
-- Mismo criterio, literal, que manualLapseWhere() en
-- src/lib/billing/manual-subscription-lapse.ts:
--     active + sin suscripción de Stripe + nextBillingDate NO NULA y pasada
--     + trialEndsAt pasado
-- Las dos fechas en el pasado equivale a manualPaidUntil() < now, que es el
-- MÁXIMO de las dos y es el helper que ya usa el prorrateo.

SELECT
  id                                                          AS clinic_id,
  name                                                        AS clinica,
  plan,
  "monthlyPrice"                                              AS precio_mensual,
  "subscriptionStatus"                                        AS estado_hoy,
  "nextBillingDate"::date                                     AS vencio_el,
  (current_date - "nextBillingDate"::date)                     AS dias_de_barra_libre,
  "trialEndsAt"::date                                         AS trial_acabo_el,
  "stripeCustomerId" IS NOT NULL                              AS paso_por_stripe,
  "createdAt"::date                                           AS se_dio_de_alta
FROM clinics
WHERE "subscriptionStatus"   = 'active'
  AND "stripeSubscriptionId" IS NULL
  AND "nextBillingDate"      IS NOT NULL
  AND "nextBillingDate"      < now()
  AND "trialEndsAt"          < now()
ORDER BY "nextBillingDate" ASC;


-- ══ 2 · EL DINERO Y EL RESUMEN ══════════════════════════════════════════════
-- `dejaria_de_contar_en_mrr` es el efecto colateral que hay que ver venir: el
-- MRR de /admin solo suma subscriptionStatus = 'active' (src/lib/admin/mrr-core.ts),
-- así que al pasar a past_due estas clínicas SALEN del MRR. El número va a bajar,
-- y va a bajar porque antes estaba inflado con gente que no paga.

SELECT
  count(*)                                                     AS clinicas,
  round(sum(COALESCE("monthlyPrice", 0))::numeric, 2)          AS dejaria_de_contar_en_mrr,
  round(sum(
    COALESCE("monthlyPrice", 0)
    * greatest(0, (current_date - "nextBillingDate"::date)) / 30.0
  )::numeric, 2)                                               AS regalado_aprox_hasta_hoy,
  max(current_date - "nextBillingDate"::date)                   AS peor_caso_dias
FROM clinics
WHERE "subscriptionStatus"   = 'active'
  AND "stripeSubscriptionId" IS NULL
  AND "nextBillingDate"      IS NOT NULL
  AND "nextBillingDate"      < now()
  AND "trialEndsAt"          < now();


-- ══ 3 · EL CONTROL DE SEGURIDAD: las SEDES que el cron NO debe tocar ════════
-- ESTA ES LA CONSULTA IMPORTANTE ANTES DE ACTIVAR EL CRON.
--
-- Una sucursal creada desde /api/clinics nace con la MISMA forma que un pagador
-- manual vencido: active, sin stripeSubscriptionId, monthlyPrice 0 y
-- trialEndsAt = el instante de creación (ya pasado). Va incluida en la
-- suscripción de la clínica madre. Lo único que la distingue es que
-- nextBillingDate se queda NULL.
--
-- Lo que hay que comprobar: que estas filas NO aparecen en la consulta 1. Si
-- alguna sede tuviera nextBillingDate con fecha, saldría en la 1 y el cron la
-- suspendería. Si eso pasa, PARAR y avisar antes de activar el cron.

SELECT
  id                                     AS clinic_id,
  name                                   AS clinica,
  plan,
  "monthlyPrice"                         AS precio_mensual,
  "nextBillingDate"                      AS next_billing_date_debe_ser_null,
  "trialEndsAt"::date                    AS trial_acabo_el,
  "createdAt"::date                      AS se_dio_de_alta,
  CASE
    WHEN "nextBillingDate" IS NULL THEN 'a salvo del cron'
    ELSE 'PELIGRO: el cron la caducaria'
  END                                    AS veredicto
FROM clinics
WHERE "subscriptionStatus"   = 'active'
  AND "stripeSubscriptionId" IS NULL
  AND COALESCE("monthlyPrice", 0) = 0
ORDER BY veredicto DESC, "createdAt" DESC;


-- ══ 4 · FOTO GENERAL: reparto de estados, para contexto ═════════════════════

SELECT
  COALESCE("subscriptionStatus", '(null)')                     AS estado,
  count(*)                                                     AS clinicas,
  count(*) FILTER (WHERE "stripeSubscriptionId" IS NOT NULL)    AS con_suscripcion_stripe,
  count(*) FILTER (WHERE "stripeSubscriptionId" IS NULL)        AS sin_suscripcion_stripe,
  count(*) FILTER (
    WHERE "stripeSubscriptionId" IS NULL
      AND "nextBillingDate" IS NOT NULL
      AND "nextBillingDate" < now()
  )                                                            AS manuales_vencidas
FROM clinics
GROUP BY COALESCE("subscriptionStatus", '(null)')
ORDER BY clinicas DESC;
