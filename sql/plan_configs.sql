-- ════════════════════════════════════════════════════════════════════════════
-- plan_configs — fuente única (editable desde /admin/settings → Planes) de
-- precio / límites / permisos por módulo de cada plan de la plataforma.
--
-- Aplicar A MANO en Supabase (SQL Editor). Idempotente: re-ejecutable sin daño
-- (CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING).
--
-- Espeja el modelo Prisma `PlanConfig` (@@map("plan_configs")). storageBytes es
-- BIGINT (100GB ≈ 1.07e11 no cabe en integer). maxPatients/maxUsers NULL =
-- ilimitado. features = { "moduleKey": boolean } (casillas del panel).
-- Seed = valores ACTUALES correctos: 499 / 999 / 1999 (anual = ×10, 2 gratis).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "plan_configs" (
  "planId"          text         NOT NULL,
  "label"           text         NOT NULL,
  "priceMxnMonthly" integer      NOT NULL,
  "priceMxnAnnual"  integer      NOT NULL,
  "storageBytes"    bigint       NOT NULL,
  "aiTokensDefault" integer      NOT NULL,
  "whatsappMonthly" integer      NOT NULL,
  "maxPatients"     integer,
  "maxUsers"        integer,
  "features"        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  "updatedAt"       timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_configs_pkey" PRIMARY KEY ("planId")
);

INSERT INTO "plan_configs"
  ("planId", "label", "priceMxnMonthly", "priceMxnAnnual", "storageBytes", "aiTokensDefault", "whatsappMonthly", "maxPatients", "maxUsers", "features")
VALUES
  ('BASIC',  'Básico',       499,   4990,   1073741824, 50000,   200,  200,  1,
    '{"ai-assistant":false,"inbox":true,"whatsapp":true,"marketplace":true,"analytics":false,"reports":true,"landing":true,"tv-modes":false}'::jsonb),
  ('PRO',    'Profesional',  999,   9990,  10737418240, 200000,  1000, NULL, 3,
    '{"ai-assistant":true,"inbox":true,"whatsapp":true,"marketplace":true,"analytics":true,"reports":true,"landing":true,"tv-modes":true}'::jsonb),
  ('CLINIC', 'Clínica',      1999,  19990, 107374182400, 1000000, 5000, NULL, NULL,
    '{"ai-assistant":true,"inbox":true,"whatsapp":true,"marketplace":true,"analytics":true,"reports":true,"landing":true,"tv-modes":true}'::jsonb)
ON CONFLICT ("planId") DO NOTHING;
