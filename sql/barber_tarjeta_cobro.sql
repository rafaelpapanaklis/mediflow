-- ws6-t1 · 16-nov-2026 — La tarjeta de estrellas llega sola por WhatsApp después de cobrar.
--
-- Una columna en barber_shops para el interruptor de Configuración
-- «Mandar la tarjeta de estrellas después de cobrar», con TRES posiciones (decisión de Rafael):
--   'free'   → «Solo cuando sea gratis» (POR DEFECTO): solo si el cliente escribió en las últimas
--              24 h (texto libre: Meta no cobra). Si no, no se manda y Caja ofrece el botón manual.
--   'always' → «Siempre»: dentro de las 24 h gratis; fuera, con la plantilla aprobada (Meta lo cobra).
--   'off'    → «No mandar».
-- Se lee y escribe con SQL crudo (src/lib/barber/tarjeta-cobro-ajuste.ts): el schema de Prisma no se toca.
--
-- SIN este SQL todo funciona: vale 'free' (nunca genera un cobro de Meta) y lo único que no se puede
-- es cambiarlo desde Configuración; la pantalla lo avisa.
--
-- Plano, idempotente y aditivo (sin bloques DO). No borra ni cambia nada existente.

ALTER TABLE "barber_shops"
  ADD COLUMN IF NOT EXISTS "starsCardMode" TEXT NOT NULL DEFAULT 'free';

ALTER TABLE "barber_shops"
  DROP CONSTRAINT IF EXISTS "barber_shops_starsCardMode_check";

ALTER TABLE "barber_shops"
  ADD CONSTRAINT "barber_shops_starsCardMode_check" CHECK ("starsCardMode" IN ('free', 'always', 'off'));

-- Comprobación (debe salir 1 fila con column_default 'free'::text):
-- SELECT column_name, data_type, column_default FROM information_schema.columns
--  WHERE table_name = 'barber_shops' AND column_name = 'starsCardMode';
