-- ws1-t4 · vuelta 2 · F-14 — en qué ambiente de Facturapi se timbró cada CFDI.
--
-- POR QUÉ: con producción en Live, un CFDI timbrado en PRUEBAS (sin validez
-- ante el SAT) contaba como vigente y bloqueaba cancelar, reembolsar, anular,
-- cambiar el precio y volver a timbrar su factura. Caso real: F-000155 de la
-- clínica de pruebas de Rafael (timbrada en TEST en julio de 2026).
--
-- QUÉ HACE EL CÓDIGO (ya desplegable sin este SQL; sin él todo sigue como hoy):
--   · cada timbrado escribe "environment" = 'test' | 'live';
--   · en Live, un CFDI con 'test' no bloquea nada y la factura se puede timbrar
--     de verdad (el de prueba queda con status 'prueba');
--   · NULL (CFDI de antes de esta columna) cuenta como VIGENTE: lo conservador.
--
-- Idempotente. No crea tablas (no hay RLS que añadir). Sin DROP.

-- ── Paso 1 · la columna ─────────────────────────────────────────────────────
ALTER TABLE "cfdi_records" ADD COLUMN IF NOT EXISTS "environment" TEXT;

-- ── Paso 2 · marcar como PRUEBA los CFDI anteriores a Live (OPCIONAL) ──────
-- Producción no tuvo llave Live hasta el 3-oct-2026 (BEVADENT), así que TODO
-- CFDI anterior se timbró en TEST. Hoy (3-oct-2026) es UNA fila: F-000155.
-- Mirarlo antes:
--   SELECT "clinicId", "uuid", "total", "createdAt"
--     FROM "cfdi_records"
--    WHERE "environment" IS NULL AND "createdAt" < TIMESTAMPTZ '2026-10-03 00:00:00-06';
UPDATE "cfdi_records"
   SET "environment" = 'test'
 WHERE "environment" IS NULL
   AND "createdAt" < TIMESTAMPTZ '2026-10-03 00:00:00-06';
