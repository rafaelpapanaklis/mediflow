-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — CONFIGURACIÓN de la barbería (/barber/configuracion).
--
-- PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase.
-- Depende de sql/barber.sql. Conviene aplicarlo junto con
-- sql/barber_clientes.sql (fidelidad e inactividad) y
-- sql/barber_campanas.sql (días de descanso entre campañas): la pantalla de
-- configuración edita las tres cosas y avisa, sección por sección, cuál de
-- los tres archivos falta.
--
-- QUÉ HACE, Y POR QUÉ NO TOCA prisma/schema.prisma
-- El contrato del vertical prohíbe cambiar el schema Prisma. El interruptor
-- "la reserva en línea se confirma sola o pasa por Solicitudes" no tenía
-- columna: hasta hoy se leía de la llave `bookingPolicy` del Json de la
-- mini-web (BarberLandingConfig.config), que el editor de "Mi web" BORRA
-- cada vez que guarda (normaliza el Json contra su vocabulario y descarta lo
-- que no conoce). Un ajuste que se pierde solo no es un ajuste: por eso vive
-- aquí, como columna suelta de `barber_shops`, leída y escrita con SQL
-- parametrizado ($queryRaw). Mismo patrón que sql/barber_clientes.sql.
--
-- SI ESTE ARCHIVO NO SE APLICA, TODO SIGUE FUNCIONANDO: la lectura atrapa el
-- 42703 (columna inexistente) y cae al default seguro `manual` (la cita nace
-- PENDING y se acepta en /barber/solicitudes). Lo único que no se puede es
-- cambiarlo desde el panel — la pantalla lo dice con un aviso.
--
-- IDEMPOTENTE: re-ejecutable sin efectos colaterales. Delimitador único
-- `$barberset$`, nunca anidado (el parser de Supabase rompe con $$ dentro
-- de $$).
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Política de confirmación de la reserva pública ──────────────────
-- 'manual' → la cita nace PENDING y la barbería la acepta o rechaza.
-- 'auto'   → la cita nace CONFIRMED.
-- En los dos casos la cita EXISTE y aparta el hueco (ver
-- resolveBookingPolicy en src/lib/barber/booking.ts).
ALTER TABLE "barber_shops"
  ADD COLUMN IF NOT EXISTS "bookingPolicy" TEXT NOT NULL DEFAULT 'manual';

DO $barberset$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_shops_bookingPolicy_check'
  ) THEN
    ALTER TABLE "barber_shops"
      ADD CONSTRAINT "barber_shops_bookingPolicy_check"
      CHECK ("bookingPolicy" IN ('manual', 'auto'));
  END IF;
END
$barberset$;


-- ── 2. Comprobación ────────────────────────────────────────────────────
-- SELECT "id", "name", "slug", "bookingPolicy" FROM "barber_shops" LIMIT 5;
