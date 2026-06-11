-- ══════════════════════════════════════════════════════════════════════
-- DaleControl — OPCIONAL: diagnóstico + normalización de
-- whatsapp_reminders.status
--
-- Contexto (2026-06-10): la columna status es TEXT en prod; el type
-- Postgres "WhatsAppReminderStatus" nunca se creó (drift de mayo). El
-- código ya quedó alineado (campo String en Prisma) y el worker trata el
-- legacy 'ACTIVE' como pendiente y lo normaliza al procesar; además
-- expira solo cualquier pendiente con >7 días de atraso. Por lo tanto
-- este script NO es necesario para que nada funcione.
--
-- Corre primero los SELECT de diagnóstico, mira los números y SOLO
-- entonces decide si descomentar el UPDATE.
-- Run in: https://supabase.com/dashboard/project/nyvcwjdpwxzqlwjwjimv/sql/new
-- ══════════════════════════════════════════════════════════════════════

-- 1) Tipo real de la columna (esperado: text)
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'whatsapp_reminders' AND column_name = 'status';

-- 2) Valores DISTINCT con conteos y rangos de fechas (¿cuánta fila legacy
--    'ACTIVE' hay y de cuándo?)
SELECT status,
       COUNT(*)            AS filas,
       MIN("createdAt")    AS creada_min,
       MAX("createdAt")    AS creada_max,
       MIN("scheduledFor") AS sched_min,
       MAX("scheduledFor") AS sched_max
FROM whatsapp_reminders
GROUP BY status
ORDER BY filas DESC;

-- 3) OPCIONAL — normalización de filas legacy 'ACTIVE'.
--    Si NO corres nada: el worker las tratará como pendientes; las que
--    tengan scheduledFor con >7 días de atraso las cierra él mismo como
--    CANCELLED ("Expirado…") sin enviar nada.
--    Descomenta SOLO si prefieres cerrarlas todas de una vez:
-- UPDATE whatsapp_reminders
-- SET status     = 'CANCELLED',
--     "errorMsg" = COALESCE("errorMsg", 'Normalizado: legacy ACTIVE (drift enum, 2026-06-10)')
-- WHERE status = 'ACTIVE';

--    (Variante si en cambio quieres que el worker SÍ intente procesarlas
--     como pendientes frescas — normalmente NO recomendado:)
-- UPDATE whatsapp_reminders SET status = 'PENDING' WHERE status = 'ACTIVE';

-- ══════════════════════════════════════════════════════════════════════
-- APÉNDICE (solo lectura) — otros enums sospechosos del mismo drift.
-- El barrido de código encontró que payment_plans se crea en
-- sql/migration_features6.sql con status y frequency como TEXT, pero el
-- schema de Prisma los declara como enums PlanStatus / PaymentFrequency.
-- Estos SELECT confirman o descartan; NO modifican nada.
-- ══════════════════════════════════════════════════════════════════════

-- A) ¿Qué types enum existen realmente en prod? (de los dudosos)
SELECT t.typname
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typtype = 'e'
  AND t.typname IN (
    'WhatsAppReminderStatus', 'PlanStatus', 'PaymentFrequency',
    'AppointmentStatus', 'PatientStatus', 'Gender', 'Plan', 'ClinicCategory'
  );

-- B) Tipo real de las columnas de payment_plans declaradas como enum en
--    Prisma (si data_type = text ⇒ mismo bug latente que whatsapp_reminders)
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'payment_plans'
  AND column_name IN ('status', 'frequency');
