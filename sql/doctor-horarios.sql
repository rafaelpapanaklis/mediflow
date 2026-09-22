-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T2 · HORARIO PROPIO POR DOCTOR.
--
-- Crea UNA tabla nueva ("doctor_schedules"). NO toca ni una tabla, ni una
-- columna, ni una fila de lo que ya existe: ni un ALTER sobre "clinics", ni
-- sobre "users", ni sobre "clinic_schedules". Las relaciones se declaran
-- desde la tabla nueva hacia las viejas, así que entra en una base VIVA sin
-- ventana de mantenimiento.
--
-- QUÉ RESUELVE: hasta ahora el horario era SOLO de la clínica
-- ("clinic_schedules"): una jornada para todos los doctores. Con esto un
-- doctor puede decir «nunca trabajo los miércoles» o «los viernes solo por la
-- mañana», y ni recepción, ni el bot, ni Sabina, ni la web lo agendan fuera.
--
--   · «el 12 de noviembre no vengo» → eso es un BLOQUEO ("agenda_blocks").
--   · «nunca trabajo los miércoles» → eso es un HORARIO (esta tabla).
--
-- 🔴 APLICARLO NO CAMBIA NINGUNA AGENDA. La tabla nace vacía, y un doctor
-- SIN filas aquí sigue el horario de la clínica exactamente como hoy. Solo
-- cambia la agenda de quien entra y define su horario a propósito.
--
-- GENERADO con `prisma migrate diff` desde el bloque DoctorSchedule de
-- prisma/schema.prisma y hecho idempotente: cada bloque comprueba existencia
-- antes de crear, así que correrlo varias veces no produce errores ni
-- duplicados. CERO DROP.
--
-- Contenido:
--   1 tabla   · doctor_schedules
--   2 índices · 1 único (doctorId, dayOfWeek) + 1 de consulta (clinicId, doctorId)
--   2 llaves foráneas · clinics y users, las dos ON DELETE CASCADE
--   RLS deny-all para anon/authenticated (patrón sql/rls-deny-all-policies.sql)
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`: hay migraciones del
-- repo sin registrar contra producción y se llevarían la base por delante.
--
-- Nota sobre $$: delimitador con nombre, $hdoc$, y NUNCA bloques DO anidados
-- — el parser SQL de Supabase rompe con $$ anidado.
--
-- Nota sobre los nombres: las columnas van en camelCase ENTRECOMILLADO porque
-- así las escribe Prisma; sin comillas Postgres las bajaría a minúsculas y el
-- cliente dejaría de encontrarlas.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. La tabla ────────────────────────────────────────────────────────
-- La MISMA forma que "clinic_schedules": una fila por día de la semana.
--   · "dayOfWeek" 0=Lunes … 6=Domingo (≠ getDay de JavaScript, que empieza
--     en domingo). Es la convención de "clinic_schedules".
--   · "enabled" = false → ese día el doctor no atiende aunque la clínica abra.
--   · "openTime"/"closeTime" son horas de PARED "HH:MM" en la zona de la
--     clínica, no instantes: se repiten cada semana.
--
-- El horario del doctor NO puede salirse del de la clínica: lo que se ofrece
-- es la INTERSECCIÓN (abre la clínica ∩ atiende el doctor ∩ no hay bloqueo).
-- Si aquí se guarda 08:00–20:00 y la clínica abre 09:00–18:00, se agenda
-- 09:00–18:00. Eso lo recorta el código, no una constraint.
CREATE TABLE IF NOT EXISTS "doctor_schedules" (
  "id"        TEXT NOT NULL,
  "clinicId"  TEXT NOT NULL,
  "doctorId"  TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "enabled"   BOOLEAN NOT NULL DEFAULT true,
  "openTime"  TEXT NOT NULL DEFAULT '09:00',
  "closeTime" TEXT NOT NULL DEFAULT '18:00',
  CONSTRAINT "doctor_schedules_pkey" PRIMARY KEY ("id")
);


-- ── 2. Los índices ─────────────────────────────────────────────────────
-- Un doctor tiene como mucho UNA fila por día de la semana. Es lo que permite
-- guardar la semana entera con un upsert por día sin duplicar nada.
CREATE UNIQUE INDEX IF NOT EXISTS "doctor_schedules_doctorId_dayOfWeek_key"
  ON "doctor_schedules" ("doctorId", "dayOfWeek");

-- La consulta de siempre: «el horario de estos doctores de esta clínica»,
-- que es WHERE "clinicId" = ? AND "doctorId" IN (…).
CREATE INDEX IF NOT EXISTS "doctor_schedules_clinicId_doctorId_idx"
  ON "doctor_schedules" ("clinicId", "doctorId");


-- ── 3. Las llaves foráneas ─────────────────────────────────────────────
-- CASCADE en las dos: el horario no tiene sentido sin su clínica ni sin su
-- doctor. Borrar un usuario (operación de administración) no se puede atorar
-- en esta tabla, y un horario huérfano no le sirve a nadie.
DO $hdoc$
BEGIN
  ALTER TABLE "doctor_schedules"
    ADD CONSTRAINT "doctor_schedules_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$hdoc$;

DO $hdoc$
BEGIN
  ALTER TABLE "doctor_schedules"
    ADD CONSTRAINT "doctor_schedules_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$hdoc$;


-- ── 4. Defense-in-depth: RLS deny-all ──────────────────────────────────
-- Mismo patrón que sql/rls-deny-all-policies.sql, que ya cubre
-- "clinic_schedules". DaleControl accede solo vía Prisma + service role
-- (bypassa RLS). Esto cierra PostgREST si se filtra el anon key.
DO $hdoc$
BEGIN
  EXECUTE 'ALTER TABLE "doctor_schedules" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'doctor_schedules' AND policyname = 'doctor_schedules_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "doctor_schedules_deny_anon" ON "doctor_schedules" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'doctor_schedules no existe — RLS saltada';
END
$hdoc$;


-- ── 5. Comprobación ────────────────────────────────────────────────────
-- Tiene que devolver 1 tabla, 3 índices (los 2 de arriba + la llave
-- primaria), 2 llaves foráneas, 1 política y 0 filas.
SELECT
  (SELECT count(*) FROM pg_tables  WHERE tablename = 'doctor_schedules')      AS tablas,
  (SELECT count(*) FROM pg_indexes WHERE tablename = 'doctor_schedules')      AS indices_mas_pk,
  (SELECT count(*) FROM pg_constraint
     WHERE conrelid = 'doctor_schedules'::regclass AND contype = 'f')         AS llaves_foraneas,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'doctor_schedules')     AS politicas,
  (SELECT count(*) FROM "doctor_schedules")                                   AS filas;
