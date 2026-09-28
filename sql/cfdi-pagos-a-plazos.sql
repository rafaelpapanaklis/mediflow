-- ════════════════════════════════════════════════════════════════════════════
-- CFDI por PAGO en facturas a plazos (ortodoncia y cualquier tratamiento a
-- plazos) — ws1-t1, sep-2026.
--
-- Decisión de Rafael: cada pago recibido de una factura "a plazos" (enganche,
-- mensualidad, abono) se timbra como su PROPIO CFDI PUE, igual que ya se
-- timbra cada pago de la suscripción del plan
-- (src/app/api/admin/payments/[id]/cfdi/route.ts). La factura completa del
-- caso ya NO se timbra entera de un jalón mientras tenga saldo — eso lo hace
-- cumplir el código, no esta migración.
--
-- ⚠️ Lo aplica Rafael, en el SQL Editor. La terminal NUNCA lo ejecuta.
--
-- Solo añade UNA columna nullable a una tabla que ya existe
-- (prisma/schema.prisma:2291, `model CfdiRecord` → "cfdi_records"). A
-- PROPÓSITO no se declara en prisma/schema.prisma: ese modelo se lee sin
-- `select` explícito en varias rutas existentes (api/cfdi/route.ts GET,
-- api/cfdi/[cfdiId]/pdf|xml) — declarar la columna ahí y correr
-- `prisma generate` antes de pegar este SQL tumbaría esas rutas con P2022 en
-- CUALQUIER clínica, tenga o no facturas a plazos. Se lee y escribe con SQL
-- crudo desde src/lib/invoices/cfdi-pago-db.ts, con sonda de columna (mismo
-- patrón que orthodontic_treatment_plans.billingMode, ver
-- src/lib/orthodontics/billing-mode-db.ts): sin este SQL aplicado, el botón
-- "Facturar este pago" responde 503 con instrucciones, y todo lo demás del
-- panel sigue exactamente igual.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS. Sin
-- bloques DO (el SQL Editor de dev.108 no los acepta). Re-ejecutable sin
-- efectos colaterales.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. La columna: a qué PAGO (payments.id) corresponde este CFDI ───────────
-- NULL = CFDI de la factura completa (el flujo de SIEMPRE, sin tocar). Con
-- valor = CFDI de UN pago concreto (este candado nuevo).
ALTER TABLE "cfdi_records"
  ADD COLUMN IF NOT EXISTS "paymentId" TEXT;

-- ── 2. Un pago no se timbra dos veces ────────────────────────────────────────
-- Único PARCIAL (Postgres permite varios NULL en un índice único normal, pero
-- se deja explícito el WHERE por claridad — es el mismo candado con el que se
-- reserva el timbrado en la fila ANTES de llamar a Facturapi: el INSERT …
-- ON CONFLICT ("paymentId") WHERE "paymentId" IS NOT NULL DO NOTHING de
-- cfdi-pago-db.ts solo puede colar UNA fila por pago, sin importar cuántas
-- pestañas lo pidan a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS "cfdi_records_paymentId_key"
  ON "cfdi_records" ("paymentId")
  WHERE "paymentId" IS NOT NULL;

-- ── 3. Para sumar rápido "¿cuánto de esta factura ya se timbró por pago?" ───
CREATE INDEX IF NOT EXISTS "cfdi_records_invoiceId_paymentId_idx"
  ON "cfdi_records" ("invoiceId", "paymentId");

-- Verificación (debe devolver la columna y los dos índices):
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'cfdi_records' AND column_name = 'paymentId';
-- SELECT indexname FROM pg_indexes
--  WHERE tablename = 'cfdi_records' AND indexname LIKE 'cfdi_records_%paymentId%';
