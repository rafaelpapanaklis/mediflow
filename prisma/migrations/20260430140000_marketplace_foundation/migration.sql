-- ═══════════════════════════════════════════════════════════════════
-- Marketplace de módulos · Sprint 1 — Foundation
--
-- CONTEXTO
-- Implementa el modelo de monetización por módulo: catálogo (Module),
-- relación clínica-módulo activa (ClinicModule), log de uso para
-- recomendaciones (ModuleUsageLog), órdenes de checkout (Order) y
-- carrito persistente (Cart). También extiende clinics con campos
-- de trial granular (trial_started_at + flags de notificación 7d/3d/1d)
-- y convierte trialEndsAt a NOT NULL tras backfill.
--
-- IDEMPOTENTE: usa IF NOT EXISTS, DO $$ guards y ALTER TABLE seguros.
-- Se puede re-correr múltiples veces sin efectos colaterales. Listo
-- para pegar en Supabase SQL Editor.
--
-- ORDEN
--   1. Nuevas columnas en clinics + backfill + NOT NULL
--   2. Tabla modules (catálogo)
--   3. Tabla clinic_modules (relación)
--   4. Tabla module_usage_logs
--   5. Tabla orders
--   6. Tabla carts
--   7. RLS deny-all en las 5 tablas nuevas
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Extender tabla "clinics" ────────────────────────────────────

-- 1.1 Nuevas columnas (idempotentes vía IF NOT EXISTS)
ALTER TABLE "clinics"
  ADD COLUMN IF NOT EXISTS "trial_started_at"  TIMESTAMP(3);
ALTER TABLE "clinics"
  ADD COLUMN IF NOT EXISTS "trial_notified_7d" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clinics"
  ADD COLUMN IF NOT EXISTS "trial_notified_3d" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clinics"
  ADD COLUMN IF NOT EXISTS "trial_notified_1d" BOOLEAN NOT NULL DEFAULT false;

-- 1.2 Backfill trial_started_at = createdAt (sólo si NULL)
UPDATE "clinics"
SET "trial_started_at" = "createdAt"
WHERE "trial_started_at" IS NULL;

-- 1.3 trial_started_at → NOT NULL + default NOW() para nuevas filas
ALTER TABLE "clinics" ALTER COLUMN "trial_started_at" SET NOT NULL;
ALTER TABLE "clinics" ALTER COLUMN "trial_started_at" SET DEFAULT NOW();

-- 1.4 Backfill trialEndsAt para clínicas legacy SIN sobreescribir las
--     que ya tienen valor. Política: trial inicial de 14 días desde
--     createdAt para clínicas que se crearon antes del marketplace.
UPDATE "clinics"
SET "trialEndsAt" = "createdAt" + INTERVAL '14 days'
WHERE "trialEndsAt" IS NULL;

-- 1.5 trialEndsAt → NOT NULL (ya está backfillado al 100%)
ALTER TABLE "clinics" ALTER COLUMN "trialEndsAt" SET NOT NULL;


-- ── 2. Tabla "modules" (catálogo) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS "modules" (
  "id"                 TEXT     PRIMARY KEY,
  "key"                TEXT     NOT NULL,
  "name"               TEXT     NOT NULL,
  "category"           TEXT     NOT NULL,
  "description"        TEXT     NOT NULL,
  "icon_key"           TEXT     NOT NULL,
  "icon_bg"            TEXT     NOT NULL,
  "icon_color"         TEXT     NOT NULL,
  "features"           TEXT[]   NOT NULL DEFAULT ARRAY[]::TEXT[],
  "price_mxn_monthly"  INTEGER  NOT NULL,
  "is_core"            BOOLEAN  NOT NULL DEFAULT false,
  "depends_on"         TEXT[]   NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sort_order"         INTEGER  NOT NULL DEFAULT 0,
  "is_active"          BOOLEAN  NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS "modules_key_key" ON "modules"("key");


-- ── 3. Tabla "clinic_modules" ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS "clinic_modules" (
  "id"                       TEXT          PRIMARY KEY,
  "clinic_id"                TEXT          NOT NULL,
  "module_id"                TEXT          NOT NULL,
  "status"                   TEXT          NOT NULL,
  "billing_cycle"            TEXT          NOT NULL,
  "activated_at"             TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "current_period_start"     TIMESTAMP(3)  NOT NULL,
  "current_period_end"       TIMESTAMP(3)  NOT NULL,
  "cancelled_at"             TIMESTAMP(3),
  "stripe_subscription_id"   TEXT,
  "paypal_subscription_id"   TEXT,
  "payment_method"           TEXT          NOT NULL,
  "price_paid_mxn"           INTEGER       NOT NULL,
  CONSTRAINT "clinic_modules_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE,
  CONSTRAINT "clinic_modules_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "clinic_modules_clinic_id_module_id_key"
  ON "clinic_modules"("clinic_id", "module_id");
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_modules_stripe_subscription_id_key"
  ON "clinic_modules"("stripe_subscription_id");
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_modules_paypal_subscription_id_key"
  ON "clinic_modules"("paypal_subscription_id");
CREATE INDEX IF NOT EXISTS "clinic_modules_clinic_id_idx"
  ON "clinic_modules"("clinic_id");
CREATE INDEX IF NOT EXISTS "clinic_modules_current_period_end_idx"
  ON "clinic_modules"("current_period_end");


-- ── 4. Tabla "module_usage_logs" ───────────────────────────────────

CREATE TABLE IF NOT EXISTS "module_usage_logs" (
  "id"          TEXT          PRIMARY KEY,
  "clinic_id"   TEXT          NOT NULL,
  "module_key"  TEXT          NOT NULL,
  "action"      TEXT          NOT NULL,
  "user_id"     TEXT,
  "created_at"  TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  CONSTRAINT "module_usage_logs_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "module_usage_logs_clinic_id_module_key_idx"
  ON "module_usage_logs"("clinic_id", "module_key");
CREATE INDEX IF NOT EXISTS "module_usage_logs_created_at_idx"
  ON "module_usage_logs"("created_at");


-- ── 5. Tabla "orders" (checkout marketplace) ───────────────────────

CREATE TABLE IF NOT EXISTS "orders" (
  "id"                     TEXT          PRIMARY KEY,
  "clinic_id"              TEXT          NOT NULL,
  "status"                 TEXT          NOT NULL,
  "payment_method"         TEXT          NOT NULL,
  "billing_cycle"          TEXT          NOT NULL,
  "module_ids"             TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "subtotal_mxn"           INTEGER       NOT NULL,
  "annual_bonus_mxn"       INTEGER       NOT NULL DEFAULT 0,
  "volume_discount_pct"    INTEGER       NOT NULL DEFAULT 0,
  "volume_discount_mxn"    INTEGER       NOT NULL DEFAULT 0,
  "tax_mxn"                INTEGER       NOT NULL,
  "total_mxn"              INTEGER       NOT NULL,
  "spei_reference"         TEXT,
  "stripe_payment_intent"  TEXT,
  "paypal_order_id"        TEXT,
  "cfdi_id"                TEXT,
  "cfdi_uuid"              TEXT,
  "created_at"             TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
  "paid_at"                TIMESTAMP(3),
  CONSTRAINT "orders_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "orders_spei_reference_key"
  ON "orders"("spei_reference");
CREATE INDEX IF NOT EXISTS "orders_clinic_id_idx"  ON "orders"("clinic_id");
CREATE INDEX IF NOT EXISTS "orders_status_idx"     ON "orders"("status");


-- ── 6. Tabla "carts" (1:1 con clínica) ─────────────────────────────

CREATE TABLE IF NOT EXISTS "carts" (
  "clinic_id"   TEXT          PRIMARY KEY,
  "module_ids"  TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updated_at"  TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "carts_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE
);


-- ═══════════════════════════════════════════════════════════════════
-- 7. RLS deny-all en las 5 tablas nuevas (defensa en profundidad)
--
-- Mismo patrón que sql/rls-deny-all-policies.sql: RESTRICTIVE policy
-- que bloquea todo acceso desde anon/authenticated. MediFlow accede
-- a estas tablas vía Prisma + service role (bypassa RLS por diseño).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "modules"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinic_modules"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_usage_logs"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "carts"              ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'modules'
      AND policyname = 'modules_deny_anon'
  ) THEN
    CREATE POLICY "modules_deny_anon" ON "modules"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clinic_modules'
      AND policyname = 'clinic_modules_deny_anon'
  ) THEN
    CREATE POLICY "clinic_modules_deny_anon" ON "clinic_modules"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'module_usage_logs'
      AND policyname = 'module_usage_logs_deny_anon'
  ) THEN
    CREATE POLICY "module_usage_logs_deny_anon" ON "module_usage_logs"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'orders'
      AND policyname = 'orders_deny_anon'
  ) THEN
    CREATE POLICY "orders_deny_anon" ON "orders"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'carts'
      AND policyname = 'carts_deny_anon'
  ) THEN
    CREATE POLICY "carts_deny_anon" ON "carts"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END$$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación post-aplicación (opcional):
--
--   SELECT COUNT(*) FROM modules;                       -- esperar 12 tras seed
--   SELECT COUNT(*) FROM clinics WHERE trial_started_at IS NULL;  -- 0
--   SELECT COUNT(*) FROM clinics WHERE "trialEndsAt"  IS NULL;     -- 0
--   SELECT tablename, policyname FROM pg_policies
--     WHERE policyname LIKE '%marketplace%'
--        OR tablename IN ('modules','clinic_modules','module_usage_logs','orders','carts')
--     ORDER BY tablename;
-- ═══════════════════════════════════════════════════════════════════
