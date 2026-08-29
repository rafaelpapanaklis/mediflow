-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola 1A · EL PADRÓN ACADÉMICO.
--
-- Va DESPUÉS de sql/edu-ola-0.sql (necesita "edu_institutions" y
-- "edu_users"). Producto SEPARADO del dental, que está VIVO en producción:
-- este archivo NO toca ni una tabla, ni una columna, ni una fila del
-- dental, de barbería ni de inmuebles.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   1 enum ("EduStudentStatus")
--   1 ALTER de DEFAULT (el timezone del instituto; NO reescribe filas)
--   4 tablas   · edu_programs, edu_cohorts, edu_students,
--                edu_supervisor_assignments
--   9 índices  · 4 únicos + 5 de consulta
--   9 llaves foráneas
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
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Enum ────────────────────────────────────────────────────────────
-- Estado académico del alumno. Darse de baja NO borra la ficha: el padrón
-- es un registro histórico y los actos clínicos de ese alumno siguieron
-- ocurriendo.
DO $edu$
BEGIN
  CREATE TYPE "EduStudentStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'GRADUATED', 'WITHDRAWN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 2. Corrección de la Ola 0: la zona horaria por defecto ─────────────
-- La Ola 0 dejó 'America/Tijuana' como DEFAULT. Esto es un producto
-- GENÉRICO para cualquier escuela del país, no para una de Tijuana.
--
-- 🔴 SOLO se mueve el DEFAULT de la columna: las filas que YA existen se
-- quedan exactamente con lo que tengan. Un UPDATE aquí le cambiaría la hora
-- a un instituto que sí es de Tijuana sin que nadie se lo haya pedido — y
-- si algún día hace falta, se hace a mano y por instituto.
ALTER TABLE "edu_institutions"
  ALTER COLUMN "timezone" SET DEFAULT 'America/Mexico_City';


-- ── 3. Tablas ──────────────────────────────────────────────────────────

-- La especialidad académica: Endodoncia, Ortodoncia, Periodoncia…
CREATE TABLE IF NOT EXISTS "edu_programs" (
  "id"                TEXT         NOT NULL,
  "institutionId"     TEXT         NOT NULL,
  "name"              VARCHAR(120) NOT NULL,
  -- Clave corta que la escuela ya usa en sus papeles. Única DENTRO del
  -- instituto: dos escuelas pueden llamarle "ENDO" a la suya sin pisarse.
  "code"              VARCHAR(20)  NOT NULL,
  "durationSemesters" INTEGER      NOT NULL DEFAULT 6,
  "isActive"          BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- @updatedAt lo escribe Prisma en cada UPDATE. El DEFAULT es para que un
  -- INSERT hecho a mano desde el SQL Editor no falle por una columna NOT
  -- NULL sin valor.
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_programs_pkey" PRIMARY KEY ("id")
);

-- La generación: "2026-A". Cuelga siempre de un programa.
CREATE TABLE IF NOT EXISTS "edu_cohorts" (
  "id"            TEXT         NOT NULL,
  "institutionId" TEXT         NOT NULL,
  "programId"     TEXT         NOT NULL,
  "name"          VARCHAR(60)  NOT NULL,
  -- Fechas de CALENDARIO: se guardan a medianoche y la aplicación las pinta
  -- en UTC. Formatearlas en la zona local del panel les restaría horas y el
  -- 31 de diciembre saldría "30 de diciembre".
  "startDate"     TIMESTAMP(3) NOT NULL,
  "endDate"       TIMESTAMP(3),
  "isActive"      BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_cohorts_pkey" PRIMARY KEY ("id")
);

-- La ficha académica del alumno. 1:1 con edu_users: el login lo da la ola
-- de Equipo, esta ola le cuelga matrícula, programa y generación.
--
-- ⚠️ "institutionId" tiene que coincidir con el del edu_users apuntado.
-- Postgres no puede exigirlo sin una llave compuesta; lo garantiza el
-- código, que crea la ficha con el institutionId de la SESIÓN y busca a la
-- persona dentro de ese mismo instituto.
CREATE TABLE IF NOT EXISTS "edu_students" (
  "id"            TEXT               NOT NULL,
  "institutionId" TEXT               NOT NULL,
  "userId"        TEXT               NOT NULL,
  "programId"     TEXT               NOT NULL,
  "cohortId"      TEXT               NOT NULL,
  "matricula"     VARCHAR(30)        NOT NULL,
  "semester"      INTEGER            NOT NULL DEFAULT 1,
  "status"        "EduStudentStatus" NOT NULL DEFAULT 'ACTIVE',
  "enrolledAt"    TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "graduatedAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_students_pkey" PRIMARY KEY ("id")
);

-- Alumno ↔ docente, CON VIGENCIA.
--
-- 🔴 El "endsAt" no es un lujo: el docente ROTA a media generación. Sin
-- vigencia no se puede contestar "¿quién supervisaba a este alumno el día
-- que pasó esto?", que es exactamente la pregunta que se hace cuando algo
-- sale mal en el sillón. Por eso las asignaciones NO se borran ni se
-- editan al rotar: se cierran (endsAt = ahora) y se abre una nueva.
--
-- Vigente en el instante T ⇔ startsAt <= T AND (endsAt IS NULL OR endsAt > T).
CREATE TABLE IF NOT EXISTS "edu_supervisor_assignments" (
  "id"               TEXT         NOT NULL,
  "institutionId"    TEXT         NOT NULL,
  "studentId"        TEXT         NOT NULL,
  -- edu_users con rol DOCENTE. Lo comprueba el endpoint que asigna: una
  -- llave foránea no puede exigir un rol.
  "supervisorUserId" TEXT         NOT NULL,
  "isPrimary"        BOOLEAN      NOT NULL DEFAULT true,
  "startsAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NULL = vigente. Cerrar es escribir aquí, nunca borrar la fila.
  "endsAt"           TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_supervisor_assignments_pkey" PRIMARY KEY ("id")
);


-- ── 4. Índices ─────────────────────────────────────────────────────────
-- Los nombres son los que genera (o los que le dice el `map:` de) Prisma:
-- si algún día se corre `prisma migrate diff` contra esta base, los
-- reconoce y no propone recrearlos.

-- Programas: la clave no se repite dentro del instituto.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_programs_institutionId_code_key"
  ON "edu_programs" ("institutionId", "code");

CREATE INDEX IF NOT EXISTS "edu_programs_institutionId_isActive_idx"
  ON "edu_programs" ("institutionId", "isActive");

-- Generaciones: "2026-A" es única DENTRO de su programa (la de Endodoncia
-- y la de Ortodoncia son dos generaciones distintas).
CREATE UNIQUE INDEX IF NOT EXISTS "edu_cohorts_institutionId_programId_name_key"
  ON "edu_cohorts" ("institutionId", "programId", "name");

CREATE INDEX IF NOT EXISTS "edu_cohorts_institutionId_isActive_idx"
  ON "edu_cohorts" ("institutionId", "isActive");

-- Una persona, una ficha: el 1:1 con edu_users.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_students_userId_key"
  ON "edu_students" ("userId");

-- La matrícula no se repite en el instituto (por eso la aplicación la
-- guarda normalizada en MAYÚSCULAS: Postgres distingue, y "a-01" y "A-01"
-- serían dos alumnos con la misma matrícula impresa en la credencial).
CREATE UNIQUE INDEX IF NOT EXISTS "edu_students_institutionId_matricula_key"
  ON "edu_students" ("institutionId", "matricula");

-- Los dos listados del padrón: "los activos" y "los activos de esta
-- generación".
CREATE INDEX IF NOT EXISTS "edu_students_institutionId_status_idx"
  ON "edu_students" ("institutionId", "status");

CREATE INDEX IF NOT EXISTS "edu_students_institutionId_cohortId_status_idx"
  ON "edu_students" ("institutionId", "cohortId", "status");

-- Supervisión. Los nombres van cortos y EXPLÍCITOS (el `map:` del schema):
-- el que Prisma generaría solo pasa de los 63 caracteres que admite un
-- identificador de Postgres.
--   · por docente → "¿a quién lleva Ana hoy?" (pantalla de Docentes)
--   · por alumno  → "¿quién supervisa a este alumno?" (padrón)
CREATE INDEX IF NOT EXISTS "edu_supervisor_assignments_supervisor_idx"
  ON "edu_supervisor_assignments" ("institutionId", "supervisorUserId", "endsAt");

CREATE INDEX IF NOT EXISTS "edu_supervisor_assignments_student_idx"
  ON "edu_supervisor_assignments" ("institutionId", "studentId", "endsAt");


-- ── 5. Llaves foráneas ─────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- envuelta en su bloque.
--
-- ⚠️ TODAS van en CASCADE, y es una decisión: el producto NO borra nada de
-- esto (los programas y las generaciones se DESACTIVAN, los alumnos cambian
-- de status). El CASCADE está para que borrar un instituto entero
-- —operación de administración, no del panel— no se atore en una llave.
-- Si una ola futura agrega un botón de "borrar programa", tiene que
-- comprobar ANTES que no le queden alumnos: el CASCADE se los llevaría.

DO $edu$
BEGIN
  ALTER TABLE "edu_programs"
    ADD CONSTRAINT "edu_programs_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_cohorts"
    ADD CONSTRAINT "edu_cohorts_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_cohorts"
    ADD CONSTRAINT "edu_cohorts_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "edu_programs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_students"
    ADD CONSTRAINT "edu_students_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_students"
    ADD CONSTRAINT "edu_students_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "edu_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_students"
    ADD CONSTRAINT "edu_students_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "edu_programs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_students"
    ADD CONSTRAINT "edu_students_cohortId_fkey"
    FOREIGN KEY ("cohortId") REFERENCES "edu_cohorts" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_supervisor_assignments"
    ADD CONSTRAINT "edu_supervisor_assignments_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_supervisor_assignments"
    ADD CONSTRAINT "edu_supervisor_assignments_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "edu_students" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_supervisor_assignments"
    ADD CONSTRAINT "edu_supervisor_assignments_supervisorUserId_fkey"
    FOREIGN KEY ("supervisorUserId") REFERENCES "edu_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 6. Documentación en la propia base ─────────────────────────────────
-- COMMENT ON reemplaza el comentario anterior: es idempotente por sí solo.
COMMENT ON COLUMN "edu_supervisor_assignments"."endsAt" IS
  'NULL = vigente. Cerrar una supervisión es escribir esta fecha, NUNCA borrar la fila: hay que poder saber quién supervisaba a un alumno en la fecha de un acto pasado.';
COMMENT ON COLUMN "edu_students"."status" IS
  'Dar de baja a un alumno es cambiar este estado, no borrar la ficha. El padrón es un registro histórico.';
COMMENT ON COLUMN "edu_students"."matricula" IS
  'Normalizada en MAYÚSCULAS y sin espacios por la aplicación. Única dentro del instituto.';
COMMENT ON COLUMN "edu_programs"."isActive" IS
  'Los programas no se borran: se desactivan. Desactivar solo lo saca de los desplegables de alta.';


-- ═══════════════════════════════════════════════════════════════════════
-- 7. BACKFILL DEL OVERRIDE DE PERMISOS  ← LÉELO ANTES DE CERRAR EL ARCHIVO
--
-- 🔴 "permissionsOverride" REEMPLAZA al default del rol, no se suma. Es
-- decir: a quien YA tenga un override guardado, las cuatro keys nuevas de
-- esta ola (padron.view, padron.manage, docentes.view, supervision.assign)
-- NO le llegan solas. Entrará al panel, no verá "Padrón" en el menú, y
-- desde fuera parecerá que la ola no se aplicó.
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
-- por rol a propósito: no es lo mismo lo que le toca a la dirección que lo
-- que le toca a un docente.
--
-- -- DIRECCION: las cuatro.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" ||
--         ARRAY['padron.view', 'padron.manage', 'docentes.view', 'supervision.assign']::TEXT[]
--       )
--     )
-- WHERE "role" = 'DIRECCION'
--   AND cardinality("permissionsOverride") > 0;
--
-- -- DOCENTE: ver el padrón (recortado a sus alumnos) y la lista de docentes.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY['padron.view', 'docentes.view']::TEXT[]
--       )
--     )
-- WHERE "role" = 'DOCENTE'
--   AND cardinality("permissionsOverride") > 0;
--
-- (ALUMNO y CAJA no reciben ninguna de las cuatro: un residente no lista a
-- su generación y caja cobra, no inscribe.)
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 8. EJEMPLO: EL PRIMER PROGRAMA Y LA PRIMERA GENERACIÓN
--
-- Todo lo de aquí abajo está COMENTADO a propósito: es el ejemplo, no parte
-- de la migración. Descoméntalo, cámbiale los datos y córrelo aparte.
--
-- El orden es obligatorio: primero el programa, luego su generación, y solo
-- entonces se puede inscribir a alguien desde el panel
-- (/instituto/padron → "Inscribir alumno").
--
-- Sustituye 'ieo' por el slug del instituto que creaste con edu-ola-0.sql.
--
-- ── Programa ───────────────────────────────────────────────────────────
-- INSERT INTO "edu_programs"
--   ("id", "institutionId", "name", "code", "durationSemesters", "isActive")
-- SELECT
--   gen_random_uuid()::text,   -- Prisma escribe cuids; la columna es TEXT,
--                              -- así que cualquier id único sirve
--   i."id",
--   'Endodoncia',
--   'ENDO',                    -- MAYÚSCULAS, sin espacios, única en el instituto
--   6,
--   true
-- FROM "edu_institutions" i
-- WHERE i."slug" = 'ieo';
--
-- ── Generación ─────────────────────────────────────────────────────────
-- INSERT INTO "edu_cohorts"
--   ("id", "institutionId", "programId", "name", "startDate", "endDate", "isActive")
-- SELECT
--   gen_random_uuid()::text,
--   p."institutionId",
--   p."id",
--   '2026-A',
--   '2026-01-15'::timestamp,   -- fecha de CALENDARIO: se guarda a medianoche
--   NULL,                      -- sin fecha de fin todavía
--   true
-- FROM "edu_programs" p
-- JOIN "edu_institutions" i ON i."id" = p."institutionId"
-- WHERE i."slug" = 'ieo' AND p."code" = 'ENDO';
--
-- ── Comprobación ───────────────────────────────────────────────────────
-- SELECT i."name" AS instituto, p."name" AS programa, p."code",
--        c."name" AS generacion, c."startDate"
-- FROM "edu_cohorts" c
-- JOIN "edu_programs" p     ON p."id" = c."programId"
-- JOIN "edu_institutions" i ON i."id" = c."institutionId";
--
-- Si eso devuelve la fila y el panel sigue enseñando "Todavía no hay
-- programas", el sospechoso número uno es el instituto: comprueba que el
-- "institutionId" de las filas nuevas sea el MISMO con el que entra tu
-- usuario (SELECT "institutionId" FROM "edu_users" WHERE "email" = '…').
-- ═══════════════════════════════════════════════════════════════════════
