-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola 4 · EL GATE DE AUTORIZACIÓN.
--
-- Va DESPUÉS de sql/edu-ola-0.sql, sql/edu-ola-1.sql, sql/edu-ola-2.sql y
-- sql/edu-ola-3.sql (necesita "edu_institutions", "edu_users", "edu_cases",
-- "edu_records" y "edu_appointments"). Es INDEPENDIENTE de edu-ola-5.sql:
-- se pueden aplicar en cualquier orden entre sí.
-- Producto SEPARADO del dental, que está VIVO en producción: este archivo
-- NO toca ni una tabla, ni una columna, ni una fila del dental, de
-- barbería ni de inmuebles.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   2 enums   · "EduApprovalStage", "EduApprovalStatus"
--   1 tabla   · edu_case_approvals (20 columnas)
--   4 índices · 3 de consulta + 1 ÚNICO PARCIAL
--   4 llaves foráneas
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
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 LA COLUMNA QUE HACE QUE ESTO SIRVA: "contentHash".
--
-- Sin ella: el alumno manda A, el docente firma A, el alumno edita a B, y B
-- queda "autorizado por el docente" — la firma pasa a ser una etiqueta
-- pegada a un texto editable, que es exactamente lo contrario de una firma.
--
-- Con ella: al firmar se guarda el sha256 de lo que el docente tenía
-- delante (los campos clínicos de la nota, o la hora y el sillón de la
-- cita). Cuando ese contenido cambia, la aplicación pasa la fila a EXPIRED
-- sola y hay que volver a pedirla. La RECETA de qué entra en ese resumen
-- vive en src/lib/edu/autorizaciones-core.ts y lleva versión dentro:
-- cambiarla vence TODAS las autorizaciones vigentes de golpe, así que es
-- una decisión de producto y no un refactor.
--
-- ⚠️ Postgres NO puede comprobar el hash: no sabe leer la nota apuntada por
-- ("targetType","targetId"). Esta migración crea la columna; quien la hace
-- valer es la aplicación. No hay trigger, y es a propósito — un trigger que
-- reimplemente la receta sería una segunda copia de la regla más importante
-- del vertical, y el día que discrepen no habría forma de saber cuál manda.
--
-- 🔴 NOTA SOBRE LOS TIPOS DE FECHA — no es un descuido que convivan dos:
--   · TIMESTAMP(3)   → sellos internos ("createdAt"/"updatedAt").
--   · TIMESTAMPTZ(3) → cuándo se pidió y cuándo se decidió. Son INSTANTES:
--     la bandeja se ordena por antigüedad y la escuela puede estar en
--     cualquier zona del país. Una petición guardada sin zona se mueve sola
--     una hora en octubre y la bandeja se desordena.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Enums ───────────────────────────────────────────────────────────

-- QUÉ se está autorizando. Cuatro momentos y no uno: una escuela no firma
-- "el caso", firma cada punto en que el tratamiento AVANZA.
--
-- PLAN y DISCHARGE son PUERTAS de verdad (sin ellas el caso no pasa a "en
-- tratamiento" ni a "terminado"); PROCEDURE y SESSION dejan constancia de
-- que el docente lo vio antes de que ocurriera.
DO $edu$
BEGIN
  CREATE TYPE "EduApprovalStage" AS ENUM ('PLAN', 'PROCEDURE', 'SESSION', 'DISCHARGE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- En qué va una autorización.
--
-- 🔴 EXPIRED no lo pone una persona: lo pone el sistema cuando el contenido
-- firmado CAMBIA. CHANGES_REQUESTED es también el estado en el que queda
-- una petición anterior cuando el alumno REENVÍA — el reenvío es, en
-- efecto, un cambio, y no hace falta un sexto valor para decir lo mismo.
DO $edu$
BEGIN
  CREATE TYPE "EduApprovalStatus" AS ENUM (
    'PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 2. La tabla ────────────────────────────────────────────────────────

-- LA AUTORIZACIÓN de un acto del caso.
--
-- ⚠️ "targetType" + "targetId" SIN llave foránea, y es a propósito: apuntan
-- a filas de tablas DISTINTAS ("edu_records" y "edu_appointments") y una FK
-- obligaría a una columna —y en la práctica a una tabla— por tipo. Mismo
-- criterio que "AuditLog"."actorAdminId" en el dental.
--
-- Lo que impide que ahí acabe cualquier cosa NO es la base: es la lista
-- CERRADA de src/lib/edu/autorizaciones-core.ts, que además comprueba que
-- la fila apuntada sea del MISMO caso. Consecuencia que hay que saber:
-- borrar una nota NO borra sus autorizaciones (no hay cascada que las
-- alcance). No es un huérfano olvidado — es la constancia de que ese acto
-- se pidió, y la aplicación lo pinta como "ya no existe" en vez de
-- fingir que nunca pasó.
CREATE TABLE IF NOT EXISTS "edu_case_approvals" (
  "id"              TEXT                NOT NULL,
  "institutionId"   TEXT                NOT NULL,
  "caseId"          TEXT                NOT NULL,
  "stage"           "EduApprovalStage"  NOT NULL,
  -- Discriminador, no texto libre: el nombre del modelo apuntado.
  "targetType"      VARCHAR(40)         NOT NULL,
  "targetId"        TEXT                NOT NULL,
  -- sha256 en hexadecimal: 64 caracteres exactos.
  "contentHash"     VARCHAR(64)         NOT NULL,
  "status"          "EduApprovalStatus" NOT NULL DEFAULT 'PENDING',

  -- Quién pidió (el alumno) y cuándo. INSTANTE: la bandeja se ordena por
  -- antigüedad.
  "requestedById"   TEXT                NOT NULL,
  "requestedAt"     TIMESTAMPTZ(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Quién decidió (el docente), cuándo y qué escribió. Nulos mientras esté
  -- PENDING; se DERIVAN de la decisión, no se capturan.
  --
  -- ⚠️ "decidedAt" puede tener valor con "decidedById" NULO, y no es una
  -- inconsistencia: es la fila que sustituyó un REENVÍO del alumno. Nadie
  -- la decidió, y atribuírsela a un docente sería escribir en su nombre una
  -- decisión que no tomó. La nota lo dice con todas sus letras.
  "decidedById"     TEXT,
  "decidedAt"       TIMESTAMPTZ(3),
  "decisionNote"    VARCHAR(1000),

  -- Rastro de la firma. "signatureUrl" es el PATH de un trazo en Storage
  -- (bucket privado, como los estudios de la Ola 3): nunca el binario ni
  -- una URL firmada, que caduca y quedaría muerta en la columna.
  "signatureUrl"    TEXT,
  "signedIp"        VARCHAR(60),
  "signedUserAgent" VARCHAR(300),

  -- 🔴 LA RUTA DE URGENCIA. El alumno puede marcar un acto como urgente y
  -- proceder SIN firma previa: no se le impide. Queda la fila con su
  -- motivo, sale destacada arriba de la bandeja y en la ficha del caso.
  -- Un gate que impide atender a un paciente con dolor es un gate que la
  -- escuela desconecta el primer mes.
  "isEmergency"     BOOLEAN             NOT NULL DEFAULT false,
  "emergencyReason" VARCHAR(500),

  "createdAt"       TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_case_approvals_pkey" PRIMARY KEY ("id")
);


-- ── 3. Índices ─────────────────────────────────────────────────────────
-- Los nombres son los que le dice el `map:` de Prisma: si algún día se
-- corre `prisma migrate diff` contra esta base, los reconoce y no propone
-- recrearlos.

-- LA BANDEJA: lo que está esperando firma, por orden de llegada. Es la
-- consulta que corre cada vez que un docente abre el teléfono.
CREATE INDEX IF NOT EXISTS "edu_case_approvals_bandeja_idx"
  ON "edu_case_approvals" ("institutionId", "status", "requestedAt");

-- EL GATE: "¿tiene este caso una autorización de esta etapa?". Corre en
-- CADA avance de tratamiento, dentro de la transacción que mueve el caso.
CREATE INDEX IF NOT EXISTS "edu_case_approvals_caso_idx"
  ON "edu_case_approvals" ("institutionId", "caseId", "stage");

-- De una nota o una cita a sus autorizaciones: la dirección en la que se
-- pregunta al pintar la ficha y al comprobar si el contenido cambió.
--
-- ⚠️ Va SIN "institutionId" al frente, y es el único índice del vertical
-- que lo hace. No es un olvido: el par (tipo, id) ya es único en toda la
-- base —los ids son cuids— y meter el tenant delante haría que la consulta
-- por target tuviera que conocerlo. Las CONSULTAS sí filtran por
-- institutionId igual; esto es solo por dónde entra el índice.
CREATE INDEX IF NOT EXISTS "edu_case_approvals_target_idx"
  ON "edu_case_approvals" ("targetType", "targetId");

-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 EL ÍNDICE ÚNICO PARCIAL — LA LÍNEA QUE PRISMA NO SABE ESCRIBIR.
--
-- UNA sola autorización PENDING por fila apuntada. Sin él, un doble toque
-- en un teléfono con mala señal deja dos peticiones idénticas esperando, y
-- el docente ve la misma nota dos veces sin saber cuál de las dos le están
-- pidiendo. Con él, la segunda rebota con un P2002 que la aplicación
-- traduce a "eso ya está esperando firma".
--
-- Es PARCIAL (`WHERE "status" = 'PENDING'`) porque el histórico SÍ se
-- repite: cada reenvío deja la anterior en CHANGES_REQUESTED sobre la
-- MISMA fila apuntada, y ésas tienen que poder convivir — son el
-- historial, y no hay otro.
--
-- Va sobre ("targetType","targetId") y NO sobre la etapa: así la misma nota
-- no puede tener a la vez un PLAN y un PROCEDURE esperando firma, que es
-- exactamente el "¿cuál de los dos me están pidiendo?" que hunde una
-- bandeja. Consecuencia buscada: un caso no pide el ALTA mientras su PLAN
-- sigue pendiente sobre la misma nota.
--
-- ⚠️ Prisma NO puede expresar un índice parcial, así que esta línea vive
-- SOLO aquí. Si algún día se corre `prisma migrate diff` contra esta base,
-- va a proponer BORRARLA. No se borra.
--
-- ⚠️ Y por lo mismo: NUNCA escribir un `upsert` de Prisma sobre este par.
-- Prisma emite `ON CONFLICT ("targetType","targetId")` sin el predicado y
-- Postgres no lo infiere — reventaría con "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification". La aplicación cierra
-- la anterior con un UPDATE y luego inserta, en la misma transacción.
-- ═══════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS "edu_case_approvals_pendiente_uniq"
  ON "edu_case_approvals" ("targetType", "targetId")
  WHERE "status" = 'PENDING';


-- ── 4. Llaves foráneas ─────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- en su propio bloque que se traga el duplicado.
--
-- 🔴 "requestedById" va en CASCADE y NO en SET NULL porque es NOT NULL: es
-- el rastro de quién pidió. En este producto un usuario no se borra —se
-- desactiva (isActive)— así que ese CASCADE no se dispara nunca desde el
-- panel; está para que borrar el instituto entero no se atore en una
-- llave. "decidedById" sí es SET NULL: perder el nombre de quien firmó es
-- malo, perder la fila que dice que se firmó es peor.

DO $edu$
BEGIN
  ALTER TABLE "edu_case_approvals"
    ADD CONSTRAINT "edu_case_approvals_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_case_approvals"
    ADD CONSTRAINT "edu_case_approvals_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "edu_cases" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_case_approvals"
    ADD CONSTRAINT "edu_case_approvals_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "edu_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_case_approvals"
    ADD CONSTRAINT "edu_case_approvals_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 5. Documentación en la propia base ─────────────────────────────────
-- COMMENT ON reemplaza el comentario anterior: es idempotente por sí solo.
COMMENT ON TABLE "edu_case_approvals" IS
  'EL GATE. El alumno propone, el docente autoriza y el tratamiento no avanza en medio. Estas filas SON el historial: cada reenvío crea una nueva y deja la anterior en CHANGES_REQUESTED. No hay tabla de historial aparte, a propósito.';
COMMENT ON COLUMN "edu_case_approvals"."contentHash" IS
  'sha256 de lo que se firmó. Al aprobar se recalcula sobre lo que el docente tiene delante; si el contenido cambia después, la aplicación pasa la fila a EXPIRED sola. Sin esta columna, "autorizado" sería una etiqueta pegada a un texto editable. La receta vive en src/lib/edu/autorizaciones-core.ts y lleva versión dentro.';
COMMENT ON COLUMN "edu_case_approvals"."targetType" IS
  'Nombre del modelo apuntado ("EduRecord", "EduAppointment"). SIN llave foránea a propósito: apunta a filas de tablas distintas. La lista es CERRADA en la aplicación, no aquí.';
COMMENT ON COLUMN "edu_case_approvals"."isEmergency" IS
  'Ruta de URGENCIA, no permiso. El alumno procede sin firma previa y NO se le impide: queda esta fila con su motivo, destacada en la bandeja. Deja constancia en vez de bloquear.';
COMMENT ON COLUMN "edu_case_approvals"."decidedById" IS
  'NULO con "decidedAt" puesto = la sustituyó un reenvío del alumno. Nadie la decidió, y atribuírsela a un docente sería escribir en su nombre una decisión que no tomó.';
COMMENT ON COLUMN "edu_case_approvals"."signedIp" IS
  'De la petición HTTP, jamás del body: un dato que manda el firmante no es un rastro, es una casilla. No es prueba de identidad —eso es "decidedById"— sino de desde dónde se firmó.';
COMMENT ON INDEX "edu_case_approvals_pendiente_uniq" IS
  'Una sola PENDING por fila apuntada. Prisma NO sabe expresar un índice parcial: esta línea vive solo en sql/edu-ola-4.sql. Un `prisma migrate diff` va a proponer borrarla. No se borra.';


-- ═══════════════════════════════════════════════════════════════════════
-- 6. BACKFILL DEL OVERRIDE DE PERMISOS  ← LÉELO ANTES DE CERRAR EL ARCHIVO
--
-- 🔴 "permissionsOverride" REEMPLAZA al default del rol, no se suma. Es
-- decir: a quien YA tenga un override guardado, las TRES keys de esta ola
-- (autorizaciones.request/view/decide) NO le llegan solas. Entrará al
-- panel, no verá "Autorizaciones" en el menú, y desde fuera parecerá que la
-- ola no se aplicó. Peor: un docente así no podría firmar nada y sus
-- alumnos se quedarían trabados.
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
-- Y para dárselas, DESCOMENTA el bloque que corresponda.
--
-- ⚠️ SON TRES BLOQUES Y NO CUATRO: CAJA no recibe NI UNA. Cobrar no es
-- autorizar un acto clínico.
--
-- ⚠️ Y ojo a que los tres bloques son DISTINTOS. Copiarle al docente el de
-- la dirección le daría "autorizaciones.request", y entonces podría pedir y
-- firmar — que es exactamente la separación de funciones que esta ola
-- existe para sostener.
--
-- -- DIRECCION: las TRES. Lleva "request" —que el docente no tiene— para
-- -- poder desatorar un caso cuyo alumno se dio de baja a media generación.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'autorizaciones.request', 'autorizaciones.view', 'autorizaciones.decide'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'DIRECCION'
--   AND cardinality("permissionsOverride") > 0;
--
-- -- DOCENTE: ve y FIRMA. NO pide: quien autoriza no es quien propone.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'autorizaciones.view', 'autorizaciones.decide'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'DOCENTE'
--   AND cardinality("permissionsOverride") > 0;
--
-- -- ALUMNO: PIDE y ve lo suyo. NO firma: si pudiera, el gate sería un
-- -- formulario.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'autorizaciones.request', 'autorizaciones.view'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'ALUMNO'
--   AND cardinality("permissionsOverride") > 0;
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 7. COMPROBACIONES (todo comentado: es el manual, no la migración)
--
-- ── ¿Quedó bien aplicada? ──────────────────────────────────────────────
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_name = 'edu_case_approvals')                    AS columnas,   -- 20
--   (SELECT count(*) FROM pg_indexes
--     WHERE tablename = 'edu_case_approvals')                     AS indices,    -- 5 (4 + la PK)
--   (SELECT count(*) FROM information_schema.table_constraints
--     WHERE table_name = 'edu_case_approvals'
--       AND constraint_type = 'FOREIGN KEY')                      AS llaves;     -- 4
--
-- ── ¿Está el índice PARCIAL, que es el que Prisma no sabe escribir? ────
-- SELECT "indexdef" FROM pg_indexes
-- WHERE "indexname" = 'edu_case_approvals_pendiente_uniq';
-- Tiene que terminar en:  WHERE (status = 'PENDING'::"EduApprovalStatus")
-- Si sale vacío, el índice no está y dos peticiones idénticas van a poder
-- convivir esperando firma.
--
-- ── La bandeja de un docente, a mano ───────────────────────────────────
-- 🔴 Ojo: este SELECT NO aplica el alcance del producto. Está para
-- diagnosticar, no para copiarlo a la aplicación — la visibilidad la decide
-- src/lib/edu/visibility.ts y en un solo sitio.
--
-- SELECT a."stage", a."status", a."isEmergency", a."requestedAt",
--        p."folio", p."firstName" || ' ' || p."lastName" AS paciente,
--        s."matricula", pr."name" AS especialidad
-- FROM "edu_case_approvals" a
-- JOIN "edu_cases"    c  ON c."id" = a."caseId"
-- JOIN "edu_patients" p  ON p."id" = c."patientId"
-- JOIN "edu_students" s  ON s."id" = c."studentId"
-- JOIN "edu_programs" pr ON pr."id" = c."programId"
-- WHERE a."status" = 'PENDING'
-- ORDER BY a."isEmergency" DESC, a."requestedAt" ASC;
--
-- ── ¿Hay urgencias sin firmar de hace más de un día? ───────────────────
-- Es la consulta que la dirección del instituto querrá tener a mano: una
-- urgencia es un acto que YA ocurrió sin autorización previa.
--
-- SELECT a."id", a."requestedAt", a."emergencyReason",
--        u."email" AS pidio
-- FROM "edu_case_approvals" a
-- JOIN "edu_users" u ON u."id" = a."requestedById"
-- WHERE a."isEmergency" = true
--   AND a."status" = 'PENDING'
--   AND a."requestedAt" < now() - interval '1 day'
-- ORDER BY a."requestedAt" ASC;
-- ═══════════════════════════════════════════════════════════════════════
