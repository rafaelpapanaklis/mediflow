-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T1 · «Ortodoncia conectada al bot», ronda 2.
--
-- Decisión del gerente: interruptores SEPARADOS. El bot ya podía contestar
-- "¿cuándo es mi próximo control?" (ronda 1), pero detrás del MISMO
-- interruptor que el de dinero (Clinic.reminderSettings.cobranza.bot). Esta
-- columna es el interruptor propio, ENCENDIDO de fábrica (no revela dinero,
-- solo una fecha de cita) — a diferencia de cobranza.bot, que sigue apagado
-- de fábrica.
--
-- UNA columna, ADITIVA, boolean plana (sin CREATE TYPE, sin bloques DO):
--   "orthodontics_clinic_settings"."proximoControlBotEnabled"
--   NULL = encendido (comportamiento de hoy, sin tocar nada). El código lo
--   lee así: `raw !== false` → encendido.
--
-- NO toca ni una fila que ya exista: todas nacen NULL, que es "encendido".
-- IDEMPOTENTE (ADD COLUMN IF NOT EXISTS). CERO DROP. PLANO.
--
-- El código YA tolera que esta columna aún no exista (P2021/P2022, mismo
-- criterio que sql/ortodoncia-modo-cobro.sql): clinic-settings-db.ts cae a
-- los defaults sin tumbar la pantalla de Configuración mientras esto no
-- esté pegado.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "orthodontics_clinic_settings"
  ADD COLUMN IF NOT EXISTS "proximoControlBotEnabled" BOOLEAN;

-- Comprobación (solo lee):
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'orthodontics_clinic_settings'
  AND column_name = 'proximoControlBotEnabled';
