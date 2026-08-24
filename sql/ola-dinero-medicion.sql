-- ═══════════════════════════════════════════════════════════════════
-- OLA DINERO — SQL de MEDICIÓN (solo lectura; 2026-08-23)
-- Repite la comprobación de los 6 P1 de dinero de la auditoría del panel
-- (PANEL_AUDIT_2026-08-12: FIN-01, SUB-04, FIN-03, FIN-04, FIN-05, SUB-02)
-- contra Supabase. NO modifica nada: son SELECTs.
--
-- Medido el 23-ago-2026 antes del arreglo:
--   · 170 facturas; 159 de "Rafael Clinica" (cmn6soeaw0000t17xgljxc2iq),
--     la única que pasa de 100 (caso de prueba de FIN-04).
--   · 0 de 170 facturas con "dueDate" (FIN-03: nadie lo escribía).
--   · 2 reembolsos vivos: $3,500 (abr-2026) y $500 (jul-2026) (FIN-01).
--
-- Pegar en Supabase → SQL Editor. Reemplazar :clinic donde aplique.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Facturas por clínica (¿quién pasa de 100?) ─────────────────────
SELECT c."name", i."clinicId", COUNT(*) AS facturas
FROM "invoices" i
JOIN "clinics" c ON c."id" = i."clinicId"
GROUP BY c."name", i."clinicId"
ORDER BY facturas DESC;

-- 2) FIN-03 — ¿cuántas facturas tienen fecha de vencimiento? ───────────
-- Esperado hoy: 0 de 170. Tras el fix SIGUE en 0 hasta que alguien cree una
-- factura con "Vence el": no hay backfill ni default a propósito.
SELECT COUNT(*) FILTER (WHERE "dueDate" IS NOT NULL) AS con_vencimiento,
       COUNT(*)                                     AS total
FROM "invoices";

-- 3) FIN-01 — los reembolsos vivos (Payment.method = 'refund', monto POSITIVO)
SELECT p."id", p."amount", p."paidAt",
       to_char(p."paidAt" AT TIME ZONE 'America/Mexico_City', 'YYYY-MM') AS mes_mx,
       i."invoiceNumber", i."status" AS invoice_status, i."clinicId"
FROM "payments" p
JOIN "invoices" i ON i."id" = p."invoiceId"
WHERE p."method" = 'refund'
ORDER BY p."paidAt";

-- 4) FIN-01 — ingresos por mes ANTES vs DESPUÉS del criterio (últimos 6 meses)
-- "antes"  = lo que sumaban Reportes/Finanzas/Caja: TODO Payment.
-- "despues" = criterio de referencia (home/revenue): sin refund y sin facturas
--            CANCELLED. La diferencia por mes debe ser EXACTAMENTE el reembolso
--            de ese mes ($3,500 en 2026-04, $500 en 2026-07) — ni más ni menos,
--            salvo que hubiera pagos sobre facturas canceladas (ver 5).
SELECT to_char(p."paidAt" AT TIME ZONE 'America/Mexico_City', 'YYYY-MM') AS mes_mx,
       SUM(p."amount")                                                  AS antes,
       SUM(p."amount") FILTER (WHERE p."method" <> 'refund'
                                 AND i."status" <> 'CANCELLED')         AS despues,
       SUM(p."amount") FILTER (WHERE p."method" = 'refund')             AS reembolsos
FROM "payments" p
JOIN "invoices" i ON i."id" = p."invoiceId"
WHERE i."clinicId" = :clinic
  AND p."paidAt" >= date_trunc('month', now() AT TIME ZONE 'America/Mexico_City') - INTERVAL '5 months'
GROUP BY 1
ORDER BY 1;

-- 5) Pagos sobre facturas CANCELADAS (si hay alguno, la resta del punto 4
--    incluye también estos importes). Esperado: 0 filas — cancelar exige paid = 0.
SELECT p."id", p."amount", p."method", p."paidAt", i."invoiceNumber", i."clinicId"
FROM "payments" p
JOIN "invoices" i ON i."id" = p."invoiceId"
WHERE i."status" = 'CANCELLED';

-- 6) FIN-04 — KPIs de Facturas: ANTES (sobre las 100 más recientes, como la
--    página) vs DESPUÉS (aggregate sobre toda la clínica). Deben DIFERIR en
--    la clínica de 159 facturas.
WITH recientes AS (
  SELECT * FROM "invoices"
  WHERE "clinicId" = :clinic
  ORDER BY "createdAt" DESC
  LIMIT 100
)
SELECT 'antes (100 recientes)' AS calculo,
       SUM("paid")    FILTER (WHERE "status" = 'PAID')                         AS total_cobrado,
       SUM("balance") FILTER (WHERE "status" IN ('PENDING', 'PARTIAL'))        AS por_cobrar,
       SUM("balance") FILTER (WHERE "status" = 'OVERDUE')                      AS vencido
FROM recientes
UNION ALL
SELECT 'despues (toda la clinica)',
       SUM("paid")    FILTER (WHERE "status" NOT IN ('DRAFT', 'CANCELLED')),
       SUM("balance") FILTER (WHERE "status" NOT IN ('DRAFT', 'CANCELLED') AND "balance" > 0),
       SUM("balance") FILTER (WHERE "status" NOT IN ('DRAFT', 'CANCELLED') AND "balance" > 0
                                AND "dueDate" < date_trunc('day', now() AT TIME ZONE 'America/Mexico_City') AT TIME ZONE 'America/Mexico_City')
FROM "invoices"
WHERE "clinicId" = :clinic;

-- 7) FIN-05 — presupuestos con factura ligada cuyo total NO coincide con la
--    factura (el síntoma: se editó el presupuesto y la factura se quedó vieja).
--    Solo informativo: el fix NO corrige datos históricos, evita que vuelva a pasar.
SELECT q."folio", q."status" AS quote_status, q."total" AS quote_total,
       i."invoiceNumber", i."status" AS invoice_status, i."total" AS invoice_total, i."paid",
       q."clinicId"
FROM "quotes" q
JOIN "invoices" i ON i."id" = q."invoiceId"
WHERE q."invoiceId" IS NOT NULL
  AND round(q."total"::numeric, 2) <> round(i."total"::numeric, 2)
ORDER BY q."updatedAt" DESC;

-- 8) SUB-02 — clínicas con más de una suscripción viva en Stripe no se ven
--    desde la BD (solo guarda la última en "stripeSubscriptionId"): revisar
--    en Stripe → Customers → suscripciones activas por customer. Lo que sí se
--    ve aquí: el rastro de checkouts creados por clínica (audit_logs).
SELECT "clinicId", COUNT(*) AS checkouts, MIN("createdAt") AS primero, MAX("createdAt") AS ultimo
FROM "audit_logs"
WHERE "entityType" = 'subscription' AND "action" = 'create'
GROUP BY "clinicId"
HAVING COUNT(*) > 1
ORDER BY checkouts DESC;
