-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola 2 · EL PISO CLÍNICO.
--
-- Va DESPUÉS de sql/edu-ola-0.sql y sql/edu-ola-1.sql (necesita
-- "edu_institutions", "edu_users", "edu_students" y "edu_programs").
-- Producto SEPARADO del dental, que está VIVO en producción: este archivo
-- NO toca ni una tabla, ni una columna, ni una fila del dental, de
-- barbería ni de inmuebles.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   5 enums    · "EduPatientStatus", "EduSex", "EduCaseStatus",
--                "EduAppointmentType", "EduAppointmentStatus"
--   5 tablas   · edu_patients, edu_chairs, edu_chair_schedules,
--                edu_cases, edu_appointments
--  15 índices  · 2 únicos + 13 de consulta
--  17 llaves foráneas
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run. Es la ÚNICA fuente
-- de verdad del SQL del vertical; las mismas tablas están en
-- prisma/schema.prisma, así que un `prisma db push` no se las lleva.
--
-- Nota sobre $$: delimitador con nombre, $edu$, y NUNCA bloques DO
-- anidados — el parser SQL de Supabase rompe con $$ anidado.
--
-- Nota sobre los nombres: las columnas van en camelCase ENTRECOMILLADO
-- porque así las escribe Prisma; sin comillas Postgres las bajaría a
-- minúsculas y el cliente dejaría de encontrarlas.
--
-- 🔴 NOTA SOBRE LOS TIPOS DE FECHA — no es un descuido que convivan dos:
--   · TIMESTAMP(3)   → fechas de CALENDARIO y sellos internos. El
--     nacimiento de un paciente es un día, no un instante.
--   · TIMESTAMPTZ(3) → las citas y sus marcas de tiempo. Una cita SÍ es un
--     instante, y la escuela puede estar en cualquier zona del país.
--     Guardar la hora de una cita sin zona es cómo se acaba con una cita
--     que se mueve sola una hora en octubre.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Enums ───────────────────────────────────────────────────────────

-- En qué punto del embudo está el paciente. No se borra nunca: cambia de
-- estado. Sus citas y sus casos ocurrieron.
DO $edu$
BEGIN
  CREATE TYPE "EduPatientStatus" AS ENUM ('NEW', 'ACTIVE', 'DISCHARGED', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- UNSPECIFIED existe a propósito: obligar a elegir en recepción produce
-- datos inventados.
DO $edu$
BEGIN
  CREATE TYPE "EduSex" AS ENUM ('FEMALE', 'MALE', 'OTHER', 'UNSPECIFIED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- El ciclo de vida del CASO. Los tres últimos son finales y escriben
-- "closedAt".
DO $edu$
BEGIN
  CREATE TYPE "EduCaseStatus" AS ENUM (
    'SCREENING', 'ASSIGNED', 'IN_TREATMENT', 'ON_HOLD',
    'COMPLETED', 'TRANSFERRED', 'ABANDONED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  CREATE TYPE "EduAppointmentType" AS ENUM ('TAMIZAJE', 'TRATAMIENTO', 'CONTROL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- "Llegó", "se sentó" y "se le está trabajando" son tres momentos
-- distintos y la escuela los mide: el tiempo entre el primero y el segundo
-- es la sala de espera.
DO $edu$
BEGIN
  CREATE TYPE "EduAppointmentStatus" AS ENUM (
    'SCHEDULED', 'CHECKED_IN', 'IN_CHAIR', 'IN_PROGRESS',
    'COMPLETED', 'CANCELLED', 'NO_SHOW'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 2. Tablas ──────────────────────────────────────────────────────────

-- El paciente de la clínica de la escuela. No es el "patients" del dental
-- y no comparte con él ni una columna.
--
-- 🔴 EL ORIGEN. "referredByStudentId" dice CUÁL alumno trajo al paciente.
-- En la Ola 5 ese dato decide el precio, así que se captura desde ya:
-- reconstruirlo después, a mano y de memoria, no se puede. Se guarda
-- además QUIÉN lo marcó y CUÁNDO, porque es un dato con consecuencia
-- económica — si un día no cuadra una cuenta, hay que poder preguntarlo.
CREATE TABLE IF NOT EXISTS "edu_patients" (
  "id"            TEXT               NOT NULL,
  "institutionId" TEXT               NOT NULL,
  -- Único DENTRO del instituto y normalizado en MAYÚSCULAS por la
  -- aplicación (Postgres distingue: "p-01" y "P-01" serían dos pacientes
  -- con el mismo folio impreso en el expediente de papel).
  "folio"         VARCHAR(30)        NOT NULL,
  "firstName"     VARCHAR(80)        NOT NULL,
  "lastName"      VARCHAR(80)        NOT NULL,
  -- Se guarda SOLO con dígitos (y el "+" si venía). Sin normalizar, buscar
  -- "5544332211" no encuentra al que se capturó como "55 4433 2211".
  "phone"         VARCHAR(30),
  "email"         VARCHAR(160),
  -- Fecha de CALENDARIO: medianoche UTC, y se pinta en UTC.
  "birthDate"     TIMESTAMP(3),
  "sex"           "EduSex"           NOT NULL DEFAULT 'UNSPECIFIED',
  "notes"         VARCHAR(1000),
  "status"        "EduPatientStatus" NOT NULL DEFAULT 'NEW',
  "referredByStudentId" TEXT,
  "originSetById"       TEXT,
  "originSetAt"         TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- @updatedAt lo escribe Prisma en cada UPDATE. El DEFAULT es para que un
  -- INSERT hecho a mano desde el SQL Editor no falle por una columna NOT
  -- NULL sin valor.
  "updatedAt"     TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_patients_pkey" PRIMARY KEY ("id")
);

-- La unidad dental.
--
-- 🔴 CUÁNTAS HAY LO DECIDE CADA INSTITUTO. No hay un número en el código,
-- ni un seed con doce sillones, ni un "por defecto son 8": una escuela
-- tiene 40 y otra tiene 6. Se dan de alta desde /instituto/sillones.
CREATE TABLE IF NOT EXISTS "edu_chairs" (
  "id"            TEXT        NOT NULL,
  "institutionId" TEXT        NOT NULL,
  "name"          VARCHAR(60) NOT NULL,
  -- El número que está pintado en la pared. Único dentro del instituto.
  "number"        INTEGER     NOT NULL,
  "isActive"      BOOLEAN     NOT NULL DEFAULT true,
  -- Orden de las columnas de la agenda. Se puede cambiar sin renumerar la
  -- clínica entera.
  "orderIndex"    INTEGER     NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_chairs_pkey" PRIMARY KEY ("id")
);

-- Horario de un sillón.
--
-- 🔴 SIN FILAS = SIEMPRE ABIERTO. Un sillón recién dado de alta acepta
-- cualquier hora; en cuanto tiene UNA fila, solo acepta lo que cae dentro
-- de sus franjas. La asimetría es a propósito: obligar a capturar un
-- horario antes de poder agendar convertiría el alta de un sillón en un
-- trámite, y una escuela que todavía no lo capturó no puede quedarse sin
-- agenda.
--
-- Las horas van como MINUTOS DESDE LA MEDIANOCHE (480 = 08:00) y en la
-- hora de PARED del instituto, no como instantes: "el sillón 3 abre a las
-- 8" no cambia porque cambie el horario de verano.
CREATE TABLE IF NOT EXISTS "edu_chair_schedules" (
  "id"            TEXT    NOT NULL,
  "institutionId" TEXT    NOT NULL,
  "chairId"       TEXT    NOT NULL,
  -- 0 = domingo … 6 = sábado (igual que Date#getUTCDay, para no tener que
  -- traducir en ningún lado).
  "weekday"       INTEGER NOT NULL,
  "startMinute"   INTEGER NOT NULL,
  "endMinute"     INTEGER NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_chair_schedules_pkey" PRIMARY KEY ("id")
);

-- EL CASO: este paciente, con este alumno, en esta especialidad.
--
-- Un paciente puede tener VARIOS a la vez, uno por especialidad. La señora
-- que necesita endodoncia y ortodoncia es una persona con dos casos, dos
-- alumnos y dos docentes; meterlo todo en un solo "expediente del
-- paciente" es exactamente lo que hace que en una escuela nadie sepa de
-- quién era la responsabilidad.
--
-- ⚠️ "supervisorUserId" es NULLABLE a propósito y no es un descuido: la
-- visibilidad del docente NO se calcula con esta columna sino con la
-- asignación VIGENTE alumno↔docente de la Ola 1A (si se calculara aquí, un
-- docente que ya rotó seguiría viendo el caso para siempre). Esta columna
-- guarda quién era el responsable EN EL MOMENTO de abrirlo, para poder
-- contestarlo dentro de un año.
CREATE TABLE IF NOT EXISTS "edu_cases" (
  "id"               TEXT            NOT NULL,
  "institutionId"    TEXT            NOT NULL,
  "patientId"        TEXT            NOT NULL,
  "studentId"        TEXT            NOT NULL,
  "programId"        TEXT            NOT NULL,
  "supervisorUserId" TEXT,
  "status"           "EduCaseStatus" NOT NULL DEFAULT 'SCREENING',
  "openedAt"         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Se escribe al llegar a un estado final. Se DERIVA del status: no se
  -- captura, así no existe un caso "terminado" sin fecha de cierre ni una
  -- fecha de cierre en un caso que sigue vivo.
  "closedAt"         TIMESTAMP(3),
  "notes"            VARCHAR(1000),
  -- La cita de tamizaje que lo abrió. SET NULL, no CASCADE: borrar la cita
  -- no puede llevarse el caso.
  "screeningAppointmentId" TEXT,
  "createdAt"        TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_cases_pkey" PRIMARY KEY ("id")
);

-- La cita en el sillón.
--
-- 🔴 "startsAt"/"endsAt" son TIMESTAMPTZ: INSTANTES, no horas de pared. La
-- agenda se captura en la hora del instituto y se convierte en UN solo
-- lugar (src/lib/edu/agenda-core.ts) usando "edu_institutions"."timezone".
--
-- "caseId" es NULLABLE porque la cita de TAMIZAJE ocurre ANTES de que
-- exista el caso: primero se agenda la valoración, y es esa valoración la
-- que abre el caso.
CREATE TABLE IF NOT EXISTS "edu_appointments" (
  "id"               TEXT                   NOT NULL,
  "institutionId"    TEXT                   NOT NULL,
  "patientId"        TEXT                   NOT NULL,
  -- El alumno que atiende. Nunca es opcional: una cita sin dueño no la ve
  -- nadie (la visibilidad del ALUMNO y la del DOCENTE cuelgan de aquí).
  "studentId"        TEXT                   NOT NULL,
  "chairId"          TEXT                   NOT NULL,
  "supervisorUserId" TEXT,
  "caseId"           TEXT,
  "startsAt"         TIMESTAMPTZ(3)         NOT NULL,
  "endsAt"           TIMESTAMPTZ(3)         NOT NULL,
  "type"             "EduAppointmentType"   NOT NULL DEFAULT 'TRATAMIENTO',
  "status"           "EduAppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
  -- Los tres momentos que la escuela mide: llegó, se sentó, terminó.
  "checkedInAt"      TIMESTAMPTZ(3),
  "startedAt"        TIMESTAMPTZ(3),
  "completedAt"      TIMESTAMPTZ(3),
  "notes"            VARCHAR(1000),
  "createdAt"        TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_appointments_pkey" PRIMARY KEY ("id")
);


-- ── 3. Índices ─────────────────────────────────────────────────────────
-- Los nombres son los que genera (o los que le dice el `map:` de) Prisma:
-- si algún día se corre `prisma migrate diff` contra esta base, los
-- reconoce y no propone recrearlos.

-- Pacientes: el folio no se repite dentro del instituto.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_patients_institutionId_folio_key"
  ON "edu_patients" ("institutionId", "folio");

CREATE INDEX IF NOT EXISTS "edu_patients_institutionId_status_idx"
  ON "edu_patients" ("institutionId", "status");

CREATE INDEX IF NOT EXISTS "edu_patients_institutionId_lastName_idx"
  ON "edu_patients" ("institutionId", "lastName");

-- "¿A cuántos trajo este alumno?" — la consulta que en la Ola 5 se cobra.
CREATE INDEX IF NOT EXISTS "edu_patients_referrer_idx"
  ON "edu_patients" ("institutionId", "referredByStudentId");

-- Sillones: el número de la pared no se repite.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_chairs_institutionId_number_key"
  ON "edu_chairs" ("institutionId", "number");

CREATE INDEX IF NOT EXISTS "edu_chairs_orden_idx"
  ON "edu_chairs" ("institutionId", "isActive", "orderIndex");

CREATE INDEX IF NOT EXISTS "edu_chair_schedules_chair_idx"
  ON "edu_chair_schedules" ("institutionId", "chairId", "weekday");

-- Casos: por estado (el tablero), por alumno (su carga), por paciente (su
-- ficha) y por especialidad (el reporte de la Ola 4).
CREATE INDEX IF NOT EXISTS "edu_cases_status_idx"
  ON "edu_cases" ("institutionId", "status");

CREATE INDEX IF NOT EXISTS "edu_cases_student_idx"
  ON "edu_cases" ("institutionId", "studentId", "status");

CREATE INDEX IF NOT EXISTS "edu_cases_patient_idx"
  ON "edu_cases" ("institutionId", "patientId");

CREATE INDEX IF NOT EXISTS "edu_cases_program_idx"
  ON "edu_cases" ("institutionId", "programId", "status");

-- Citas. Los nombres van cortos y EXPLÍCITOS (el `map:` del schema):
--   · por día    → la agenda de cada mañana
--   · por sillón → la columna de la agenda y el CHOQUE de horarios
--   · por alumno → /mi-dia y el choque del alumno
--   · por paciente → su ficha
CREATE INDEX IF NOT EXISTS "edu_appointments_dia_idx"
  ON "edu_appointments" ("institutionId", "startsAt");

CREATE INDEX IF NOT EXISTS "edu_appointments_chair_idx"
  ON "edu_appointments" ("institutionId", "chairId", "startsAt");

CREATE INDEX IF NOT EXISTS "edu_appointments_student_idx"
  ON "edu_appointments" ("institutionId", "studentId", "startsAt");

CREATE INDEX IF NOT EXISTS "edu_appointments_patient_idx"
  ON "edu_appointments" ("institutionId", "patientId", "startsAt");

CREATE INDEX IF NOT EXISTS "edu_appointments_case_idx"
  ON "edu_appointments" ("institutionId", "caseId");


-- ── 4. Llaves foráneas ─────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- envuelta en su bloque.
--
-- ⚠️ CASCADE vs SET NULL, y por qué no son todas iguales:
--   · CASCADE  → lo que pertenece al instituto. El producto NO borra nada
--     de esto (los pacientes cambian de estado, los sillones se
--     desactivan, los casos se cierran); el CASCADE está para que borrar
--     un instituto entero —operación de administración, no del panel— no
--     se atore en una llave.
--   · SET NULL → las referencias "hacia los lados": el docente
--     responsable, el alumno que trajo al paciente, la cita de tamizaje y
--     el caso de una cita. Perder la referencia es aceptable; perder la
--     fila entera, no. Y entre "edu_cases" y "edu_appointments" hay dos
--     llaves cruzadas: con CASCADE en las dos, Postgres tendría un ciclo
--     de borrado.

DO $edu$
BEGIN
  ALTER TABLE "edu_patients"
    ADD CONSTRAINT "edu_patients_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_patients"
    ADD CONSTRAINT "edu_patients_referredByStudentId_fkey"
    FOREIGN KEY ("referredByStudentId") REFERENCES "edu_students" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_patients"
    ADD CONSTRAINT "edu_patients_originSetById_fkey"
    FOREIGN KEY ("originSetById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_chairs"
    ADD CONSTRAINT "edu_chairs_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_chair_schedules"
    ADD CONSTRAINT "edu_chair_schedules_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_chair_schedules"
    ADD CONSTRAINT "edu_chair_schedules_chairId_fkey"
    FOREIGN KEY ("chairId") REFERENCES "edu_chairs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_cases"
    ADD CONSTRAINT "edu_cases_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_cases"
    ADD CONSTRAINT "edu_cases_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_cases"
    ADD CONSTRAINT "edu_cases_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "edu_students" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_cases"
    ADD CONSTRAINT "edu_cases_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "edu_programs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_cases"
    ADD CONSTRAINT "edu_cases_supervisorUserId_fkey"
    FOREIGN KEY ("supervisorUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_cases"
    ADD CONSTRAINT "edu_cases_screeningAppointmentId_fkey"
    FOREIGN KEY ("screeningAppointmentId") REFERENCES "edu_appointments" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_appointments"
    ADD CONSTRAINT "edu_appointments_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_appointments"
    ADD CONSTRAINT "edu_appointments_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_appointments"
    ADD CONSTRAINT "edu_appointments_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "edu_students" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_appointments"
    ADD CONSTRAINT "edu_appointments_chairId_fkey"
    FOREIGN KEY ("chairId") REFERENCES "edu_chairs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_appointments"
    ADD CONSTRAINT "edu_appointments_supervisorUserId_fkey"
    FOREIGN KEY ("supervisorUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_appointments"
    ADD CONSTRAINT "edu_appointments_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "edu_cases" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 5. Documentación en la propia base ─────────────────────────────────
-- COMMENT ON reemplaza el comentario anterior: es idempotente por sí solo.
COMMENT ON COLUMN "edu_patients"."referredByStudentId" IS
  'CUÁL alumno trajo a este paciente. NULL = llegó solo a la clínica. En la Ola 5 decide el precio, por eso se captura desde la Ola 2 junto con quién lo marcó (originSetById) y cuándo (originSetAt). Marcarlo exige el permiso pacientes.origen.';
COMMENT ON COLUMN "edu_patients"."phone" IS
  'Normalizado por la aplicación: solo dígitos (y el + inicial si venía). Si se guarda con espacios, buscar el número sin ellos no lo encuentra.';
COMMENT ON COLUMN "edu_patients"."status" IS
  'Un paciente no se borra: cambia de estado. Sus citas y sus casos ocurrieron.';
COMMENT ON COLUMN "edu_chairs"."number" IS
  'El número pintado en la pared. Cuántos sillones tiene la clínica lo decide cada instituto: no hay ninguno por defecto.';
COMMENT ON TABLE "edu_chair_schedules" IS
  'SIN FILAS = SIEMPRE ABIERTO. Un sillón sin horario acepta cualquier hora; con al menos una franja, solo acepta lo que cabe ENTERO dentro de una. Las horas son minutos desde la medianoche, en hora de pared del instituto.';
COMMENT ON COLUMN "edu_cases"."supervisorUserId" IS
  'Quién era el docente responsable al abrir el caso. NO es lo que decide quién VE el caso: eso lo decide la asignación vigente alumno-docente (edu_supervisor_assignments), porque el docente rota.';
COMMENT ON COLUMN "edu_cases"."closedAt" IS
  'Se deriva del status (COMPLETED, TRANSFERRED, ABANDONED). No se captura: así no existe un caso terminado sin fecha ni una fecha en un caso vivo.';
COMMENT ON COLUMN "edu_appointments"."startsAt" IS
  'INSTANTE (timestamptz), no hora de pared. La captura se hace en la hora del instituto (edu_institutions.timezone) y se convierte en un solo lugar de la aplicación.';
COMMENT ON COLUMN "edu_appointments"."caseId" IS
  'NULL en las citas de TAMIZAJE: la valoración ocurre antes de que exista el caso, y es ella la que lo abre.';


-- ═══════════════════════════════════════════════════════════════════════
-- 6. BACKFILL DEL OVERRIDE DE PERMISOS  ← LÉELO ANTES DE CERRAR EL ARCHIVO
--
-- 🔴 "permissionsOverride" REEMPLAZA al default del rol, no se suma. Es
-- decir: a quien YA tenga un override guardado, las NUEVE keys de esta ola
-- (pacientes.view/manage/origen, agenda.view/manage, sillones.view/manage,
-- casos.view/assign) NO le llegan solas. Entrará al panel, no verá
-- "Agenda" ni "Pacientes" en el menú, y desde fuera parecerá que la ola no
-- se aplicó.
--
-- Quien tenga el override VACÍO (el caso normal) no necesita nada: cae al
-- default del rol y ya trae lo que le toca.
--
-- Para ver a quién le falta:
--
-- SELECT "email", "role", "permissionsOverride"
-- FROM "edu_users"
-- WHERE cardinality("permissionsOverride") > 0;
--
-- Y para dárselas, DESCOMENTA el bloque que corresponda. Están separados
-- por rol a propósito: el reparto de esta ola NO es el mismo para los
-- cuatro, y copiar el de dirección a caja le abriría el expediente
-- clínico.
--
-- -- DIRECCION: las nueve.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'pacientes.view', 'pacientes.manage', 'pacientes.origen',
--           'agenda.view', 'agenda.manage',
--           'sillones.view', 'sillones.manage',
--           'casos.view', 'casos.assign'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'DIRECCION'
--   AND cardinality("permissionsOverride") > 0;
--
-- -- CAJA: recibe, agenda y cobra. Pacientes (incluido el ORIGEN, que
-- -- decide el precio), agenda y ver los sillones. NINGÚN caso: caja no
-- -- abre expediente clínico.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'pacientes.view', 'pacientes.manage', 'pacientes.origen',
--           'agenda.view', 'agenda.manage', 'sillones.view'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'CAJA'
--   AND cardinality("permissionsOverride") > 0;
--
-- -- DOCENTE: mira todo lo suyo y REPARTE. Los .view + casos.assign.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'pacientes.view', 'agenda.view', 'sillones.view',
--           'casos.view', 'casos.assign'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'DOCENTE'
--   AND cardinality("permissionsOverride") > 0;
--
-- -- ALUMNO: tres permisos de LECTURA. Lo que ve va recortado a lo suyo
-- -- por el ALCANCE (src/lib/edu/visibility.ts), no por el permiso.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" ||
--         ARRAY['pacientes.view', 'agenda.view', 'casos.view']::TEXT[]
--       )
--     )
-- WHERE "role" = 'ALUMNO'
--   AND cardinality("permissionsOverride") > 0;
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 7. EJEMPLO: LOS PRIMEROS SILLONES
--
-- Todo lo de aquí abajo está COMENTADO a propósito: es el ejemplo, no
-- parte de la migración. Descoméntalo, cámbiale los datos y córrelo aparte.
--
-- 🔴 CUÁNTOS SILLONES HAY LO DECIDE TU ESCUELA. Este bloque crea SEIS
-- porque hay que poner un número en un ejemplo, no porque el producto
-- opine. Cámbialo por los que existan de verdad — el número tiene que ser
-- el que está pintado en la pared, porque es el que la clínica usa para
-- hablar. También se dan de alta desde /instituto/sillones sin tocar SQL.
--
-- Sustituye 'ieo' por el slug del instituto que creaste con edu-ola-0.sql.
--
-- ── Sillones ───────────────────────────────────────────────────────────
-- INSERT INTO "edu_chairs"
--   ("id", "institutionId", "name", "number", "isActive", "orderIndex")
-- SELECT
--   gen_random_uuid()::text,   -- Prisma escribe cuids; la columna es TEXT,
--                              -- así que cualquier id único sirve
--   i."id",
--   'Sillón ' || n,
--   n,
--   true,
--   n
-- FROM "edu_institutions" i
-- CROSS JOIN generate_series(1, 6) AS n
-- WHERE i."slug" = 'ieo'
-- ON CONFLICT DO NOTHING;
--
-- ── Horario: lunes a viernes de 08:00 a 14:00 ──────────────────────────
-- Recuerda: SIN filas el sillón acepta CUALQUIER hora. Estas filas lo
-- restringen; borrarlas lo vuelve a abrir del todo.
--
-- INSERT INTO "edu_chair_schedules"
--   ("id", "institutionId", "chairId", "weekday", "startMinute", "endMinute")
-- SELECT
--   gen_random_uuid()::text,
--   c."institutionId",
--   c."id",
--   d,                          -- 1 = lunes … 5 = viernes
--   8 * 60,                     -- 480 = 08:00
--   14 * 60                     -- 840 = 14:00
-- FROM "edu_chairs" c
-- JOIN "edu_institutions" i ON i."id" = c."institutionId"
-- CROSS JOIN generate_series(1, 5) AS d
-- WHERE i."slug" = 'ieo';
--
-- ── Comprobación ───────────────────────────────────────────────────────
-- SELECT i."name" AS instituto, c."number", c."name",
--        count(s."id") AS franjas
-- FROM "edu_chairs" c
-- JOIN "edu_institutions" i ON i."id" = c."institutionId"
-- LEFT JOIN "edu_chair_schedules" s ON s."chairId" = c."id"
-- GROUP BY i."name", c."number", c."name"
-- ORDER BY c."number";
--
-- Si eso devuelve las filas y el panel sigue enseñando "Todavía no hay
-- sillones", el sospechoso número uno es el instituto: comprueba que el
-- "institutionId" de las filas nuevas sea el MISMO con el que entra tu
-- usuario (SELECT "institutionId" FROM "edu_users" WHERE "email" = '…').
-- ═══════════════════════════════════════════════════════════════════════
