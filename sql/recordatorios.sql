-- Recordatorios automáticos de citas (feat/recordatorios-citas)
-- Idempotente: se puede correr varias veces en el SQL editor de Supabase.

-- Config de recordatorios por clínica (JSON):
-- { enabled, offsets: [minutos antes], channel: "whatsapp"|"email"|"both", template }
-- null = fallback a los campos legacy waReminderActive/waReminder24h/waReminder1h/waReminderMsg.
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "reminderSettings" JSONB;

-- Token público aleatorio por cita para confirmar/cancelar por link sin exponer ids.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "confirmToken" TEXT;

-- Único (mismo nombre que generaría Prisma para @unique).
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_confirmToken_key"
  ON "appointments"("confirmToken");
