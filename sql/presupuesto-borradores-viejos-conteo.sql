-- ════════════════════════════════════════════════════════════════════════
-- Facturas BORRADOR fantasma de los presupuestos viejos — CONTEO · SOLO LECTURA
-- Rama feat/factura-doctor-vencimiento (ws1-t3) · 17-sep-2026
-- ════════════════════════════════════════════════════════════════════════
--
-- ⚠️ ESTO NO CAMBIA NADA. Son cuatro SELECT. No hay UPDATE, DELETE ni DDL.
--
-- Qué cuenta: hasta el PR #288 (16-sep-2026), CREAR un presupuesto creaba
-- además una factura en BORRADOR (nota «Generada desde presupuesto P-…»),
-- aunque el paciente todavía no hubiera aceptado nada. Ya no nacen, pero las de
-- antes siguen en la base. Desde el #288 ningún camino crea un borrador ligado
-- a un presupuesto («Generar factura» da PENDIENTE), así que TODO borrador
-- ligado a un presupuesto es, por construcción, uno de los viejos.
--
-- Completa a sql/presupuesto-facturas-borrador-diagnostico.sql (el detalle fila
-- por fila del #288): aquí va el conteo por clínica y ANTIGÜEDAD, y sobre todo
-- las columnas de RIESGO, que son las que deciden qué se puede tocar:
--
--   con_pagos   → tiene `paid` > 0 o al menos un renglón en `payments`.
--   con_cfdi    → tiene `cfdiUuid` o un renglón en `cfdi_records`.
--   con_plan    → un `payment_plans` apunta a ella.
--   tocables    → ninguna de las tres cosas. SOLO estas entran en la propuesta
--                 (sql/presupuesto-borradores-viejos-cancelar-PROPUESTA.sql).
--
-- Dónde ensucian HOY (comprobado en el código, 17-sep-2026):
--   SÍ suman:  Sabina «quién me debe» (total adeudado y ranking) · Pacientes →
--              filtro y KPIs «Con deuda» · la ficha (saldo de cabecera, Estado
--              de cuenta, «Cobrar ahora», que además PRIORIZA el borrador) · el
--              portal por liga /portal/[token] («debes») · Finanzas → ventas.
--   NO suman:  Caja (por cobrar, vencido, facturado) · Finanzas → por cobrar y
--              vencido · Sabina «lo que se escapa» · avisos de saldo por
--              WhatsApp (rechazan borradores) · Reportes · portal /paciente.

-- ── Lo común a las cuatro consultas ────────────────────────────────────
-- (CTE repetido a propósito: cada SELECT se puede pegar y correr solo.)

-- 1) TOTAL GLOBAL: ¿de cuántas hablamos?
WITH fantasmas AS (
  SELECT i."id", i."clinicId", i."total", i."createdAt",
         -- UNA fila por factura aunque dos presupuestos apunten a la misma
         -- (no hay índice único en quotes.invoiceId). Si alguno está ACEPTADO,
         -- manda ACEPTADO: esa factura se va a cobrar.
         COALESCE((SELECT CASE WHEN bool_or(q."status" = 'ACCEPTED') THEN 'ACCEPTED' ELSE min(q."status") END
                     FROM "quotes" q
                    WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId"),
                  '(sin presupuesto)')                                                                    AS estado_presupuesto,
         (i."paid" > 0 OR EXISTS (SELECT 1 FROM "payments" p WHERE p."invoiceId" = i."id"))              AS con_pagos,
         (i."cfdiUuid" IS NOT NULL OR EXISTS (SELECT 1 FROM "cfdi_records" r WHERE r."invoiceId" = i."id")) AS con_cfdi,
         EXISTS (SELECT 1 FROM "payment_plans" pp WHERE pp."invoiceId" = i."id")                          AS con_plan
  FROM "invoices" i
  WHERE i."status" = 'DRAFT'
    AND (EXISTS (SELECT 1 FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId")
         OR i."notes" LIKE 'Generada desde presupuesto%')
)
SELECT
  COUNT(*)                                                        AS borradores_fantasma,
  COUNT(DISTINCT "clinicId")                                      AS clinicas,
  ROUND(SUM("total")::numeric, 2)                                 AS total_mxn,
  COUNT(*) FILTER (WHERE con_pagos)                               AS con_pagos,
  COUNT(*) FILTER (WHERE con_cfdi)                                AS con_cfdi,
  COUNT(*) FILTER (WHERE con_plan)                                AS con_plan,
  COUNT(*) FILTER (WHERE NOT con_pagos AND NOT con_cfdi AND NOT con_plan) AS tocables,
  MIN("createdAt")::date                                          AS la_mas_vieja,
  MAX("createdAt")::date                                          AS la_mas_nueva
FROM fantasmas;

-- 2) POR CLÍNICA Y ANTIGÜEDAD
WITH fantasmas AS (
  SELECT i."id", i."clinicId", i."total", i."createdAt",
         -- UNA fila por factura aunque dos presupuestos apunten a la misma
         -- (no hay índice único en quotes.invoiceId). Si alguno está ACEPTADO,
         -- manda ACEPTADO: esa factura se va a cobrar.
         COALESCE((SELECT CASE WHEN bool_or(q."status" = 'ACCEPTED') THEN 'ACCEPTED' ELSE min(q."status") END
                     FROM "quotes" q
                    WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId"),
                  '(sin presupuesto)')                                                                    AS estado_presupuesto,
         (i."paid" > 0 OR EXISTS (SELECT 1 FROM "payments" p WHERE p."invoiceId" = i."id"))              AS con_pagos,
         (i."cfdiUuid" IS NOT NULL OR EXISTS (SELECT 1 FROM "cfdi_records" r WHERE r."invoiceId" = i."id")) AS con_cfdi,
         EXISTS (SELECT 1 FROM "payment_plans" pp WHERE pp."invoiceId" = i."id")                          AS con_plan
  FROM "invoices" i
  WHERE i."status" = 'DRAFT'
    AND (EXISTS (SELECT 1 FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId")
         OR i."notes" LIKE 'Generada desde presupuesto%')
)
SELECT
  c."name"                                                        AS clinica,
  CASE
    WHEN f."createdAt" >= now() - interval '30 days'  THEN '1 · menos de 30 días'
    WHEN f."createdAt" >= now() - interval '90 days'  THEN '2 · 30 a 90 días'
    WHEN f."createdAt" >= now() - interval '180 days' THEN '3 · 90 a 180 días'
    ELSE                                                   '4 · más de 180 días'
  END                                                             AS antiguedad,
  COUNT(*)                                                        AS borradores,
  ROUND(SUM(f."total")::numeric, 2)                               AS total_mxn,
  COUNT(*) FILTER (WHERE f.con_pagos)                             AS con_pagos,
  COUNT(*) FILTER (WHERE f.con_cfdi)                              AS con_cfdi,
  COUNT(*) FILTER (WHERE f.con_plan)                              AS con_plan
FROM fantasmas f
JOIN "clinics" c ON c."id" = f."clinicId"
GROUP BY c."id", c."name", 2
ORDER BY c."name", 2;

-- 3) POR CLÍNICA Y ESTADO DEL PRESUPUESTO — la que decide qué hacer
--    ACCEPTED                     → el paciente aceptó: ese borrador SÍ se va a cobrar. No se toca.
--    DRAFT / PRESENTED            → el paciente aún no contesta: deuda que no existe.
--    REJECTED / EXPIRED           → el paciente no aceptó: deuda que no va a existir.
--    (sin presupuesto)            → el presupuesto se borró o se perdió la liga.
WITH fantasmas AS (
  SELECT i."id", i."clinicId", i."total", i."createdAt",
         -- UNA fila por factura aunque dos presupuestos apunten a la misma
         -- (no hay índice único en quotes.invoiceId). Si alguno está ACEPTADO,
         -- manda ACEPTADO: esa factura se va a cobrar.
         COALESCE((SELECT CASE WHEN bool_or(q."status" = 'ACCEPTED') THEN 'ACCEPTED' ELSE min(q."status") END
                     FROM "quotes" q
                    WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId"),
                  '(sin presupuesto)')                                                                    AS estado_presupuesto,
         (i."paid" > 0 OR EXISTS (SELECT 1 FROM "payments" p WHERE p."invoiceId" = i."id"))              AS con_pagos,
         (i."cfdiUuid" IS NOT NULL OR EXISTS (SELECT 1 FROM "cfdi_records" r WHERE r."invoiceId" = i."id")) AS con_cfdi,
         EXISTS (SELECT 1 FROM "payment_plans" pp WHERE pp."invoiceId" = i."id")                          AS con_plan
  FROM "invoices" i
  WHERE i."status" = 'DRAFT'
    AND (EXISTS (SELECT 1 FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId")
         OR i."notes" LIKE 'Generada desde presupuesto%')
)
SELECT
  c."name"                                                        AS clinica,
  f.estado_presupuesto,
  COUNT(*)                                                        AS borradores,
  ROUND(SUM(f."total")::numeric, 2)                               AS total_mxn,
  COUNT(*) FILTER (WHERE NOT f.con_pagos AND NOT f.con_cfdi AND NOT f.con_plan) AS tocables,
  COUNT(*) FILTER (WHERE f.con_pagos OR f.con_cfdi OR f.con_plan)               AS a_mano
FROM fantasmas f
JOIN "clinics" c ON c."id" = f."clinicId"
GROUP BY c."id", c."name", f.estado_presupuesto
ORDER BY c."name", borradores DESC;

-- 4) LAS QUE NO SE TOCAN EN MASA: con pagos, con CFDI o con plan de pagos.
--    Se revisan una por una, en pantalla. Lo esperable es que esta lista salga
--    vacía o casi: un borrador no se puede cobrar sin confirmarlo antes (y al
--    confirmarlo deja de ser borrador), y no se timbra un borrador.
SELECT
  c."name"                                     AS clinica,
  i."invoiceNumber"                            AS factura,
  i."createdAt"::date                          AS creada,
  p."firstName" || ' ' || p."lastName"         AS paciente,
  (SELECT string_agg(q."folio" || ' (' || q."status" || ')', ', ')
     FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId") AS presupuestos,
  i."total"                                    AS total_mxn,
  i."paid"                                     AS pagado,
  (SELECT COUNT(*) FROM "payments" x WHERE x."invoiceId" = i."id")      AS pagos,
  i."cfdiUuid"                                 AS cfdi_uuid,
  (SELECT COUNT(*) FROM "cfdi_records" r WHERE r."invoiceId" = i."id")  AS cfdi_registros,
  (SELECT COUNT(*) FROM "payment_plans" pp WHERE pp."invoiceId" = i."id") AS planes
FROM "invoices" i
JOIN "clinics"  c ON c."id" = i."clinicId"
JOIN "patients" p ON p."id" = i."patientId"
WHERE i."status" = 'DRAFT'
  AND (EXISTS (SELECT 1 FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId")
       OR i."notes" LIKE 'Generada desde presupuesto%')
  AND (
    i."paid" > 0
    OR EXISTS (SELECT 1 FROM "payments" x WHERE x."invoiceId" = i."id")
    OR i."cfdiUuid" IS NOT NULL
    OR EXISTS (SELECT 1 FROM "cfdi_records" r WHERE r."invoiceId" = i."id")
    OR EXISTS (SELECT 1 FROM "payment_plans" pp WHERE pp."invoiceId" = i."id")
  )
ORDER BY c."name", i."createdAt" DESC;
