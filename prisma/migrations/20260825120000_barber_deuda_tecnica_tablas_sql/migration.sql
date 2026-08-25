-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — alinear el historial de Prisma con lo que YA existe.
--
-- Durante las olas en paralelo el schema estuvo congelado y estas cinco
-- tablas y siete columnas se crearon SOLO desde sql/barber_membresias.sql,
-- sql/barber_admin.sql, sql/barber_bot.sql, sql/barber_clientes.sql,
-- sql/barber_campanas.sql y sql/barber_settings.sql. Prisma no las conocía
-- y un `prisma db push` las borraba.
--
-- Esta migración es el espejo EXACTO de esos archivos y es IDEMPOTENTE a
-- propósito: en una base donde ya se aplicaron (producción) no hace NADA
-- — solo deja el historial alineado; en una base nueva crea lo mismo que
-- ellos. Comprobado con `prisma migrate diff` (diff vacío) contra una base
-- con el schema anterior + esos seis .sql.
--
-- Lo que NO está aquí, a propósito:
--   · el bucket privado `barber-files` (storage.buckets es de Supabase, no
--     de Postgres) — sigue viviendo solo en sql/barber_clientes.sql;
--   · nada del dental: ni una tabla fuera de barber_*.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. barber_shops: siete columnas de configuración ──────────────────
-- sql/barber_clientes.sql — fidelidad e inactividad
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "loyaltyEnabled"   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "loyaltyThreshold" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "loyaltyReward"    TEXT;
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "inactiveDays"     INTEGER NOT NULL DEFAULT 60;

-- sql/barber_campanas.sql — campañas de retención
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "campaignCooldownDays" INTEGER NOT NULL DEFAULT 21;
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "campaignTemplates"    JSONB;

-- sql/barber_settings.sql — política de la reserva pública
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "bookingPolicy" TEXT NOT NULL DEFAULT 'manual';

-- Los CHECK no los modela Prisma (la capa de negocio repite los rangos);
-- se conservan para que ni un UPDATE manual meta basura.
DO $barberdt$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_shops_loyaltyThreshold_range') THEN
    ALTER TABLE "barber_shops"
      ADD CONSTRAINT "barber_shops_loyaltyThreshold_range"
      CHECK ("loyaltyThreshold" >= 1 AND "loyaltyThreshold" <= 100);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_shops_inactiveDays_range') THEN
    ALTER TABLE "barber_shops"
      ADD CONSTRAINT "barber_shops_inactiveDays_range"
      CHECK ("inactiveDays" >= 7 AND "inactiveDays" <= 730);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_shops_campaign_cooldown_check') THEN
    ALTER TABLE "barber_shops"
      ADD CONSTRAINT "barber_shops_campaign_cooldown_check"
      CHECK ("campaignCooldownDays" >= 3 AND "campaignCooldownDays" <= 180);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_shops_bookingPolicy_check') THEN
    ALTER TABLE "barber_shops"
      ADD CONSTRAINT "barber_shops_bookingPolicy_check"
      CHECK ("bookingPolicy" IN ('manual', 'auto'));
  END IF;
END
$barberdt$;


-- ── 2. Índices de apoyo sobre tablas que ya estaban en el schema ───────
-- sql/barber_membresias.sql
CREATE INDEX IF NOT EXISTS "barber_client_memberships_shop_end_idx"
  ON "barber_client_memberships" ("barbershopId", "endAt");

-- sql/barber_clientes.sql
CREATE INDEX IF NOT EXISTS "barber_clients_shop_lastVisit_idx"
  ON "barber_clients" ("barbershopId", "lastVisitAt");
CREATE INDEX IF NOT EXISTS "barber_clients_shop_phone_idx"
  ON "barber_clients" ("barbershopId", "phone");
-- Índice de EXPRESIÓN: Prisma no lo modela, pero una base nueva lo necesita
-- igual que producción.
CREATE INDEX IF NOT EXISTS "barber_clients_shop_birthday_month_idx"
  ON "barber_clients" ("barbershopId", (EXTRACT(MONTH FROM "birthday")))
  WHERE "birthday" IS NOT NULL;

-- sql/barber_campanas.sql — índice PARCIAL (tampoco lo modela Prisma)
CREATE INDEX IF NOT EXISTS "barber_messages_campaign_idx"
  ON "barber_messages" ("barbershopId", "createdAt" DESC)
  WHERE "templateName" IN ('dc_barber_cumpleanos', 'dc_barber_te_extranamos');


-- ── 3. barber_payment_settings (sql/barber_membresias.sql) ─────────────
CREATE TABLE IF NOT EXISTS "barber_payment_settings" (
    "barbershopId" TEXT NOT NULL,
    "settings"     JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "barber_payment_settings_pkey" PRIMARY KEY ("barbershopId")
);

DO $barberdt$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_payment_settings_barbershopId_fkey'
  ) THEN
    ALTER TABLE "barber_payment_settings"
      ADD CONSTRAINT "barber_payment_settings_barbershopId_fkey"
      FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$barberdt$;


-- ── 4. barber_admin_actions (sql/barber_admin.sql) ─────────────────────
-- snake_case y timestamptz: así nació en producción y así se queda.
CREATE TABLE IF NOT EXISTS barber_admin_actions (
  id             text        PRIMARY KEY,
  barbershop_id  text        NOT NULL REFERENCES barber_shops(id) ON DELETE CASCADE,
  -- SUSPEND | REACTIVATE | PLAN_CHANGE
  action         text        NOT NULL,
  note           text        NOT NULL,
  before_value   text,
  after_value    text,
  -- admin_users.id, SIN FK a propósito (borrar un admin no rompe la bitácora).
  actor_admin_id text,
  actor_email    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS barber_admin_actions_shop_idx
  ON barber_admin_actions (barbershop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS barber_admin_actions_created_idx
  ON barber_admin_actions (created_at DESC);

COMMENT ON TABLE barber_admin_actions IS
  'Acciones manuales de DaleControl sobre una barbería (suspender, reactivar, cambiar plan) con nota obligatoria. La escribe src/lib/barber/admin.ts.';


-- ── 5. Bot de WhatsApp (sql/barber_bot.sql) ────────────────────────────
CREATE TABLE IF NOT EXISTS "barber_bot_settings" (
    "barbershopId" TEXT NOT NULL,
    "settings"     JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "barber_bot_settings_pkey" PRIMARY KEY ("barbershopId")
);

DO $barberdt$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_bot_settings_barbershopId_fkey'
  ) THEN
    ALTER TABLE "barber_bot_settings"
      ADD CONSTRAINT "barber_bot_settings_barbershopId_fkey"
      FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$barberdt$;

CREATE TABLE IF NOT EXISTS "barber_bot_usage" (
    "barbershopId" TEXT NOT NULL,
    "day"          TEXT NOT NULL,
    "spentMicros"  BIGINT NOT NULL DEFAULT 0,
    "turns"        INTEGER NOT NULL DEFAULT 0,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "barber_bot_usage_pkey" PRIMARY KEY ("barbershopId", "day")
);

DO $barberdt$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_bot_usage_barbershopId_fkey'
  ) THEN
    ALTER TABLE "barber_bot_usage"
      ADD CONSTRAINT "barber_bot_usage_barbershopId_fkey"
      FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$barberdt$;

CREATE INDEX IF NOT EXISTS "barber_bot_usage_day_idx"
  ON "barber_bot_usage" ("day");

CREATE TABLE IF NOT EXISTS "barber_bot_pauses" (
    "barbershopId" TEXT NOT NULL,
    "phone"        TEXT NOT NULL,
    "reason"       TEXT,
    "pausedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "barber_bot_pauses_pkey" PRIMARY KEY ("barbershopId", "phone")
);

DO $barberdt$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_bot_pauses_barbershopId_fkey'
  ) THEN
    ALTER TABLE "barber_bot_pauses"
      ADD CONSTRAINT "barber_bot_pauses_barbershopId_fkey"
      FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$barberdt$;

CREATE INDEX IF NOT EXISTS "barber_bot_pauses_shop_idx"
  ON "barber_bot_pauses" ("barbershopId", "pausedAt" DESC);
