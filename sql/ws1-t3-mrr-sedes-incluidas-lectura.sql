-- WS1-T3 · MRR: las sedes incluidas en el plan de su madre valen $0.
-- SOLO LECTURA. No escribe nada: sólo SELECT. Sirve para ver, con los datos de
-- producción, cuánto baja el MRR de /admin/clinics y QUÉ clínicas se dejan de
-- contar, antes de integrar la rama fix/mrr-sedes-incluidas.
--
-- Reproduce el criterio de `findIncludedBranchIds` (src/lib/admin/mrr-core.ts):
--   · huella de sede (como la crea POST /api/clinics): subscriptionStatus =
--     'active' y SIN cobro propio — monthlyPrice <= 0 o NULL, sin
--     stripeSubscriptionId, sin paypalSubscriptionId, sin subscriptionId
--     (legacy) y sin nextBillingDate;
--   · y una MADRE del mismo dueño (users.role = 'SUPER_ADMIN', isActive): otra
--     clínica con cobro propio, o —si ninguna del grupo lo tiene— la activa más
--     antigua del grupo.
-- Precio de lista: plan_configs."priceMxnMonthly" (lo mismo que loadPlanPrices).
-- Universo: el de /admin/clinics (no archivadas, subscriptionStatus = 'active').

WITH c AS (
  SELECT
    id, name, plan::text AS plan, "createdAt", "subscriptionStatus", "archivedAt",
    COALESCE("monthlyPrice", 0) AS monthly_price,
    (COALESCE("monthlyPrice", 0) > 0
      OR "stripeSubscriptionId" IS NOT NULL
      OR "paypalSubscriptionId" IS NOT NULL
      OR "subscriptionId" IS NOT NULL
      OR "nextBillingDate" IS NOT NULL) AS cobro_propio
  FROM clinics
),
duenos AS (
  SELECT DISTINCT u."supabaseId", u."clinicId"
  FROM users u
  WHERE u.role = 'SUPER_ADMIN' AND u."isActive" = true
),
grupo AS (
  -- Por dueño: ¿alguna pagadora? y, si no, la activa más antigua (madre de respaldo).
  SELECT
    d."supabaseId",
    COUNT(*)                                   AS clinicas,
    BOOL_OR(c.cobro_propio)                    AS hay_pagadora,
    (ARRAY_AGG(c.id ORDER BY c."createdAt") FILTER (WHERE c."subscriptionStatus" = 'active'))[1] AS madre_respaldo
  FROM duenos d JOIN c ON c.id = d."clinicId"
  GROUP BY d."supabaseId"
),
sedes AS (
  SELECT DISTINCT c.id
  FROM c
  JOIN duenos d ON d."clinicId" = c.id
  JOIN grupo  g ON g."supabaseId" = d."supabaseId"
  WHERE g.clinicas >= 2
    AND c."subscriptionStatus" = 'active'
    AND NOT c.cobro_propio
    AND (g.hay_pagadora OR (g.madre_respaldo IS NOT NULL AND c.id <> g.madre_respaldo))
),
valuadas AS (
  SELECT
    c.id, c.name, c.plan, c.monthly_price,
    COALESCE(p."priceMxnMonthly", 0)                                         AS lista,
    CASE WHEN c.monthly_price > 0 THEN c.monthly_price ELSE COALESCE(p."priceMxnMonthly", 0) END AS antes,
    (s.id IS NOT NULL)                                                       AS sede_incluida,
    CASE WHEN c.monthly_price > 0 THEN c.monthly_price
         WHEN s.id IS NOT NULL    THEN 0
         ELSE COALESCE(p."priceMxnMonthly", 0) END                           AS despues
  FROM c
  LEFT JOIN plan_configs p ON p."planId" = c.plan
  LEFT JOIN sedes s        ON s.id = c.id
  WHERE c."archivedAt" IS NULL AND c."subscriptionStatus" = 'active'
)
-- Una fila por clínica activa; las tres últimas columnas son los TOTALES
-- (iguales en todas las filas): el MRR antes, después y cuántas sedes se
-- dejan de contar.
SELECT
  id, name, plan, monthly_price, lista, antes, despues, sede_incluida,
  SUM(antes)   OVER () AS mrr_antes_total,
  SUM(despues) OVER () AS mrr_despues_total,
  COUNT(*) FILTER (WHERE sede_incluida) OVER () AS sedes_incluidas_total
FROM valuadas
ORDER BY sede_incluida DESC, plan, name;
