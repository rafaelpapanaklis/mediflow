-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T2 · LOS BLOQUEOS DE AGENDA.
--
-- Crea UNA tabla nueva ("agenda_blocks") y UN enum nuevo
-- ("AgendaBlockKind"). NO toca ni una tabla, ni una columna, ni una fila de
-- lo que ya existe: ni un ALTER sobre "clinics", ni sobre "users", ni sobre
-- "appointments". Las relaciones se declaran desde la tabla nueva hacia las
-- viejas, que es lo que permite que esto entre en una base VIVA sin ventana
-- de mantenimiento.
--
-- QUÉ RESUELVE: hasta ahora dental no sabía cerrar un día ni unas horas. Lo
-- único que conocía era "clinic_schedules", el horario SEMANAL, así que para
-- cerrar el 25 de diciembre había que apagar los jueves —y con ellos los 52
-- jueves del año— o no cerrarlo.
--
-- GENERADO desde el bloque AgendaBlock de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   1 enum   · "AgendaBlockKind"
--   1 tabla  · agenda_blocks
--   3 índices · 1 único parcial-no (el del festivo) + 2 de consulta
--   4 llaves foráneas · clinics (CASCADE) y users ×3 (SET NULL)
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`: hay migraciones del
-- repo sin registrar contra producción y se llevarían la base por delante.
--
-- Nota sobre $$: delimitador con nombre, $bloq$, y NUNCA bloques DO
-- anidados — el parser SQL de Supabase rompe con $$ anidado.
--
-- Nota sobre los nombres: las columnas van en camelCase ENTRECOMILLADO
-- porque así las escribe Prisma; sin comillas Postgres las bajaría a
-- minúsculas y el cliente dejaría de encontrarlas.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. El enum ─────────────────────────────────────────────────────────
-- Por qué está cerrado el hueco. Solo cambia la etiqueta y el ícono: el
-- alcance y el solape no dependen del tipo.
DO $bloq$
BEGIN
  CREATE TYPE "AgendaBlockKind" AS ENUM (
    'FESTIVO', 'VACACIONES', 'PERSONAL', 'MANTENIMIENTO', 'OTRO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$bloq$;


-- ── 2. La tabla ────────────────────────────────────────────────────────
-- EL ALCANCE LO DA EL NULL, y es toda la tabla en dos líneas:
--   · "doctorId" = NULL → LA CLÍNICA ENTERA. No entra nada, de nadie.
--   · "doctorId" = X    → solo X. A los demás doctores no les afecta.
--
-- "startsAt"/"endsAt" son INSTANTES (timestamptz), no horas de pared: se
-- comparan contra citas, que son instantes. La conversión desde lo que
-- teclea la pantalla ("el 25, todo el día") la hace el SERVIDOR con la zona
-- de la clínica.
--
-- El intervalo es SEMIABIERTO [startsAt, endsAt): un bloqueo que termina a
-- las 16:00 NO estorba a una cita que empieza a las 16:00. Es el mismo
-- criterio que la constraint appt_doctor_no_overlap de las citas.
CREATE TABLE IF NOT EXISTS "agenda_blocks" (
  "id"            TEXT NOT NULL,
  "clinicId"      TEXT NOT NULL,
  "doctorId"      TEXT,
  "kind"          "AgendaBlockKind" NOT NULL DEFAULT 'OTRO',
  -- Obligatorio: un hueco cerrado sin motivo es una llamada de teléfono.
  "reason"        VARCHAR(200) NOT NULL,
  "startsAt"      TIMESTAMPTZ(3) NOT NULL,
  "endsAt"        TIMESTAMPTZ(3) NOT NULL,
  -- Sello del catálogo de festivos: 'MX-2026-NAVIDAD'. NULL si es a mano.
  "holidayKey"    VARCHAR(40),
  "createdById"   TEXT,
  -- El nombre se CONGELA al crear: el bloqueo sigue diciendo quién lo puso
  -- aunque esa persona se vaya de la clínica.
  "createdByName" VARCHAR(160) NOT NULL,
  -- Borrado SUAVE. Un bloqueo retirado explica por qué esa tarde de hace
  -- tres meses no hubo nadie en la clínica.
  "deletedAt"     TIMESTAMPTZ(3),
  "deletedById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agenda_blocks_pkey" PRIMARY KEY ("id")
);


-- ── 3. Los índices ─────────────────────────────────────────────────────
-- El único del festivo: el mismo festivo no se aplica dos veces en la misma
-- clínica. En Postgres los NULL son distintos entre sí en un índice único,
-- así que las filas puestas A MANO (holidayKey NULL) no se estorban: pueden
-- ser tantas como haga falta.
--
-- ⚠️ POR ESO el servidor PONE "holidayKey" EN NULL AL RETIRAR un bloqueo
-- (retirarBloqueo en src/lib/agenda-bloqueos/service.ts). La fila retirada
-- no desaparece —es baja lógica—, así que si conservara su clave, quitar la
-- Navidad y volver a ponerla daría error de duplicado para siempre. La
-- alternativa habría sido un índice único PARCIAL (WHERE "deletedAt" IS
-- NULL), que Prisma 5 no sabe declarar: el schema y la base quedarían
-- distintos, y esa diferencia es justo la que nadie quiere heredar.
CREATE UNIQUE INDEX IF NOT EXISTS "agenda_blocks_festivo_unico"
  ON "agenda_blocks" ("clinicId", "holidayKey");

-- La consulta de siempre: «los bloqueos que SOLAPAN este rango», que es
-- WHERE "clinicId" = ? AND "startsAt" < ? AND "endsAt" > ?.
CREATE INDEX IF NOT EXISTS "agenda_blocks_rango_idx"
  ON "agenda_blocks" ("clinicId", "startsAt", "endsAt");

-- La misma, acotada a un doctor: la usan el bot, el portal y Sabina.
CREATE INDEX IF NOT EXISTS "agenda_blocks_doctor_idx"
  ON "agenda_blocks" ("clinicId", "doctorId", "startsAt");


-- ── 4. Las llaves foráneas ─────────────────────────────────────────────
-- CASCADE en la clínica: borrar una clínica entera (operación de
-- administración, no del panel) no se puede atorar en una FK.
-- SET NULL en los tres user: que una persona deje la clínica no puede
-- borrar el bloqueo ni cambiar lo que la agenda hace. Por eso existe
-- "createdByName", que guarda el nombre congelado.
DO $bloq$
BEGIN
  ALTER TABLE "agenda_blocks"
    ADD CONSTRAINT "agenda_blocks_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$bloq$;

DO $bloq$
BEGIN
  ALTER TABLE "agenda_blocks"
    ADD CONSTRAINT "agenda_blocks_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$bloq$;

DO $bloq$
BEGIN
  ALTER TABLE "agenda_blocks"
    ADD CONSTRAINT "agenda_blocks_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$bloq$;

DO $bloq$
BEGIN
  ALTER TABLE "agenda_blocks"
    ADD CONSTRAINT "agenda_blocks_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$bloq$;


-- ── 5. Comprobación ────────────────────────────────────────────────────
-- Tiene que devolver 1 tabla, 3 índices y 4 llaves foráneas.
SELECT
  (SELECT count(*) FROM pg_tables  WHERE tablename = 'agenda_blocks')          AS tablas,
  (SELECT count(*) FROM pg_indexes WHERE tablename = 'agenda_blocks')          AS indices_mas_pk,
  (SELECT count(*) FROM pg_constraint
     WHERE conrelid = 'agenda_blocks'::regclass AND contype = 'f')             AS llaves_foraneas;
