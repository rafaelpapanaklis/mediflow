-- ============================================================================
-- WS1-T4 · N2 y N3 — un CFDI vigente por factura, y cómo medir lo que ya pasó.
--
-- ⚠️ Lo aplica Rafael, en el SQL editor de Supabase. La terminal no toca la base.
--
-- El código de la rama fix/cfdi-timbrado-y-sat NO necesita nada de esto para
-- funcionar: el candado contra el doble timbrado es un UPDATE … WHERE
-- "cfdiUuid" IS NULL sobre la fila de la factura, que es atómico sin índices.
-- El índice de §2 es la red de la base por si algún día otro camino (un script,
-- otra ruta, Sabina) inserta un CfdiRecord sin pasar por ese candado.
--
-- No va a prisma/schema.prisma: Prisma no sabe expresar un índice parcial.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- §1 MEDICIÓN (solo lectura). Correr ANTES de integrar: dice si N2 y N3 ya
--    pasaron de verdad y cuántas veces se va a topar una clínica con el bloqueo.
-- ────────────────────────────────────────────────────────────────────────────

-- §1.1 N2 ya ocurrido: facturas con MÁS de un CFDI vigente. Cada fila son
--      timbres cobrados de más y CFDI duplicados vivos ante el SAT.
SELECT c."clinicId", c."invoiceId", COUNT(*) AS cfdi_vigentes,
       array_agg(c.uuid ORDER BY c."createdAt") AS uuids,
       array_agg(c.total ORDER BY c."createdAt") AS totales
FROM "cfdi_records" c
WHERE c."invoiceId" IS NOT NULL AND c.status = 'valid' AND c."tipoComprobante" = 'I'
GROUP BY c."clinicId", c."invoiceId"
HAVING COUNT(*) > 1;

-- §1.2 N3 ya ocurrido: facturas CANCELADAS con CFDI (el CFDI sigue vigente).
SELECT i."clinicId", i.id, i."invoiceNumber", i.total, i."cfdiUuid", i."updatedAt"
FROM "invoices" i
WHERE i."cfdiUuid" IS NOT NULL AND i.status = 'CANCELLED'
ORDER BY i."updatedAt" DESC;

-- §1.3 N3 ya ocurrido: facturas timbradas con reembolsos registrados.
SELECT i."clinicId", i.id, i."invoiceNumber", i.total, i."cfdiUuid",
       SUM(p.amount) AS reembolsado, MAX(p."paidAt") AS ultimo_reembolso
FROM "invoices" i
JOIN "payments" p ON p."invoiceId" = i.id AND p.method = 'refund'
WHERE i."cfdiUuid" IS NOT NULL
GROUP BY i."clinicId", i.id, i."invoiceNumber", i.total, i."cfdiUuid"
ORDER BY ultimo_reembolso DESC;

-- §1.4 N3 ya ocurrido: el total de la factura ya no es el del CFDI (editar
--      precio después de timbrar). Más de $1 para no contar redondeos de IVA.
SELECT i."clinicId", i.id, i."invoiceNumber", i.total AS total_factura,
       c.total AS total_cfdi, c.uuid
FROM "invoices" i
JOIN "cfdi_records" c ON c.uuid = i."cfdiUuid"
WHERE ABS(i.total - c.total) > 1
ORDER BY i."updatedAt" DESC;

-- §1.5 Apartados colgados: timbrados que empezaron y no terminaron de guardar
--      (la función murió mientras Facturapi timbraba, o la base falló después).
--      Formato: timbrando:<invoiceId>:<id de la petición>. Deberían ser 0;
--      cada fila se resuelve a mano con §3.2.
SELECT i."clinicId", i.id, i."invoiceNumber", i.total, i."cfdiUuid", i."updatedAt"
FROM "invoices" i
WHERE i."cfdiUuid" LIKE 'timbrando:%'
ORDER BY i."updatedAt";


-- ────────────────────────────────────────────────────────────────────────────
-- §2 ÍNDICE ÚNICO: un solo CFDI de ingreso VIGENTE por factura.
--    Parcial: los CFDI cancelados no chocan (se puede re-timbrar tras cancelar)
--    y los de suscripción (invoiceId NULL, api/admin/payments) quedan fuera.
-- ────────────────────────────────────────────────────────────────────────────

-- §2.1 DETECCIÓN: es la misma consulta de §1.1. Si devuelve filas, el índice
--      NO se puede crear hasta resolverlas: hay que cancelar ante el SAT los
--      CFDI sobrantes (en Facturapi) y marcar su fila con §3.1. NO borrar filas.

-- §2.2 El índice. CONCURRENTLY no corre dentro de una transacción y el SQL
--      editor envuelve los lotes en una: ejecútalo SOLO, en un Run propio.
--      Si falla a medias deja un índice INVALID: DROP INDEX y reintenta.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "cfdi_records_invoiceId_vigente_key"
  ON "cfdi_records" ("invoiceId")
  WHERE "invoiceId" IS NOT NULL AND status = 'valid' AND "tipoComprobante" = 'I';


-- ────────────────────────────────────────────────────────────────────────────
-- §3 PLANTILLAS PARA SOPORTE (no correr a ciegas: cambian datos de clínicas).
--    El mensaje nuevo de cancelar/anular/reembolsar/editar precio manda a la
--    clínica a escribir a soporte. Esto es lo que se hace después.
-- ────────────────────────────────────────────────────────────────────────────

-- §3.1 Después de CANCELAR el CFDI ante el SAT en el panel de Facturapi:
--      marca el CFDI como cancelado y libera la factura para cancelarla,
--      reembolsarla o corregirla y volver a timbrar. Un solo Run.
--
--      BEGIN;
--      UPDATE "cfdi_records"
--         SET status = 'cancelled', "cancelledAt" = NOW()
--       WHERE uuid = '<UUID>' AND "clinicId" = '<clinicId>' AND status = 'valid';
--      UPDATE "invoices"
--         SET "cfdiUuid" = NULL, "updatedAt" = NOW()
--       WHERE id = '<invoiceId>' AND "clinicId" = '<clinicId>' AND "cfdiUuid" = '<UUID>';
--      COMMIT;

-- §3.2 Apartado colgado (§1.5). Primero se busca en Facturapi si ese timbrado
--      SÍ llegó a emitirse (organización de la clínica, total y hora de
--      "updatedAt"). El log de Vercel lo trae si la base falló después de
--      timbrar: «CFDI timbrado ante el SAT pero no guardado completo».
--
--      a) SÍ existe el CFDI → se deja en la factura (y se rehace su fila de
--         cfdi_records: el log trae uuid, facturapiId y total; el receptor, el
--         XML y el PDF salen de Facturapi con ese facturapiId):
--      UPDATE "invoices" SET "cfdiUuid" = '<UUID real>', "updatedAt" = NOW()
--       WHERE id = '<invoiceId>' AND "clinicId" = '<clinicId>' AND "cfdiUuid" = '<cfdiUuid tal cual salió en §1.5>';
--
--      b) NO existe → se suelta el apartado y la factura se puede timbrar:
--      UPDATE "invoices" SET "cfdiUuid" = NULL, "updatedAt" = NOW()
--       WHERE id = '<invoiceId>' AND "clinicId" = '<clinicId>' AND "cfdiUuid" = '<cfdiUuid tal cual salió en §1.5>';
