-- ─────────────────────────────────────────────────────────────────────────────
-- SUB-02 · ¿Qué clínicas traen el "acceso hasta" (trialEndsAt) atrasado
--          respecto a su próximo cobro (nextBillingDate) con la suscripción
--          viva? ¿Cuántas son?
--
-- SOLO LECTURA. No hay un solo INSERT/UPDATE/DELETE. Se puede pegar entero en
-- el editor SQL de Supabase (cada bloque devuelve su propia tabla; si el editor
-- solo muestra la última, corre los bloques uno por uno).
--
-- QUÉ PASABA: el handler de customer.subscription.updated escribía
-- nextBillingDate (fin de periodo real de Stripe) pero NUNCA trialEndsAt, que
-- es la fecha que mira el gate (isPlanExpired, src/lib/plan-status.ts). Desde
-- la primera renovación trialEndsAt se quedaba en la fecha de la contratación
-- y se atrasaba un mes por ciclo. Con `active` no bloqueaba a nadie, pero
-- /admin la pintaba "EXPIRADO" con un cálculo propio, y el primer past_due de
-- un reintento la habría sacado al instante con el periodo pagado.
-- /admin/billing (verify_payment, activate_clinic) y /admin/subscriptions
-- hacían lo mismo al activar a mano. El código ya escribe las dos fechas
-- juntas; esto lista las filas que quedaron de antes.
--
-- El UPDATE va aparte y es reversible: sql/sub-02-renovacion-trialEndsAt-update.sql
-- ─────────────────────────────────────────────────────────────────────────────


-- ══ 1 · LA LISTA — misma condición, literal, que el UPDATE ═══════════════════
--   suscripción viva (ACTIVE_SUBSCRIPTION_STATUSES = active/trialing/paid)
--   + nextBillingDate fijado (las SEDES nunca lo tienen: quedan fuera)
--   + trialEndsAt más de UN DÍA por detrás (el placeholder de la contratación
--     difiere de Stripe por segundos; eso no es un desfase)

SELECT
  id                                                    AS clinic_id,
  name                                                  AS clinica,
  plan,
  "subscriptionStatus"                                  AS estado,
  "stripeSubscriptionId" IS NOT NULL                    AS tarjeta_stripe,
  "trialEndsAt"                                         AS acceso_hasta_hoy,
  "nextBillingDate"                                     AS proximo_cobro,
  ("nextBillingDate"::date - "trialEndsAt"::date)       AS dias_de_desfase,
  CASE WHEN "trialEndsAt" < now() THEN 'SÍ' ELSE 'no' END AS acceso_hasta_ya_paso
FROM clinics
WHERE "subscriptionStatus" IN ('active', 'trialing', 'paid')
  AND "nextBillingDate" IS NOT NULL
  AND "trialEndsAt" < "nextBillingDate" - interval '1 day'
ORDER BY dias_de_desfase DESC, name;


-- ══ 2 · CUÁNTAS SON ══════════════════════════════════════════════════════════
--   con_acceso_hasta_ya_pasado = las que HOY quedarían fuera al instante si un
--   reintento de Stripe les dejara subscriptionStatus en past_due (la bomba).

SELECT
  count(*)                                                     AS clinicas_desfasadas,
  count(*) FILTER (WHERE "trialEndsAt" < now())                AS con_acceso_hasta_ya_pasado,
  count(*) FILTER (WHERE "stripeSubscriptionId" IS NOT NULL)   AS por_tarjeta_stripe,
  count(*) FILTER (WHERE "stripeSubscriptionId" IS NULL)       AS activadas_a_mano_o_spei,
  max("nextBillingDate"::date - "trialEndsAt"::date)           AS desfase_maximo_dias
FROM clinics
WHERE "subscriptionStatus" IN ('active', 'trialing', 'paid')
  AND "nextBillingDate" IS NOT NULL
  AND "trialEndsAt" < "nextBillingDate" - interval '1 day';


-- ══ 3 · MENTA DENTAL — el caso que lo destapó; debe aparecer en la lista 1 ═══

SELECT id, name, plan, "subscriptionStatus", "stripeSubscriptionId", "trialEndsAt", "nextBillingDate"
FROM clinics
WHERE "stripeSubscriptionId" = 'sub_1TwoyNEgO7AoChdPSsNQM5kZ'
   OR name ILIKE '%menta%';


-- ══ 4 · EFECTO A CONOCER — clínicas que pagan y HOY tienen trialEndsAt por delante
--   Hasta este cambio, el marketplace y las especialidades del sidebar decidían
--   "en trial" SOLO por la fecha: a una clínica que paga se le abrían TODAS las
--   especialidades durante su primer mes (trialEndsAt = fin del periodo pagado)
--   y se le saltaba el gate del plan. Ahora "en trial" exige NO tener
--   suscripción viva (isInTrial), así que estas clínicas ven desde el deploy
--   solo lo de su plan y lo que compraron — igual que cualquier clínica que
--   paga a partir de su segundo mes. Es la lista de quién podría notarlo
--   ("¿dónde quedó Ortodoncia?"). Después del backfill esta lista crece a
--   TODAS las que pagan, y es lo correcto.

SELECT id, name, plan, "subscriptionStatus",
       "trialEndsAt"::date                        AS acceso_hasta,
       ("trialEndsAt"::date - current_date)       AS dias_que_le_quedaban_de_todo_abierto
FROM clinics
WHERE "subscriptionStatus" IN ('active', 'trialing', 'paid')
  AND "trialEndsAt" > now()
ORDER BY "trialEndsAt";
