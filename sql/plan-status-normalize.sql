-- ══════════════════════════════════════════════════════════════════════
-- DaleControl — OPCIONAL: diagnóstico + normalización de
-- payment_plans.status / payment_plans.frequency
--
-- Contexto (2026-06-10): ambas columnas son TEXT en prod (la tabla se creó
-- en sql/migration_features6.sql, sin CREATE TYPE); los types Postgres
-- "PlanStatus" y "PaymentFrequency" nunca existieron. Mismo drift que
-- whatsapp_reminders.status (42704, fix b84160c). El código ya quedó
-- alineado (campos String en Prisma + constantes en
-- src/lib/payment-plans/status.ts), así que este script NO es necesario
-- para que nada funcione.
--
-- A diferencia de whatsapp_reminders aquí NO se esperan valores legacy:
-- la tabla nace con DEFAULT 'ACTIVE'/'MONTHLY' y el código siempre
-- escribió valores canónicos en mayúsculas. Corre los SELECT para
-- confirmarlo y SOLO si aparece algo fuera del set descomenta el UPDATE.
-- Run in: https://supabase.com/dashboard/project/nyvcwjdpwxzqlwjwjimv/sql/new
-- ══════════════════════════════════════════════════════════════════════

-- 1) Tipo real de las columnas (esperado: text en ambas)
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'payment_plans'
  AND column_name IN ('status', 'frequency');

-- 2) Valores DISTINCT de status con conteos y fechas (canónicos:
--    ACTIVE | COMPLETED | CANCELLED | OVERDUE)
SELECT status,
       COUNT(*)         AS filas,
       MIN("createdAt") AS creada_min,
       MAX("createdAt") AS creada_max
FROM payment_plans
GROUP BY status
ORDER BY filas DESC;

-- 3) Valores DISTINCT de frequency (canónicos: WEEKLY | BIWEEKLY | MONTHLY)
SELECT frequency, COUNT(*) AS filas
FROM payment_plans
GROUP BY frequency
ORDER BY filas DESC;

-- 4) OPCIONAL — normalización. Solo si el paso 2/3 mostró valores fuera
--    del set canónico (no debería haber). Plantillas, descomenta y ajusta:
-- UPDATE payment_plans
-- SET status = 'ACTIVE',
--     notes  = COALESCE(notes, '') || ' [Normalizado: status fuera de set (drift enum, 2026-06-10)]'
-- WHERE status NOT IN ('ACTIVE', 'COMPLETED', 'CANCELLED', 'OVERDUE');

-- UPDATE payment_plans
-- SET frequency = 'MONTHLY'
-- WHERE frequency NOT IN ('WEEKLY', 'BIWEEKLY', 'MONTHLY');
