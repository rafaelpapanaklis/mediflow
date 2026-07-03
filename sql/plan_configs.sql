-- ════════════════════════════════════════════════════════════════════════════
-- plan_configs — fuente única (editable desde /admin/settings → Planes) de
-- precio / límites / permisos por módulo de cada plan de la plataforma.
--
-- Aplicar A MANO en Supabase (SQL Editor). Idempotente: re-ejecutable sin daño
-- (CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO UPDATE, upsert).
--
-- Espeja el modelo Prisma `PlanConfig` (@@map("plan_configs")). storageBytes es
-- BIGINT (100GB ≈ 1.07e11 no cabe en integer). maxPatients/maxUsers NULL =
-- ilimitado. features = { "moduleKey": boolean } (casillas del panel).
-- Seed = valores FINALES (02-jul-2026): anual 30% dto; usuarios 2/6/∞; pacientes 200/∞/∞; storage 5/15/75 GB; IA 0/200k/1M; WA 300/1500/6000. YA APLICADO en Supabase con ON CONFLICT DO UPDATE.
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
  ('BASIC',  'Básico',       499,  4192,   5368709120, 0,       300,  200,  2,
    '{"ai-assistant":false,"inbox":true,"whatsapp":true,"marketplace":true,"analytics":false,"reports":true,"landing":true,"tv-modes":false}'::jsonb),
  ('PRO',    'Profesional',  999,  8392,  16106127360, 200000,  1500, NULL, 6,
    '{"ai-assistant":true,"inbox":true,"whatsapp":true,"marketplace":true,"analytics":true,"reports":true,"landing":true,"tv-modes":true}'::jsonb),
  ('CLINIC', 'Clínica',     1999, 16792,  80530636800, 1000000, 6000, NULL, NULL,
    '{"ai-assistant":true,"inbox":true,"whatsapp":true,"marketplace":true,"analytics":true,"reports":true,"landing":true,"tv-modes":true}'::jsonb)
ON CONFLICT ("planId") DO UPDATE SET
  "label" = EXCLUDED."label", "priceMxnMonthly" = EXCLUDED."priceMxnMonthly",
  "priceMxnAnnual" = EXCLUDED."priceMxnAnnual", "storageBytes" = EXCLUDED."storageBytes",
  "aiTokensDefault" = EXCLUDED."aiTokensDefault", "whatsappMonthly" = EXCLUDED."whatsappMonthly",
  "maxPatients" = EXCLUDED."maxPatients", "maxUsers" = EXCLUDED."maxUsers",
  "features" = EXCLUDED."features", "updatedAt" = CURRENT_TIMESTAMP;
