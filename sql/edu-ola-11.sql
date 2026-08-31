-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola 11 · LAS SEDES (multi-campus).
--
-- Va DESPUÉS de sql/edu-ola-0.sql, sql/edu-ola-2.sql y sql/edu-ola-5.sql
-- (necesita "edu_institutions", "edu_users", "edu_chairs" y "edu_charges").
-- Producto SEPARADO del dental, que está VIVO en producción: este archivo
-- NO toca ni una tabla, ni una columna, ni una fila del dental, de
-- barbería ni de inmuebles.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados.
--
-- Contenido:
--   0 enums    · esta ola no agrega ninguno
--   2 tablas   · edu_campuses, edu_user_campus_access
--   2 columnas nuevas · edu_chairs."campusId" (NOT NULL, con backfill) y
--                edu_charges."campusId" (opcional, con backfill)
--   1 BACKFILL · una sede por defecto para cada instituto que ya existe,
--                con sus sillones y sus cobros colgados de ella
--   7 índices  · 3 únicos + 4 de consulta
--   6 llaves foráneas
--   1 índice ÚNICO que se SUELTA (el único DROP del archivo — es de una
--     restricción, no de datos: ver la sección 5)
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
-- 🔴 LO PRIMERO, PORQUE ES LO QUE SE ROMPE SI SE LEE MAL
--
-- 1. LA SEDE NO SUSTITUYE AL INSTITUTO. "institutionId" sigue siendo el
--    aislamiento DURO entre escuelas y no se toca. La sede es una división
--    DENTRO de una escuela: el campus norte y el campus sur de la misma
--    universidad. Las dos tablas nuevas llevan "institutionId" igual que
--    todas las olas anteriores, y ninguna consulta del producto usa
--    "campusId" como si fuera el tenant — dos escuelas pueden tener las
--    dos una sede "NORTE" y los ids son opacos.
--
-- 2. SIN FILAS EN edu_user_campus_access = ENTRA A TODAS LAS SEDES. Es al
--    revés de lo que sugiere una tabla de permisos, y es DELIBERADO: el
--    día que se aplica esta ola nadie tiene filas, así que nadie se queda
--    fuera. En cuanto una persona tiene UNA fila, solo entra a esas sedes.
--
--    El corolario que muerde al programar: una lista resuelta VACÍA no es
--    lo mismo que "sin filas". Quien tiene filas y todas apuntan a sedes
--    que ya no existen NO debe ver todas — debe ver ninguna. En Prisma eso
--    es `campusId: { in: [] }` y jamás un filtro ausente.
--
-- 3. EL BACKFILL DE LA SECCIÓN 3 NO ES OPCIONAL. Los sillones existentes
--    no tienen sede, y en cuanto la agenda filtre por sede se quedaría
--    VACÍA. Por eso este archivo crea una sede por defecto para cada
--    instituto que ya existe y le cuelga sus sillones y sus cobros ANTES
--    de poner el NOT NULL, todo en el mismo archivo.
--
-- 4. QUÉ CUELGA DE UNA SEDE, Y QUÉ NO:
--      · SÍ  → los SILLONES ("edu_chairs"."campusId") y, por lo tanto, las
--        CITAS: la sede de una cita se DERIVA de su sillón. No hay
--        "edu_appointments"."campusId" y no es un olvido — una columna
--        copiada se desincroniza el día que un sillón cambia de edificio,
--        y entonces la agenda de la sede nueva no tendría las citas que ya
--        estaban agendadas en ese sillón.
--      · SÍ  → el COBRO ("edu_charges"."campusId"), por otra razón: no es
--        una copia de nada, es un HECHO del cobro — dónde estaba el
--        mostrador. Se sella al emitir y no se puede desincronizar.
--      · NO  → lo ACADÉMICO. Alumnos, generaciones y especialidades NO
--        tienen sede: un alumno ROTA entre sedes y su padrón es UNO solo.
--        Si el alumno colgara de una sede, rotar sería darlo de baja y
--        volverlo a inscribir, y su historial se partiría en dos.
--
-- 5. UNA SEDE NO SE BORRA NUNCA, se DESACTIVA. Y aquí hay una razón extra
--    que no está en las otras tablas del vertical: las filas de acceso
--    cuelgan de la sede en CASCADE, y "sin filas" significa "entra a
--    TODAS". Borrar una sede le abriría el instituto entero a quien solo
--    entraba ahí. Por eso el producto no tiene botón de borrar sede y por
--    eso "edu_chairs"."campusId" apunta con RESTRICT.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Tablas ──────────────────────────────────────────────────────────

-- LA SEDE.
--
-- 🔴 LA ZONA HORARIA ES DE LA SEDE Y NO DEL INSTITUTO, y no es un adorno:
-- una universidad puede tener un campus en Tijuana y otro en Mérida, que
-- son dos husos distintos. La agenda de una sede se pinta y se guarda con
-- la de esa sede; la del instituto queda como respaldo para la vista
-- consolidada y para las sedes que no la cambiaron.
--
-- El default de "timezone" es Ciudad de México por lo mismo que el de
-- edu_institutions: esto es un producto GENÉRICO para cualquier escuela
-- del país. El backfill de la sección 3 NO usa este default — copia la
-- zona del instituto, que es la que esa escuela ya tenía configurada.
CREATE TABLE IF NOT EXISTS "edu_campuses" (
  "id"            TEXT         NOT NULL,
  "institutionId" TEXT         NOT NULL,
  "name"          VARCHAR(80)  NOT NULL,
  -- La clave corta que la escuela ya usa en sus papeles ("NORTE", "CU").
  -- Única DENTRO del instituto.
  "code"          VARCHAR(20)  NOT NULL,
  "address"       VARCHAR(200),
  "city"          VARCHAR(80),
  "state"         VARCHAR(80),
  "phone"         VARCHAR(30),
  "timezone"      VARCHAR(60)  NOT NULL DEFAULT 'America/Mexico_City',
  "isActive"      BOOLEAN      NOT NULL DEFAULT true,
  "orderIndex"    INTEGER      NOT NULL DEFAULT 0,
  "notes"         VARCHAR(300),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_campuses_pkey" PRIMARY KEY ("id")
);

-- A QUÉ SEDES ENTRA UNA PERSONA.
--
-- 🔴 SIN FILAS = ENTRA A TODAS LAS SEDES DE SU INSTITUTO. Está dicho
-- arriba y se repite aquí porque es la línea que hace que aplicar esta ola
-- no deje a nadie fuera, y porque leída al revés sorprende: quitarle a
-- alguien su ÚLTIMA sede no lo deja sin ninguna, lo deja con todas. El
-- producto lo avisa en pantalla en el momento de quitarla.
--
-- ⚠️ Esto NO es un permiso. Los permisos (edu_users."permissionsOverride")
-- dicen QUÉ puede hacer una persona; esto dice DÓNDE. Un docente con
-- agenda.view y acceso solo al campus norte ve la agenda —el permiso está
-- encendido— pero solo la del norte.
CREATE TABLE IF NOT EXISTS "edu_user_campus_access" (
  "id"            TEXT         NOT NULL,
  "institutionId" TEXT         NOT NULL,
  "userId"        TEXT         NOT NULL,
  "campusId"      TEXT         NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_user_campus_access_pkey" PRIMARY KEY ("id")
);


-- ── 2. Columnas nuevas ─────────────────────────────────────────────────
-- ADD COLUMN IF NOT EXISTS es idempotente por sí solo. Las dos nacen
-- NULLABLE para poder agregarse a tablas con filas sin reescribirlas; la
-- de los sillones pasa a NOT NULL en la sección 4, DESPUÉS del backfill.

-- EN QUÉ SEDE ESTÁ FÍSICAMENTE ESTE SILLÓN.
ALTER TABLE "edu_chairs" ADD COLUMN IF NOT EXISTS "campusId" TEXT;

-- EN QUÉ SEDE SE COBRÓ. Queda opcional para siempre, a propósito: el
-- dinero no se detiene por una columna de infraestructura. Un cobro sin
-- sede no sale bajo ningún filtro de sede y sí en la vista consolidada,
-- que es lo honesto — no se sabe dónde se cobró.
ALTER TABLE "edu_charges" ADD COLUMN IF NOT EXISTS "campusId" TEXT;


-- ═══════════════════════════════════════════════════════════════════════
-- 3. EL BACKFILL  ← SIN ESTO, AL APLICAR LA OLA LA AGENDA SE QUEDA VACÍA
--
-- Los institutos que ya existen no tienen sedes, y sus sillones no tienen
-- "campusId". En cuanto la agenda empiece a filtrar por sede, un sillón
-- sin sede no aparecería en ninguna — y con él, ninguna de sus citas.
--
-- 🔴 ESTO NO ES UNA SUPOSICIÓN. Hoy un instituto es UNA clínica: todos sus
-- sillones y todos sus cobros están, por definición, en el único edificio
-- que tiene. Colgarlos de una sede llamada "Sede principal" no inventa
-- información, la escribe.
--
-- Los tres pasos son idempotentes: el INSERT solo actúa sobre institutos
-- SIN ninguna sede, y los dos UPDATE solo sobre filas con "campusId" nulo.
-- ═══════════════════════════════════════════════════════════════════════

-- 3.1 · Una sede por defecto para cada instituto que ya exista.
--
-- Hereda ciudad, estado, teléfono y ZONA HORARIA del instituto: es
-- literalmente el mismo edificio. Si la escuela abre un segundo campus en
-- otro huso, se le pone la suya al darlo de alta.
--
-- El id: gen_random_uuid()::text. Prisma escribe cuids, pero la columna es
-- TEXT y lo único que se le pide a un id es ser único.
INSERT INTO "edu_campuses" (
  "id", "institutionId", "name", "code", "address", "city", "state",
  "phone", "timezone", "isActive", "orderIndex", "notes",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  i."id",
  'Sede principal',
  'PRINCIPAL',
  NULL,
  i."city",
  i."state",
  i."phone",
  i."timezone",
  true,
  1,
  'Creada al aplicar la Ola 11. Renombrala desde /instituto/sedes con el nombre que use la escuela.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "edu_institutions" i
WHERE NOT EXISTS (
  SELECT 1 FROM "edu_campuses" c WHERE c."institutionId" = i."id"
);

-- 3.2 · Los sillones que ya existen, colgados de la sede de su instituto.
--
-- Se elige la PRIMERA sede del instituto (por "orderIndex" y luego por
-- antigüedad) y no "la que se acaba de crear": si alguien ya había dado de
-- alta sedes a mano antes de correr esto, sus sillones van a la primera
-- suya y no a una recién inventada.
UPDATE "edu_chairs" ch
SET "campusId" = (
  SELECT c."id"
  FROM "edu_campuses" c
  WHERE c."institutionId" = ch."institutionId"
  ORDER BY c."orderIndex" ASC, c."createdAt" ASC, c."id" ASC
  LIMIT 1
)
WHERE ch."campusId" IS NULL;

-- 3.3 · Los cobros que ya existen, con la misma sede.
--
-- Un cobro anterior a esta ola se cobró en el único mostrador que había.
-- Sin esto, filtrar la caja por sede escondería TODO el histórico y desde
-- el mostrador se vería exactamente igual que si se hubiera borrado.
UPDATE "edu_charges" ca
SET "campusId" = (
  SELECT c."id"
  FROM "edu_campuses" c
  WHERE c."institutionId" = ca."institutionId"
  ORDER BY c."orderIndex" ASC, c."createdAt" ASC, c."id" ASC
  LIMIT 1
)
WHERE ca."campusId" IS NULL;


-- ── 4. El NOT NULL del sillón ──────────────────────────────────────────
-- Va DESPUÉS del backfill, obviamente. Es idempotente: SET NOT NULL sobre
-- una columna que ya lo es no hace nada y no falla.
--
-- La comprobación previa existe para dar un error que se entienda: si por
-- lo que sea quedara un sillón sin sede, Postgres diría "column contains
-- null values" y nadie sabría qué hacer con eso.
DO $edu$
BEGIN
  IF EXISTS (SELECT 1 FROM "edu_chairs" WHERE "campusId" IS NULL) THEN
    RAISE EXCEPTION 'Quedaron sillones sin sede: el backfill de la sección 3 no los alcanzó. Revisa que cada instituto con sillones tenga al menos una fila en edu_campuses y vuelve a correr este archivo.';
  END IF;
  ALTER TABLE "edu_chairs" ALTER COLUMN "campusId" SET NOT NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 5. EL NÚMERO DEL SILLÓN PASA A SER ÚNICO POR SEDE
--
-- 🔴 ÉSTE ES EL ÚNICO DROP DEL ARCHIVO, y es de una RESTRICCIÓN, no de
-- datos: no se borra ni una fila, ni una columna, ni una tabla. Lo único
-- que pasa es que a partir de aquí se permite algo que antes no se podía.
--
-- Por qué: el número del sillón existe para que la clínica pueda decir
-- "pásalo al 7", y es el que está PINTADO EN LA PARED. Con dos campus, el
-- norte y el sur tienen cada uno su "Sillón 1" pintado en su pared.
-- Manteniendo el único por instituto, el segundo campus tendría que
-- numerar del 21 al 40 y el número dejaría de ser el de la pared — que es
-- para lo único que sirve.
--
-- El orden importa: primero se CREA el índice nuevo (más laxo: nunca puede
-- fallar, porque el viejo era más estricto) y solo después se suelta el
-- viejo. Al revés, un fallo a la mitad dejaría la tabla sin ninguna
-- restricción de unicidad.
--
-- Y se intentan las dos formas de soltarlo porque puede existir de las dos
-- maneras: sql/edu-ola-2.sql lo creó como ÍNDICE, pero un `prisma db push`
-- lo habría creado como RESTRICCIÓN de tabla (y entonces DROP INDEX falla
-- diciendo que la restricción lo necesita).
-- ═══════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS "edu_chairs_sede_numero_key"
  ON "edu_chairs" ("institutionId", "campusId", "number");

ALTER TABLE "edu_chairs"
  DROP CONSTRAINT IF EXISTS "edu_chairs_institutionId_number_key";

DROP INDEX IF EXISTS "edu_chairs_institutionId_number_key";


-- ── 6. Índices ─────────────────────────────────────────────────────────

-- La clave de la sede es única DENTRO del instituto: dos escuelas pueden
-- tener las dos su sede "NORTE".
CREATE UNIQUE INDEX IF NOT EXISTS "edu_campuses_code_key"
  ON "edu_campuses" ("institutionId", "code");

CREATE INDEX IF NOT EXISTS "edu_campuses_orden_idx"
  ON "edu_campuses" ("institutionId", "isActive", "orderIndex");

-- Una persona no puede tener dos veces la misma sede. El índice va sobre
-- (userId, campusId) y no lleva institutionId porque el usuario ya
-- pertenece a un solo instituto: meterlo dejaría pasar la fila duplicada
-- si alguien escribiera un institutionId distinto a mano.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_user_campus_key"
  ON "edu_user_campus_access" ("userId", "campusId");

-- "¿quién entra a esta sede?" (la pantalla) y "¿a qué sedes entra esta
-- persona?" (CADA lectura del panel, en el layout).
CREATE INDEX IF NOT EXISTS "edu_user_campus_sede_idx"
  ON "edu_user_campus_access" ("institutionId", "campusId");

CREATE INDEX IF NOT EXISTS "edu_user_campus_persona_idx"
  ON "edu_user_campus_access" ("institutionId", "userId");

-- Los sillones de una sede, en el orden en que se pintan las columnas de
-- la agenda. Es la consulta de cada mañana.
CREATE INDEX IF NOT EXISTS "edu_chairs_sede_idx"
  ON "edu_chairs" ("institutionId", "campusId", "isActive", "orderIndex");

-- Los cobros de una sede por fecha: el "¿cuánto entró hoy en mi sede?".
CREATE INDEX IF NOT EXISTS "edu_charges_sede_idx"
  ON "edu_charges" ("institutionId", "campusId", "chargedAt");


-- ── 7. Llaves foráneas ─────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- envuelta en su bloque.
--
-- ⚠️ CASCADE vs RESTRICT vs SET NULL, y por qué NO son todas iguales:
--   · CASCADE  → lo que pertenece al instituto y lo que no tiene sentido
--     sin su padre (la sede sin su instituto, el acceso sin su persona o
--     sin su sede). El producto NO borra nada de esto: una sede se
--     DESACTIVA. El CASCADE está para que borrar un instituto entero
--     —operación de administración, no del panel— no se atore.
--   · RESTRICT → "edu_chairs"."campusId". Una sede con sillones NO se
--     borra ni por accidente: con CASCADE, un DELETE sobre una sede se
--     llevaría sus sillones, y con ellos TODAS sus citas y su historia.
--     Es la única FK con RESTRICT del vertical, y es deliberada.
--   · SET NULL → "edu_charges"."campusId". Perder la referencia a la sede
--     es aceptable; perder el COBRO, jamás. Un cobro es dinero.

DO $edu$
BEGIN
  ALTER TABLE "edu_campuses"
    ADD CONSTRAINT "edu_campuses_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_user_campus_access"
    ADD CONSTRAINT "edu_user_campus_access_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_user_campus_access"
    ADD CONSTRAINT "edu_user_campus_access_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "edu_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_user_campus_access"
    ADD CONSTRAINT "edu_user_campus_access_campusId_fkey"
    FOREIGN KEY ("campusId") REFERENCES "edu_campuses" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- 🔴 RESTRICT y NUNCA CASCADE. Ver la nota de arriba: una sede con
-- sillones no se borra ni por accidente.
DO $edu$
BEGIN
  ALTER TABLE "edu_chairs"
    ADD CONSTRAINT "edu_chairs_campusId_fkey"
    FOREIGN KEY ("campusId") REFERENCES "edu_campuses" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_charges"
    ADD CONSTRAINT "edu_charges_campusId_fkey"
    FOREIGN KEY ("campusId") REFERENCES "edu_campuses" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 8. Documentación en la propia base ─────────────────────────────────
-- COMMENT ON reemplaza el comentario anterior: es idempotente por sí solo.
COMMENT ON TABLE "edu_campuses" IS
  'SEDE del instituto (campus norte, campus sur, clínica de posgrado). NO sustituye al instituto: institutionId sigue siendo el aislamiento entre escuelas y la sede es una división DENTRO de una. No se borra nunca: se desactiva.';
COMMENT ON COLUMN "edu_campuses"."timezone" IS
  'Zona horaria DE LA SEDE, no del instituto: una universidad puede tener campus en husos distintos. La agenda de una sede se pinta y se guarda con ésta; la del instituto es el respaldo de la vista consolidada.';
COMMENT ON TABLE "edu_user_campus_access" IS
  'A qué sedes entra cada persona. SIN FILAS = ENTRA A TODAS las de su instituto (así aplicar la ola no dejó a nadie fuera). Con filas, solo a esas. No es un permiso: los permisos dicen QUÉ puede hacer alguien, esto dice DÓNDE.';
COMMENT ON COLUMN "edu_chairs"."campusId" IS
  'La sede donde está esta unidad. NOT NULL: un sillón sin sede desaparecería de la agenda en cuanto alguien filtrara por sede. La sede de una CITA se deriva de aquí — no hay columna copiada en edu_appointments, que se desincronizaría al mudar un sillón de edificio.';
COMMENT ON COLUMN "edu_chairs"."number" IS
  'El número pintado en la pared. Único dentro de la SEDE (no del instituto): el campus norte y el campus sur tienen cada uno su Sillón 1, y obligar al segundo a numerar del 21 al 40 rompe lo único para lo que sirve el número.';
COMMENT ON COLUMN "edu_charges"."campusId" IS
  'En qué sede se cobró, SELLADO al emitir. No es una copia de la sede de otra fila (un cobro no cuelga de ningún sillón): es un hecho del cobro, dónde estaba el mostrador. Opcional para que el dinero nunca se detenga por una columna de infraestructura.';


-- ═══════════════════════════════════════════════════════════════════════
-- 9. BACKFILL DEL OVERRIDE DE PERMISOS  ← LÉELO ANTES DE CERRAR EL ARCHIVO
--
-- 🔴 "permissionsOverride" REEMPLAZA al default del rol, no se suma. Es
-- decir: a quien YA tenga un override guardado, las DOS keys de esta ola
-- (sedes.view, sedes.manage) NO le llegan solas. Entrará al panel, no verá
-- "Sedes" en el menú, y desde fuera parecerá que la ola no se aplicó.
--
-- Quien tenga el override VACÍO (el caso normal) no necesita nada: cae al
-- default del rol y ya trae lo que le toca.
--
-- ⚠️ ES UN SOLO BLOQUE Y NO CUATRO: las dos keys son de DIRECCION y de
-- nadie más. Abrir un campus es una decisión de la escuela, y repartir
-- quién entra a cuál es repartir el acceso a los pacientes de un edificio
-- entero.
--
-- 🔴 Y OJO CON LO QUE **NO** HAY QUE HACER AQUÍ: el SELECTOR de sede, el
-- filtro de la agenda y el de caja NO piden ninguna de estas dos keys, y
-- por eso NO hay un bloque para docentes, alumnos ni caja. Cambiar de sede
-- es moverse entre lo que el ACCESO ya autoriza; si hiciera falta un
-- permiso, el día que se aplicara esta ola todo el mundo se quedaría sin
-- poder mirar su propia agenda.
--
-- Para ver a quién le falta:
--
-- SELECT "email", "role", "permissionsOverride"
-- FROM "edu_users"
-- WHERE cardinality("permissionsOverride") > 0;
--
-- Y para dárselas, DESCOMENTA el bloque:
--
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY['sedes.view', 'sedes.manage']::TEXT[]
--       )
--     )
-- WHERE "role" = 'DIRECCION'
--   AND cardinality("permissionsOverride") > 0;
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 10. COMPROBACIONES Y EJEMPLO
--
-- Todo lo de aquí abajo está COMENTADO a propósito: son consultas de
-- comprobación y un ejemplo, no parte de la migración.
--
-- ── ¿Quedó cada instituto con su sede, y cada sillón colgado? ──────────
-- Las tres columnas de la derecha tienen que dar 0.
--
-- SELECT i."name",
--        count(DISTINCT c."id")                              AS sedes,
--        count(DISTINCT ch."id") FILTER (WHERE ch."campusId" IS NULL) AS sillones_sin_sede,
--        count(DISTINCT ca."id") FILTER (WHERE ca."campusId" IS NULL) AS cobros_sin_sede
-- FROM "edu_institutions" i
-- LEFT JOIN "edu_campuses" c  ON c."institutionId"  = i."id"
-- LEFT JOIN "edu_chairs" ch   ON ch."institutionId" = i."id"
-- LEFT JOIN "edu_charges" ca  ON ca."institutionId" = i."id"
-- GROUP BY i."name";
--
-- ── ¿Cuántos sillones y cuántas citas futuras hay por sede? ────────────
-- Es lo que pinta /instituto/sedes. Si aquí sale un número y en la
-- pantalla sale otro, el sospechoso número uno es el ACCESO de quien mira.
--
-- SELECT c."name", c."timezone",
--        count(DISTINCT ch."id") AS sillones,
--        count(a."id")           AS citas_futuras
-- FROM "edu_campuses" c
-- LEFT JOIN "edu_chairs" ch ON ch."campusId" = c."id"
-- LEFT JOIN "edu_appointments" a
--   ON a."chairId" = ch."id"
--  AND a."startsAt" >= now()
--  AND a."status" NOT IN ('CANCELLED', 'NO_SHOW')
-- GROUP BY c."name", c."timezone"
-- ORDER BY c."name";
--
-- ── ¿Quién está RESTRINGIDO a alguna sede? ─────────────────────────────
-- 🔴 Los que NO salen en esta lista entran a TODAS las sedes. No es un
-- error de la consulta: es la regla.
--
-- SELECT u."email", u."role", string_agg(c."name", ', ' ORDER BY c."name") AS sedes
-- FROM "edu_users" u
-- JOIN "edu_user_campus_access" a ON a."userId" = u."id"
-- JOIN "edu_campuses" c ON c."id" = a."campusId"
-- GROUP BY u."email", u."role"
-- ORDER BY u."email";
--
-- ── EJEMPLO: abrir un segundo campus, en otro huso ─────────────────────
-- Sustituye 'ieo' por el slug del instituto que creaste con edu-ola-0.sql.
-- Lo normal es hacerlo desde /instituto/sedes sin tocar SQL.
--
-- INSERT INTO "edu_campuses"
--   ("id", "institutionId", "name", "code", "address", "city", "state",
--    "phone", "timezone", "isActive", "orderIndex", "notes",
--    "createdAt", "updatedAt")
-- SELECT
--   gen_random_uuid()::text, i."id",
--   'Campus Norte', 'NORTE',
--   'Blvd. Universidad 1200', 'Tijuana', 'Baja California',
--   NULL,
--   'America/Tijuana',          -- 🔴 OTRO HUSO: su agenda va en SU hora
--   true, 2, NULL,
--   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
-- FROM "edu_institutions" i
-- WHERE i."slug" = 'ieo'
-- ON CONFLICT DO NOTHING;
--
-- ── EJEMPLO: dejar a una persona SOLO en el campus norte ───────────────
-- 🔴 En cuanto tenga esta fila deja de entrar a las demás sedes. Y si
-- algún día se le borra esta única fila, vuelve a entrar a TODAS — que es
-- lo contrario de lo que suele querer decir "quitarle el acceso".
--
-- INSERT INTO "edu_user_campus_access"
--   ("id", "institutionId", "userId", "campusId", "createdAt")
-- SELECT gen_random_uuid()::text, u."institutionId", u."id", c."id",
--        CURRENT_TIMESTAMP
-- FROM "edu_users" u
-- JOIN "edu_campuses" c
--   ON c."institutionId" = u."institutionId" AND c."code" = 'NORTE'
-- WHERE u."email" = 'docente@ejemplo.mx'
-- ON CONFLICT DO NOTHING;
--
-- ── EJEMPLO: mudar un sillón de sede ───────────────────────────────────
-- ⚠️ Sus CITAS se van con él: la sede de una cita se deriva de su sillón.
-- Es lo que se quiere cuando una unidad se traslada de edificio, y es la
-- razón de que no exista edu_appointments."campusId".
--
-- UPDATE "edu_chairs" ch
-- SET "campusId" = (
--   SELECT c."id" FROM "edu_campuses" c
--   WHERE c."institutionId" = ch."institutionId" AND c."code" = 'NORTE'
-- )
-- WHERE ch."id" = '<id del sillón>';
-- ═══════════════════════════════════════════════════════════════════════
