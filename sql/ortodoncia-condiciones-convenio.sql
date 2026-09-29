-- ════════════════════════════════════════════════════════════════════════════
-- Ortodoncia — «Condiciones del convenio» por clínica (ws1-t4, 29-sep-2026).
--
-- Una columna de texto en la tabla de la «Política de cobro» de ortodoncia
-- ("orthodontic_billing_configs", creada por sql/ortodoncia-cobro.sql). Es lo
-- que imprime el convenio de pago en PDF; se edita en Ortodoncia →
-- Configuración → «Condiciones del convenio».
--
--   NULL  → la clínica nunca las editó: el panel usa las de EJEMPLO.
--   ''    → la clínica las dejó en blanco a propósito.
--
-- PLANO (sin bloques DO), IDEMPOTENTE (IF NOT EXISTS) y ADITIVO (no toca
-- ninguna fila ni columna existente). No se declara en prisma/schema.prisma:
-- el código la lee con SQL crudo y una sonda de columna, así que mientras
-- este archivo no se pegue la pantalla muestra el ejemplo y el guardado avisa
-- que falta este SQL — nada se cae.
--
-- Requiere sql/ortodoncia-cobro.sql aplicado antes (crea la tabla).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "orthodontic_billing_configs"
  ADD COLUMN IF NOT EXISTS "agreementTerms" TEXT;
