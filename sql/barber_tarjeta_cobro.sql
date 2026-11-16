-- ws6-t1 · 16-nov-2026 — La tarjeta de estrellas llega sola por WhatsApp después de cobrar.
--
-- Una columna en barber_shops para el interruptor de Configuración
-- «Mandar la tarjeta de estrellas después de cobrar». ENCENDIDO por defecto (decisión de Rafael).
-- Se lee y escribe con SQL crudo (src/lib/barber/tarjeta-cobro.ts): el schema de Prisma no se toca.
--
-- SIN este SQL todo funciona igual: la tarjeta se manda (el valor por defecto es «encendido») y lo
-- único que no se puede es APAGARLO desde Configuración; la pantalla lo avisa.
--
-- Plano, idempotente y aditivo (sin bloques DO). No borra ni cambia nada existente.

ALTER TABLE "barber_shops"
  ADD COLUMN IF NOT EXISTS "starsCardAfterCharge" BOOLEAN NOT NULL DEFAULT true;

-- Comprobación (debe salir 1 fila):
-- SELECT column_name, data_type, column_default FROM information_schema.columns
--  WHERE table_name = 'barber_shops' AND column_name = 'starsCardAfterCharge';
