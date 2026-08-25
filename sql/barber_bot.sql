-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — BOT de WhatsApp que agenda.
--
-- POR QUÉ ESTAS TABLAS NO ESTÁN EN prisma/schema.prisma (a propósito, igual
-- que `barber_payment_settings` de la ola de membresías):
--   · El contrato de esta ola prohíbe tocar prisma/schema.prisma.
--   · Una columna nueva en un modelo Prisma existente rompería TODAS las
--     lecturas de esa tabla hasta que este SQL se aplique.
--   · Una tabla nueva en el schema chocaría con las otras terminales que
--     editan prisma/schema.prisma en paralelo.
--
-- Se leen y escriben con SQL crudo desde src/lib/barber/bot.ts y, si este
-- archivo NO se aplicó todavía, NADA truena: el bot cae a "apagado" (que es
-- el default seguro) y el panel lo dice con todas sus letras.
--
-- ⚠️ OJO CON `prisma db push` / `prisma migrate`: como estas tablas NO están
-- en prisma/schema.prisma a propósito, esos comandos las BORRAN por
-- considerarlas sobrantes. En producción no aplica (el SQL del vertical se
-- corre a mano en Supabase), pero en cualquier base de desarrollo hay que
-- volver a correr ESTE archivo después de un db push. Si falta, el bot
-- simplemente no responde: jamás agenda a ciegas.
--
-- Para deshacerlo:
--   DROP TABLE IF EXISTS "barber_bot_pauses";
--   DROP TABLE IF EXISTS "barber_bot_usage";
--   DROP TABLE IF EXISTS "barber_bot_settings";
--   (No se pierde ninguna cita: las citas del bot son BarberAppointment
--    normales con source = 'WHATSAPP'.)
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Configuración del bot por barbería ─────────────────────────────
-- settings (jsonb) tiene la forma de BarberBotSettings (bot-core.ts):
--   { enabled, tone, hours, abilities, aiDailyCapCents, handoffKeywords… }
-- El contenido lo valida y normaliza normalizeBotSettings() en
-- src/lib/barber/bot-core.ts — la BD solo guarda el blob.
CREATE TABLE IF NOT EXISTS "barber_bot_settings" (
    "barbershopId" TEXT NOT NULL,
    "settings"     JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "barber_bot_settings_pkey" PRIMARY KEY ("barbershopId")
);

DO $barberbot$
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
$barberbot$;


-- ── 2. Gasto de IA por barbería y por DÍA ─────────────────────────────
-- El tope de gasto vive aquí y no en memoria: el panel corre en varias
-- instancias (Vercel) y un contador en RAM no serviría de tope real.
--
-- "day" es la fecha en la ZONA DE LA BARBERÍA (texto YYYY-MM-DD), no un
-- timestamp: el día de una barbería de Tijuana no es el de una de Cancún, y
-- el tope es "por día de la barbería".
--
-- spentMicros: costo acumulado en MILLONÉSIMAS de peso (1 MXN = 1e6). Un
-- turno del bot cuesta fracciones de centavo; en centavos enteros todo se
-- redondearía a 0 y el tope nunca se alcanzaría.
CREATE TABLE IF NOT EXISTS "barber_bot_usage" (
    "barbershopId" TEXT NOT NULL,
    "day"          TEXT NOT NULL,
    "spentMicros"  BIGINT NOT NULL DEFAULT 0,
    "turns"        INTEGER NOT NULL DEFAULT 0,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "barber_bot_usage_pkey" PRIMARY KEY ("barbershopId", "day")
);

DO $barberbot$
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
$barberbot$;

-- Barrer lo viejo es barato con este índice (el panel solo mira ~30 días).
CREATE INDEX IF NOT EXISTS "barber_bot_usage_day_idx"
  ON "barber_bot_usage" ("day");


-- ── 3. Conversaciones con el bot PAUSADO ──────────────────────────────
-- Una fila = "en este hilo NO contesta el bot, lo atiende una persona".
-- La crea el propio bot cuando no entiende o cuando el cliente pide hablar
-- con alguien, y la borra el panel al reanudar.
--
-- phone son los 10 dígitos normalizados (mxTenDigits), igual que
-- BarberMessage.phone: así el hilo del Inbox y la pausa hablan del mismo.
CREATE TABLE IF NOT EXISTS "barber_bot_pauses" (
    "barbershopId" TEXT NOT NULL,
    "phone"        TEXT NOT NULL,
    "reason"       TEXT,
    "pausedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "barber_bot_pauses_pkey" PRIMARY KEY ("barbershopId", "phone")
);

DO $barberbot$
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
$barberbot$;

CREATE INDEX IF NOT EXISTS "barber_bot_pauses_shop_idx"
  ON "barber_bot_pauses" ("barbershopId", "pausedAt" DESC);
