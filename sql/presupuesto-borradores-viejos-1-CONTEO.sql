-- ════════════════════════════════════════════════════════════════════════
-- Borradores fantasma de presupuestos viejos · 1 de 2 · CONTEO · SOLO LECTURA
-- Rama fix/borradores-viejos-sql (ws1-t4) · 17-sep-2026
-- Sustituye a sql/presupuesto-borradores-viejos-conteo.sql (ws1-t3), que se
-- queda en el repo como estaba. Qué le fallaba a aquél, abajo del todo.
-- ════════════════════════════════════════════════════════════════════════
--
-- ⚠️ ESTO NO CAMBIA NADA. Son cinco SELECT (A–E) y uno opcional (F). No hay
--    UPDATE, DELETE ni DDL.
-- ⚠️ EL EDITOR DE SUPABASE SOLO ENSEÑA EL RESULTADO DE LA ÚLTIMA SENTENCIA. Si
--    pegas el archivo entero verás la consulta E, que es LA QUE DECIDE. Las
--    demás se corren seleccionándolas de una en una (cada una funciona sola).
--
-- ── De qué hablamos ─────────────────────────────────────────────────────
-- Entre el 29-jun-2026 (commit fa5b437a) y el 16-sep-2026 09:02 (PR #288 en
-- main), CREAR un presupuesto creaba además una factura en BORRADOR con la nota
-- «Generada desde presupuesto P-…», aunque el paciente no hubiera aceptado nada.
-- Aceptar, rechazar o dejar vencer el presupuesto NUNCA tocó esa factura.
-- Desde el #288 ningún camino crea un borrador ligado a un presupuesto.
--
-- ── Qué le pasaría a cada una («destino»), por orden de prioridad ───────
--   SE QUEDA · tiene pagos          `paid` > 0 o algún renglón en `payments`
--   SE QUEDA · tiene CFDI           `cfdiUuid` o algún renglón en `cfdi_records`
--                                   (del estado que sea: también los cancelados)
--   SE QUEDA · plan de pagos        un `payment_plans` apunta a ella
--   SE QUEDA · ligada a una cita    `appointmentId` puesto (no debería: el alta
--                                   desde presupuesto no lo escribe)
--   SE QUEDA · presupuesto aceptado algún presupuesto ACEPTADO apunta a ella:
--                                   es la factura que se va a cobrar
--   SE QUEDA · importe cambiado     su total ya no es el del presupuesto (más de
--                                   $1 de diferencia): alguien le editó precio,
--                                   renglones o descuento para usarla. Un
--                                   borrador SÍ se edita (edit-price, PATCH).
--   SE QUEDA · fuera de fechas      creada fuera de 29-jun → 16-sep-2026: no
--                                   pudo nacer del fallo; se mira a mano
--   SE CANCELA                      todo lo demás. Es EXACTAMENTE lo que tocaría
--                                   sql/presupuesto-borradores-viejos-2-ARREGLO.sql
--
-- Lo esperable en «tiene pagos» y «tiene CFDI» es CERO, y no por suerte: los
-- cuatro caminos que registran un pago y el de timbrado RECHAZAN un borrador
-- (api/invoices/[id]/route.ts:124, mark-paid:81, paciente/payments/checkout:52,
-- api/cfdi/route.ts:151 y :298). «Cobrar ahora» y Sabina primero CONFIRMAN
-- (BORRADOR → PENDIENTE) y después cobran. Un fantasma cobrado o timbrado ya no
-- es borrador: sale en la consulta D, no aquí, y el arreglo no lo ve.

-- ── A) POR CLÍNICA Y DESTINO ────────────────────────────────────────────
WITH fantasmas AS (
  SELECT i."id", i."clinicId", i."total", i."createdAt",
    CASE
      WHEN i."paid" > 0 OR EXISTS (SELECT 1 FROM "payments" p WHERE p."invoiceId" = i."id")               THEN '1 · SE QUEDA · tiene pagos'
      WHEN i."cfdiUuid" IS NOT NULL OR EXISTS (SELECT 1 FROM "cfdi_records" r WHERE r."invoiceId" = i."id") THEN '2 · SE QUEDA · tiene CFDI'
      WHEN EXISTS (SELECT 1 FROM "payment_plans" pp WHERE pp."invoiceId" = i."id")                         THEN '3 · SE QUEDA · plan de pagos'
      WHEN i."appointmentId" IS NOT NULL                                                                   THEN '4 · SE QUEDA · ligada a una cita'
      WHEN EXISTS (SELECT 1 FROM "quotes" qa WHERE qa."invoiceId" = i."id" AND qa."status" = 'ACCEPTED')   THEN '5 · SE QUEDA · presupuesto aceptado'
      WHEN EXISTS (SELECT 1 FROM "quotes" qt WHERE qt."invoiceId" = i."id" AND abs(qt."total"::numeric - i."total"::numeric) > 1) THEN '6 · SE QUEDA · importe cambiado a mano'
      WHEN i."createdAt" < TIMESTAMP '2026-06-29' OR i."createdAt" >= TIMESTAMP '2026-09-17'               THEN '7 · SE QUEDA · fuera de fechas'
      ELSE                                                                                                      '8 · SE CANCELA'
    END AS destino
  FROM "invoices" i
  WHERE i."status" = 'DRAFT'
    AND (EXISTS (SELECT 1 FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId")
         OR i."notes" LIKE 'Generada desde presupuesto%')
)
SELECT c."name" AS clinica, f.destino,
       COUNT(*)                          AS borradores,
       ROUND(SUM(f."total")::numeric, 2) AS total_mxn,
       MIN(f."createdAt")::date          AS la_mas_vieja,
       MAX(f."createdAt")::date          AS la_mas_nueva
FROM fantasmas f
JOIN "clinics" c ON c."id" = f."clinicId"
GROUP BY c."id", c."name", f.destino
ORDER BY c."name", f.destino;

-- ── B) LAS QUE SE CANCELARÍAN, POR ESTADO DEL PRESUPUESTO ───────────────
--    DRAFT / PRESENTED  → el paciente aún no contesta: deuda que no existe.
--    REJECTED / EXPIRED → el paciente no aceptó: deuda que no va a existir.
--    (sin presupuesto)  → conserva la nota pero ya nadie apunta a ella
--                         (el presupuesto se borró).
--    Si dos presupuestos apuntan a la misma factura salen los dos estados
--    juntos («PRESENTED+REJECTED»); la factura se cuenta UNA vez.
WITH fantasmas AS (
  SELECT i."id", i."clinicId", i."total",
    COALESCE((SELECT string_agg(DISTINCT q."status", '+' ORDER BY q."status") FROM "quotes" q
               WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId"), '(sin presupuesto)') AS estado_presupuesto,
    (SELECT COUNT(*) FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId") AS presupuestos
  FROM "invoices" i
  WHERE i."status" = 'DRAFT'
    AND (EXISTS (SELECT 1 FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId")
         OR i."notes" LIKE 'Generada desde presupuesto%')
    AND i."paid" = 0
    AND NOT EXISTS (SELECT 1 FROM "payments"      p  WHERE p."invoiceId"  = i."id")
    AND i."cfdiUuid" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "cfdi_records"  r  WHERE r."invoiceId"  = i."id")
    AND NOT EXISTS (SELECT 1 FROM "payment_plans" pp WHERE pp."invoiceId" = i."id")
    AND i."appointmentId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "quotes" qa WHERE qa."invoiceId" = i."id" AND qa."status" = 'ACCEPTED')
    AND NOT EXISTS (SELECT 1 FROM "quotes" qt WHERE qt."invoiceId" = i."id" AND abs(qt."total"::numeric - i."total"::numeric) > 1)
    AND i."createdAt" >= TIMESTAMP '2026-06-29' AND i."createdAt" < TIMESTAMP '2026-09-17'
)
SELECT c."name" AS clinica, f.estado_presupuesto,
       COUNT(*)                          AS se_cancelarian,
       ROUND(SUM(f."total")::numeric, 2) AS total_mxn,
       SUM(f.presupuestos)               AS presupuestos_a_desligar
FROM fantasmas f
JOIN "clinics" c ON c."id" = f."clinicId"
GROUP BY c."id", c."name", f.estado_presupuesto
ORDER BY c."name", se_cancelarian DESC;

-- ── C) LAS QUE SE QUEDAN, UNA POR UNA ───────────────────────────────────
--    Todo borrador fantasma que NO se cancelaría, con el porqué a la vista.
--    Las de «presupuesto aceptado» serán las más; las demás, pocas o ninguna.
SELECT
  c."name"                                                                AS clinica,
  i."invoiceNumber"                                                       AS factura,
  i."createdAt"::date                                                     AS creada,
  p."firstName" || ' ' || p."lastName"                                    AS paciente,
  (SELECT string_agg(q."folio" || ' (' || q."status" || ')', ', ')
     FROM "quotes" q WHERE q."invoiceId" = i."id")                        AS presupuestos,
  i."total"                                                               AS total_mxn,
  i."paid"                                                                AS pagado,
  (SELECT COUNT(*) FROM "payments" x WHERE x."invoiceId" = i."id")        AS pagos,
  i."cfdiUuid"                                                            AS cfdi_uuid,
  (SELECT string_agg(r."uuid" || ' (' || r."status" || ')', ', ')
     FROM "cfdi_records" r WHERE r."invoiceId" = i."id")                  AS cfdi_registros,
  (SELECT COUNT(*) FROM "payment_plans" pp WHERE pp."invoiceId" = i."id") AS planes,
  i."appointmentId"                                                       AS cita
FROM "invoices" i
JOIN "clinics"  c ON c."id" = i."clinicId"
JOIN "patients" p ON p."id" = i."patientId"
WHERE i."status" = 'DRAFT'
  AND (EXISTS (SELECT 1 FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId")
       OR i."notes" LIKE 'Generada desde presupuesto%')
  AND NOT (
        i."paid" = 0
    AND NOT EXISTS (SELECT 1 FROM "payments"      x  WHERE x."invoiceId"  = i."id")
    AND i."cfdiUuid" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "cfdi_records"  r  WHERE r."invoiceId"  = i."id")
    AND NOT EXISTS (SELECT 1 FROM "payment_plans" pp WHERE pp."invoiceId" = i."id")
    AND i."appointmentId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "quotes" qa WHERE qa."invoiceId" = i."id" AND qa."status" = 'ACCEPTED')
    AND NOT EXISTS (SELECT 1 FROM "quotes" qt WHERE qt."invoiceId" = i."id" AND abs(qt."total"::numeric - i."total"::numeric) > 1)
    AND i."createdAt" >= TIMESTAMP '2026-06-29' AND i."createdAt" < TIMESTAMP '2026-09-17'
  )
ORDER BY c."name", i."createdAt" DESC;

-- ── D) LOS FANTASMAS QUE YA NO SON BORRADOR — aquí viven los pagos y el CFDI ─
--    Nacieron igual (misma ventana, ligados a un presupuesto o con la nota) pero
--    alguien los CONFIRMÓ, y quizá cobró o timbró. Hoy son facturas normales.
--    EL ARREGLO NO LAS TOCA NI LAS VE. Se enseñan para saber cuántas son:
--      · presupuesto aceptado  → es el camino normal. Nada que hacer.
--      · presupuesto NO aceptado y con dinero cobrado → dinero real de un
--        paciente: la factura es legítima aunque el presupuesto diga otra cosa.
--      · presupuesto NO aceptado, PENDIENTE y sin un peso cobrado → ÉSTA sí
--        ensucia Caja y «lo que se escapa». Se cancela a mano, desde la pantalla
--        («Cancelar factura»), que valida y deja rastro en auditoría.
--    (Incluye las facturas PENDIENTES que «Generar factura» creó el 16-sep ya
--    con el #288: son legítimas y caen en la primera fila.)
SELECT
  c."name"                                                         AS clinica,
  i."status"::text                                                 AS estado_factura,
  EXISTS (SELECT 1 FROM "quotes" qa WHERE qa."invoiceId" = i."id" AND qa."status" = 'ACCEPTED') AS presupuesto_aceptado,
  COUNT(*)                                                         AS facturas,
  ROUND(SUM(i."total")::numeric, 2)                                AS total_mxn,
  ROUND(SUM(i."paid")::numeric, 2)                                 AS cobrado_mxn,
  COUNT(*) FILTER (WHERE i."paid" > 0
     OR EXISTS (SELECT 1 FROM "payments" x WHERE x."invoiceId" = i."id"))      AS con_pagos,
  COUNT(*) FILTER (WHERE i."cfdiUuid" IS NOT NULL
     OR EXISTS (SELECT 1 FROM "cfdi_records" r WHERE r."invoiceId" = i."id")) AS con_cfdi
FROM "invoices" i
JOIN "clinics" c ON c."id" = i."clinicId"
WHERE i."status" <> 'DRAFT'
  AND i."createdAt" >= TIMESTAMP '2026-06-29' AND i."createdAt" < TIMESTAMP '2026-09-17'
  AND (EXISTS (SELECT 1 FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId")
       OR i."notes" LIKE 'Generada desde presupuesto%')
GROUP BY c."id", c."name", 2, 3
ORDER BY c."name", 2, 3;

-- ── E) EL RESUMEN QUE DECIDE — es lo que enseña Supabase si pegas todo ──
--    Una fila por destino, todas las clínicas juntas. La fila «8 · SE CANCELA»
--    es lo que tocaría el ARREGLO (menos las de la consulta F, si las hay: el
--    número definitivo lo da el SIMULACRO del propio ARREGLO).
WITH fantasmas AS (
  SELECT i."id", i."clinicId", i."total",
    (SELECT COUNT(*) FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId") AS presupuestos,
    CASE
      WHEN i."paid" > 0 OR EXISTS (SELECT 1 FROM "payments" p WHERE p."invoiceId" = i."id")               THEN '1 · SE QUEDA · tiene pagos'
      WHEN i."cfdiUuid" IS NOT NULL OR EXISTS (SELECT 1 FROM "cfdi_records" r WHERE r."invoiceId" = i."id") THEN '2 · SE QUEDA · tiene CFDI'
      WHEN EXISTS (SELECT 1 FROM "payment_plans" pp WHERE pp."invoiceId" = i."id")                         THEN '3 · SE QUEDA · plan de pagos'
      WHEN i."appointmentId" IS NOT NULL                                                                   THEN '4 · SE QUEDA · ligada a una cita'
      WHEN EXISTS (SELECT 1 FROM "quotes" qa WHERE qa."invoiceId" = i."id" AND qa."status" = 'ACCEPTED')   THEN '5 · SE QUEDA · presupuesto aceptado'
      WHEN EXISTS (SELECT 1 FROM "quotes" qt WHERE qt."invoiceId" = i."id" AND abs(qt."total"::numeric - i."total"::numeric) > 1) THEN '6 · SE QUEDA · importe cambiado a mano'
      WHEN i."createdAt" < TIMESTAMP '2026-06-29' OR i."createdAt" >= TIMESTAMP '2026-09-17'               THEN '7 · SE QUEDA · fuera de fechas'
      ELSE                                                                                                      '8 · SE CANCELA'
    END AS destino
  FROM "invoices" i
  WHERE i."status" = 'DRAFT'
    AND (EXISTS (SELECT 1 FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId")
         OR i."notes" LIKE 'Generada desde presupuesto%')
)
SELECT f.destino,
       COUNT(*)                          AS borradores,
       COUNT(DISTINCT f."clinicId")      AS clinicas,
       COUNT(DISTINCT f."id") FILTER (WHERE f.presupuestos > 0) AS con_presupuesto_ligado,
       SUM(f.presupuestos)               AS presupuestos_ligados,
       ROUND(SUM(f."total")::numeric, 2) AS total_mxn
FROM fantasmas f
GROUP BY f.destino
ORDER BY f.destino;

-- ── F) OPCIONAL — borradores con «condiciones de pago» capturadas a mano ─
--    La tabla `invoice_payment_terms` se creó por SQL aparte
--    (sql/factura-condiciones-pago.sql) y puede NO existir en esta base: por
--    eso va comentada y al final. Si existe, un borrador con fila aquí es uno
--    que alguien abrió y trabajó; el ARREGLO lo deja fuera él solo. Para ver
--    cuántos son, descomenta y corre SOLO esto:
-- SELECT c."name" AS clinica, i."invoiceNumber" AS factura, i."total" AS total_mxn
--   FROM "invoices" i
--   JOIN "clinics" c ON c."id" = i."clinicId"
--   JOIN "invoice_payment_terms" t ON t."invoiceId" = i."id"
--  WHERE i."status" = 'DRAFT'
--    AND (EXISTS (SELECT 1 FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId")
--         OR i."notes" LIKE 'Generada desde presupuesto%');

-- ════════════════════════════════════════════════════════════════════════
-- Qué le fallaba al conteo anterior (presupuesto-borradores-viejos-conteo.sql)
-- ════════════════════════════════════════════════════════════════════════
--  1. Su columna «tocables» contaba como tocables los borradores de presupuestos
--     ACEPTADOS, que la propuesta NO toca. Probado con 11 fantasmas de juguete:
--     decía 6 tocables y el arreglo cancelaba 4. Rafael habría visto un número
--     y aplicado otro. Aquí «SE CANCELA» usa la misma condición que el arreglo,
--     y la prueba comprueba que los dos números coinciden.
--  2. Buscaba pagos y CFDI solo entre los BORRADORES, donde por código no puede
--     haberlos. Los fantasmas con dinero o con timbre ya no son borrador y no
--     salían en ningún lado. Ahora están en la consulta D.
--  3. No miraba `appointmentId`, ni la fecha de creación, ni las condiciones de
--     pago a mano.
--  4. Con dos presupuestos sobre una factura enseñaba min(status), es decir, el
--     primero por orden alfabético. Ahora enseña los dos.
--  5. El tramo «más de 180 días» no puede existir: el fallo nació el 29-jun-2026.
