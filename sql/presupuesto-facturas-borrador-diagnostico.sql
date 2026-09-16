-- ════════════════════════════════════════════════════════════════════════
-- Facturas BORRADOR que dejaron los presupuestos viejos — SOLO LECTURA
-- Rama fix/presupuesto-no-borrador (WS1-T2) · 16-sep-2026
-- ════════════════════════════════════════════════════════════════════════
--
-- ⚠️ ESTO NO CAMBIA NADA. Son dos SELECT. No hay UPDATE, DELETE ni migración.
--
-- Por qué existe: hasta este arreglo, CREAR un presupuesto creaba además una
-- factura en BORRADOR con folio MF (nota «Generada desde presupuesto P-…»).
-- Desde el arreglo ya no nacen, pero las que nacieron siguen en la base y
-- siguen sumando en «Cobrar ahora» / «Estado de cuenta» de la ficha y en el
-- filtro «Con deuda» de Pacientes (esas pantallas cuentan los borradores).
-- No entran en Caja, reportes, portal del paciente ni aviso de saldo.
--
-- Sirve para decidir, clínica por clínica, qué hacer con ellas. La decisión es
-- de Rafael; esta consulta solo dice cuántas hay y de qué presupuestos vienen.
--
-- Cómo leer «estado_presupuesto»:
--   DRAFT / PRESENTED → el paciente aún no contesta. Candidatas a quitar.
--   REJECTED / EXPIRED → el paciente no aceptó. Candidatas a quitar.
--   ACCEPTED          → el paciente aceptó: esa factura sí se va a cobrar.
--   (sin presupuesto) → el presupuesto se borró o se perdió la liga.
--
-- Quitar un borrador desde la pantalla («Eliminar borrador» en el detalle de
-- la factura) lo borra de verdad y libera su folio: si era el último MF de la
-- clínica, ese número se vuelve a usar en la siguiente factura.

-- 1) Resumen por clínica y por estado del presupuesto
SELECT
  c."name"                                     AS clinica,
  COALESCE(q."status", '(sin presupuesto)')    AS estado_presupuesto,
  COUNT(*)                                     AS facturas_borrador,
  SUM(i."total")                               AS total_mxn
FROM "invoices" i
JOIN "clinics" c ON c."id" = i."clinicId"
LEFT JOIN "quotes" q ON q."invoiceId" = i."id" AND q."clinicId" = i."clinicId"
WHERE i."status" = 'DRAFT'
  AND (q."id" IS NOT NULL OR i."notes" LIKE 'Generada desde presupuesto%')
GROUP BY c."name", q."status"
ORDER BY c."name", facturas_borrador DESC;

-- 2) Detalle, una fila por factura
SELECT
  c."name"                                     AS clinica,
  i."invoiceNumber"                            AS factura,
  i."createdAt"::date                          AS creada,
  p."firstName" || ' ' || p."lastName"         AS paciente,
  q."folio"                                    AS presupuesto,
  COALESCE(q."status", '(sin presupuesto)')    AS estado_presupuesto,
  i."total"                                    AS total_mxn
FROM "invoices" i
JOIN "clinics"  c ON c."id" = i."clinicId"
JOIN "patients" p ON p."id" = i."patientId"
LEFT JOIN "quotes" q ON q."invoiceId" = i."id" AND q."clinicId" = i."clinicId"
WHERE i."status" = 'DRAFT'
  AND (q."id" IS NOT NULL OR i."notes" LIKE 'Generada desde presupuesto%')
ORDER BY c."name", i."createdAt" DESC;
