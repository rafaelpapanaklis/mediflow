-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — integridad de la AGENDA y de la FILA VIRTUAL.
--
-- Aplicar manualmente en Supabase (SQL editor). Re-ejecutable: cada bloque
-- comprueba existencia antes de crear, así que correrlo varias veces no
-- produce errores ni duplicados.
--
-- Delimitador único `$barber$`, sin bloques DO anidados (el parser de
-- Supabase rompe con $$ anidado).
--
-- POR QUÉ ESTO NO PUEDE VIVIR EN schema.prisma: Prisma no sabe declarar
-- constraints EXCLUDE ni CHECK. Igual que en el dental (los constraints de
-- agenda viven en prisma/migrations/20260424120000_fase_4_agenda/
-- migration.sql, NO en el schema), la garantía dura es SQL puro.
--
-- QUÉ GARANTIZA:
--   1. Ninguna visita puede durar cero ni al revés (endAt > startAt).
--   2. Es IMPOSIBLE que un barbero tenga dos visitas encimadas — aunque la
--      UI falle, aunque dos peticiones lleguen en el mismo milisegundo,
--      aunque alguien escriba por SQL. Postgres rechaza la segunda.
--      Las canceladas y las de "no llegó" NO estorban (la silla se liberó).
--   3. El horario recurrente es coherente (fin > inicio, dentro del día,
--      día de la semana 0-6 con 0 = domingo).
--   4. Un bloqueo (descanso / vacaciones / festivo) tiene fin > inicio.
--   5. Dos personas que escanean el QR al mismo tiempo NO se llevan el
--      mismo número de fila.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 0. btree_gist: permite mezclar `=` (texto) con `&&` (rango) en un
--       mismo índice GiST. Sin esto el EXCLUDE de abajo no compila. ──────
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- ── 1. Duración estrictamente positiva de la visita ────────────────────
DO $barber$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_appt_positive_duration'
  ) THEN
    ALTER TABLE "barber_appointments"
      ADD CONSTRAINT barber_appt_positive_duration
      CHECK ("endAt" > "startAt");
  END IF;
END
$barber$;


-- ── 2. ANTI DOBLE RESERVA (el corazón de esta ola) ─────────────────────
-- Dos visitas ACTIVAS del mismo barbero no pueden compartir ni un minuto.
-- tstzrange(..., '[)') = intervalo semiabierto: una visita de 10:00 a 10:30
-- y otra de 10:30 a 11:00 NO chocan (se tocan, no se enciman) — mismo
-- criterio que intervalsOverlap() en src/lib/barber/agenda.ts.
--
-- El predicado WHERE debe ser ESPEJO EXACTO de blocksAgenda() en el TS.
-- barberId NULL ("cualquier barbero", aún sin asignar) queda fuera del
-- índice: una visita sin barbero no ocupa silla de nadie todavía.
DO $barber$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_appt_no_overlap'
  ) THEN
    ALTER TABLE "barber_appointments"
      ADD CONSTRAINT barber_appt_no_overlap
      EXCLUDE USING gist (
        "barberId"     WITH =,
        "barbershopId" WITH =,
        tstzrange("startAt", "endAt", '[)') WITH &&
      )
      WHERE (
        "barberId" IS NOT NULL
        AND "status" NOT IN ('CANCELLED', 'NO_SHOW')
      );
  END IF;
END
$barber$;


-- ── 3. Horario recurrente coherente ────────────────────────────────────
-- startMinute/endMinute = minutos desde medianoche EN LA ZONA DE LA
-- BARBERÍA (Barbershop.timezone). 1440 = medianoche del día siguiente, que
-- es el cierre más tarde admisible. Turno partido = varias filas del mismo
-- (barberId, dayOfWeek); esa es la razón de que NO haya un unique aquí.
DO $barber$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_schedule_valid_range'
  ) THEN
    ALTER TABLE "barber_schedules"
      ADD CONSTRAINT barber_schedule_valid_range
      CHECK (
        "startMinute" >= 0
        AND "endMinute" <= 1440
        AND "endMinute" > "startMinute"
        AND "dayOfWeek" BETWEEN 0 AND 6
      );
  END IF;
END
$barber$;


-- ── 4. Bloqueos con duración positiva ──────────────────────────────────
DO $barber$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_time_off_positive_duration'
  ) THEN
    ALTER TABLE "barber_time_off"
      ADD CONSTRAINT barber_time_off_positive_duration
      CHECK ("endAt" > "startAt");
  END IF;
END
$barber$;


-- ── 5. Número de fila único por barbería ───────────────────────────────
-- `position` es un CONTADOR MONOTÓNICO por barbería: se asigna como
-- MAX(position)+1 y JAMÁS se recicla ni se renumera (renumerar con gente
-- dentro es como se pierde un lugar). El número que ve el cliente es su
-- RANGO dentro de la fila activa, no esta columna.
--
-- Sin este índice, dos QR escaneados a la vez leen el mismo MAX y se van
-- los dos con el mismo número. Con él, el segundo choca (P2002) y la API
-- reintenta con el siguiente.
CREATE UNIQUE INDEX IF NOT EXISTS "barber_walkin_position_uniq"
  ON "barber_walkins" ("barbershopId", "position");


-- ── 6. Índices de lectura de la agenda ─────────────────────────────────
-- La pantalla que la barbería tiene abierta TODO EL DÍA pide siempre el
-- mismo rango: una barbería, un rango de fechas, ordenado por hora.
CREATE INDEX IF NOT EXISTS "barber_appt_shop_start_status_idx"
  ON "barber_appointments" ("barbershopId", "startAt", "status");

-- La fila virtual pública se lee por barbería + estado, en orden de llegada.
CREATE INDEX IF NOT EXISTS "barber_walkin_shop_status_position_idx"
  ON "barber_walkins" ("barbershopId", "status", "position");


-- ── 7. Documentación viva en la propia base ────────────────────────────
COMMENT ON CONSTRAINT barber_appt_no_overlap ON "barber_appointments" IS
  'Agenda barber: imposible encimar dos visitas activas del mismo barbero. Ignora CANCELLED y NO_SHOW. Espejo de blocksAgenda() en src/lib/barber/agenda.ts.';
COMMENT ON CONSTRAINT barber_appt_positive_duration ON "barber_appointments" IS
  'Agenda barber: la visita dura al menos un instante (endAt > startAt).';
COMMENT ON CONSTRAINT barber_schedule_valid_range ON "barber_schedules" IS
  'Horario recurrente barber: minutos 0..1440 en la zona de la barberia, fin > inicio, dia 0-6 (0 = domingo). Turno partido = varias filas.';
COMMENT ON CONSTRAINT barber_time_off_positive_duration ON "barber_time_off" IS
  'Bloqueos barber: descanso/vacaciones/festivo con fin > inicio. barberId NULL = barberia cerrada.';
COMMENT ON INDEX "barber_walkin_position_uniq" IS
  'Fila virtual barber: dos QR simultaneos no pueden llevarse el mismo numero. La API reintenta al chocar.';


-- ── 8. Verificación (opcional: corre esto para confirmar que quedó) ────
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conname IN (
--    'barber_appt_no_overlap', 'barber_appt_positive_duration',
--    'barber_schedule_valid_range', 'barber_time_off_positive_duration'
--  );
--
-- Prueba de fuego del anti doble reserva (sustituye los ids por unos
-- reales de tu barbería). El segundo INSERT DEBE fallar con
-- "conflicting key value violates exclusion constraint":
--
-- INSERT INTO "barber_appointments"
--   ("id","barbershopId","barberId","startAt","endAt","status","source","updatedAt")
--   VALUES ('probe-1','<SHOP>','<BARBERO>','2026-09-01 16:00+00','2026-09-01 16:30+00','CONFIRMED','PANEL', now());
-- INSERT INTO "barber_appointments"
--   ("id","barbershopId","barberId","startAt","endAt","status","source","updatedAt")
--   VALUES ('probe-2','<SHOP>','<BARBERO>','2026-09-01 16:15+00','2026-09-01 16:45+00','PENDING','PANEL', now());
-- DELETE FROM "barber_appointments" WHERE id IN ('probe-1','probe-2');
