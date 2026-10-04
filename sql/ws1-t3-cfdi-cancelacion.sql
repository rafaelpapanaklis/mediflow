-- ════════════════════════════════════════════════════════════════════════════
-- ws1-t3 · Cancelación de CFDI ante el SAT, sincronía con Facturapi y nota de
-- crédito (auditoría CFDI F-02, F-03, F-16 parte egreso) — 3-oct-2026.
--
-- ⚠️ Lo aplica Rafael, en el SQL Editor. La terminal NUNCA lo ejecuta.
--
-- Solo AÑADE columnas nullable a una tabla que ya existe ("cfdi_records") y dos
-- índices. Sin DROP, sin UPDATE, sin bloques DO. IDEMPOTENTE: se puede correr
-- dos veces. No es tabla nueva, así que no lleva RLS propia (cfdi_records ya
-- tiene la suya).
--
-- A PROPÓSITO no se declara en prisma/schema.prisma: CfdiRecord se lee sin
-- `select` en api/cfdi (GET) y api/cfdi/[cfdiId]/pdf|xml; declararlas y correr
-- `prisma generate` antes de pegar esto tumbaría esas rutas con P2022 en todas
-- las clínicas. Se leen y escriben con SQL crudo desde
-- src/lib/invoices/cfdi-cancelacion-db.ts, con sonda de columnas.
--
-- Sin este SQL: «Cancelar ante el SAT», «Sustituir CFDI» y «Nota de crédito»
-- contestan 503 diciendo este nombre de archivo y no se pintan; «Consultar
-- estado en el SAT», el webhook y el cron SÍ funcionan (solo escriben
-- "status" y "cancelledAt", que ya existen).
--
-- "status" (TEXT, ya existe) gana un valor: 'sustituido' = CFDI de ingreso al
-- que ya se le timbró un sustituto (relación 04) y que todavía no se cancela
-- ante el SAT. Lo escribe el código; aquí no se toca ninguna fila.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Estado de la cancelación ─────────────────────────────────────────────
-- none | verifying | pending | accepted | rejected | expired (los de Facturapi)
-- + enviando (candado: una petición está hablando con Facturapi)
-- + incierto (se mandó y la conexión se cortó: no se sabe si llegó al SAT).
ALTER TABLE "cfdi_records" ADD COLUMN IF NOT EXISTS "cancellationStatus" TEXT;
-- Motivo del SAT (01, 02, 03, 04) y el motivo escrito por quien canceló.
ALTER TABLE "cfdi_records" ADD COLUMN IF NOT EXISTS "cancelMotive" TEXT;
ALTER TABLE "cfdi_records" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
ALTER TABLE "cfdi_records" ADD COLUMN IF NOT EXISTS "cancelRequestedAt" TIMESTAMPTZ;
-- users.id de quien la pidió (sin FK: la bitácora conserva el nombre).
ALTER TABLE "cfdi_records" ADD COLUMN IF NOT EXISTS "cancelRequestedBy" TEXT;
-- Con motivo 01: el UUID del CFDI que lo sustituye.
ALTER TABLE "cfdi_records" ADD COLUMN IF NOT EXISTS "substitutedByUuid" TEXT;

-- ── 2. CFDI relacionados ────────────────────────────────────────────────────
-- En el CFDI NUEVO: a qué UUID se relaciona y cómo.
--   '04' = sustituye a ese CFDI (lo exige la cancelación con motivo 01);
--   '01' = nota de crédito (egreso) de ese CFDI.
ALTER TABLE "cfdi_records" ADD COLUMN IF NOT EXISTS "relatedUuid" TEXT;
ALTER TABLE "cfdi_records" ADD COLUMN IF NOT EXISTS "relationType" TEXT;
-- En la nota de crédito: el reembolso interno (payments.id, method 'refund') al que va ligada.
ALTER TABLE "cfdi_records" ADD COLUMN IF NOT EXISTS "refundPaymentId" TEXT;

-- ── 3. Sincronía con Facturapi ──────────────────────────────────────────────
-- Última vez que se le preguntó a Facturapi por este CFDI (cron /api/cron/cfdi-estado).
ALTER TABLE "cfdi_records" ADD COLUMN IF NOT EXISTS "satCheckedAt" TIMESTAMPTZ;

-- ── 4. Índices ──────────────────────────────────────────────────────────────
-- Las notas de crédito de un CFDI (suma de lo ya acreditado, candado de cancelar).
CREATE INDEX IF NOT EXISTS "cfdi_records_relatedUuid_idx"
  ON "cfdi_records" ("relatedUuid")
  WHERE "relatedUuid" IS NOT NULL;
-- Lo que el cron revisa primero: cancelaciones en curso.
CREATE INDEX IF NOT EXISTS "cfdi_records_cancelacion_en_curso_idx"
  ON "cfdi_records" ("cancellationStatus")
  WHERE "cancellationStatus" IN ('pending', 'verifying', 'incierto', 'enviando');
-- El webhook busca por el id de Facturapi.
CREATE INDEX IF NOT EXISTS "cfdi_records_facturapiId_idx"
  ON "cfdi_records" ("facturapiId");

-- (TIMESTAMPTZ como "cancelledAt" y "createdAt" de esta misma tabla en la base real.)
-- Verificación (debe devolver 10 columnas):
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = current_schema() AND table_name = 'cfdi_records'
--    AND column_name IN ('cancellationStatus','cancelMotive','cancelReason','cancelRequestedAt',
--                        'cancelRequestedBy','substitutedByUuid','relatedUuid','relationType',
--                        'refundPaymentId','satCheckedAt');
