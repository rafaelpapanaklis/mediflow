-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola 1B · EQUIPO Y BUSCADOR SIN ACENTOS.
--
-- Va DESPUÉS de sql/edu-ola-0.sql, edu-ola-1.sql, edu-ola-2.sql,
-- edu-ola-3.sql y edu-ola-5.sql (necesita "edu_users", "edu_students" y
-- "edu_patients"). Producto SEPARADO del dental, que está VIVO en
-- producción: este archivo NO toca ni una tabla, ni una columna, ni una
-- fila del dental, de barbería ni de inmuebles.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   3 columnas nuevas  · "searchIndex" en edu_users, edu_students y
--                        edu_patients (VARCHAR(400) NOT NULL DEFAULT '')
--   1 función          · edu_search_norm(text) — quita acentos y baja a
--                        minúsculas, IMMUTABLE
--   3 backfills        · reescriben el índice de TODAS las filas que ya
--                        existen (sin esto, los pacientes de ayer dejan de
--                        aparecer en el buscador)
--   0 tablas · 0 enums · 0 llaves foráneas
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run. Es la ÚNICA fuente
-- de verdad del SQL del vertical; las mismas columnas están en
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
-- 🔴 EL BUG QUE ARREGLA ESTE ARCHIVO
--
-- En /instituto/pacientes, buscar "Mar" encontraba a "María Elena
-- Rodríguez"; buscar "Rodriguez" SIN acento devolvía CERO, con el apellido
-- "Rodríguez" en la ficha. Nadie escribe acentos en un buscador, así que el
-- producto se sentía roto: el paciente estaba ahí y no aparecía.
--
-- El `contains` de Prisma se traduce a `LIKE '%…%'` y compara el texto tal
-- cual; `mode: "insensitive"` arregla las MAYÚSCULAS y no los acentos.
--
-- ── POR QUÉ UNA COLUMNA Y NO unaccent() ────────────────────────────────
-- `unaccent()` es más corto de escribir pero solo se puede usar desde SQL
-- crudo: Prisma no admite una función alrededor de la columna en un
-- `contains`. Meter $queryRaw en el buscador significaría sacar el `where`
-- del único sitio donde hoy vive y, con él, el filtro de institutionId —
-- que es exactamente el filtro que nadie puede olvidar.
--
-- Así que la aplicación ESCRIBE el texto ya normalizado en una columna
-- ("searchIndex") en cada alta y en cada edición, y busca ahí con el
-- `contains` de siempre. Este archivo crea la columna y rellena lo que ya
-- existía.
--
-- ⚠️ La normalización de aquí (edu_search_norm) tiene que decir lo MISMO
-- que la de la aplicación (eduNormalizeSearch, en src/lib/edu/search.ts).
-- Cubren el mismo conjunto: minúsculas y sin tildes, diéresis, virgulilla
-- ni cedilla. Y aunque una fila quedara con una diferencia rarísima, se
-- corrige sola en cuanto alguien guarde esa ficha: quien manda es la
-- aplicación, esto solo pone al día lo viejo.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Las tres columnas ───────────────────────────────────────────────
-- NOT NULL con DEFAULT '' para que las filas que ya existen no queden en
-- NULL: un `LIKE` contra NULL no devuelve false, devuelve NULL, y esa fila
-- desaparecería del buscador sin que nadie entendiera por qué. El backfill
-- de la sección 3 les pone el valor de verdad.
--
-- 400 caracteres es el techo con holgura: nombre (80) + apellido (80) +
-- correo (160) + folio (30) + teléfono (30) = 380. La aplicación recorta a
-- 400 antes de escribir (EDU_SEARCH_INDEX_MAX), así que el INSERT no puede
-- reventar por largo.

ALTER TABLE "edu_users"
  ADD COLUMN IF NOT EXISTS "searchIndex" VARCHAR(400) NOT NULL DEFAULT '';

ALTER TABLE "edu_students"
  ADD COLUMN IF NOT EXISTS "searchIndex" VARCHAR(400) NOT NULL DEFAULT '';

ALTER TABLE "edu_patients"
  ADD COLUMN IF NOT EXISTS "searchIndex" VARCHAR(400) NOT NULL DEFAULT '';


-- ── 2. El normalizador ─────────────────────────────────────────────────
-- Minúsculas, sin acentos, espacios colapsados. Es el espejo en SQL de
-- eduNormalizeSearch (src/lib/edu/search.ts).
--
-- 🔴 SE USA translate() Y NO unaccent(), a propósito: unaccent es una
-- EXTENSIÓN, y no toda instalación de Postgres deja crearla (hace falta
-- privilegio, y en algunos alojamientos gestionados sencillamente no
-- está). Un .sql de migración que falle a la mitad porque una extensión no
-- se pudo crear es peor que una tabla de 53 letras. Si en tu instalación
-- sí existe, abajo está la variante comentada.
--
-- IMMUTABLE porque lo es de verdad (misma entrada, misma salida, siempre):
-- así se podría usar en un índice el día que la escuela crezca lo
-- suficiente para necesitarlo (ver la sección 5).
--
-- CREATE OR REPLACE es idempotente por sí solo: correr el archivo dos
-- veces deja exactamente la misma función.
CREATE OR REPLACE FUNCTION edu_search_norm(txt TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $edu$
  SELECT btrim(
           regexp_replace(
             translate(
               lower(coalesce(txt, '')),
               'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇçÝýÿ',
               'aaaaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuunnccyyy'
             ),
             '\s+', ' ', 'g'
           )
         );
$edu$;

-- La variante con la extensión, por si tu instalación la tiene y prefieres
-- la cobertura completa de Unicode (ø, đ, ł… que translate no cubre y que
-- no aparecen en un padrón mexicano):
--
-- CREATE EXTENSION IF NOT EXISTS unaccent;
-- CREATE OR REPLACE FUNCTION edu_search_norm(txt TEXT)
-- RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $edu$
--   SELECT btrim(regexp_replace(lower(unaccent(coalesce(txt, ''))), '\s+', ' ', 'g'));
-- $edu$;
--
-- ⚠️ OJO: unaccent() NO es IMMUTABLE por sí sola (depende del diccionario),
-- así que marcarla así es una promesa que haces tú. Para un WHERE da
-- igual; para un ÍNDICE, si algún día cambias el diccionario, el índice se
-- queda mintiendo y hay que reconstruirlo.


-- ── 3. EL BACKFILL ─────────────────────────────────────────────────────
-- 🔴 SIN ESTO LA OLA NO SIRVE DE NADA. La columna nace vacía, así que
-- TODOS los pacientes, alumnos y cuentas que ya existen dejarían de
-- aparecer en el buscador — el bug pasaría de "no encuentra con acentos" a
-- "no encuentra nada", que es peor.
--
-- Se reescriben TODAS las filas y no solo las vacías: correr el archivo dos
-- veces tiene que dejar exactamente el mismo resultado, y si una fila
-- quedó con un índice viejo (por ejemplo porque se editó con una versión
-- anterior del código), esto la pone al día.
--
-- Las tablas de un instituto son de decenas o cientos de filas: estos tres
-- UPDATE tardan menos de lo que tarda el editor de Supabase en pintarlos.

-- Las cuentas: nombre + apellido + correo + los DÍGITOS del teléfono. El
-- teléfono va sin adornos porque así se guarda y así se busca (quien
-- teclea "55 4433" tiene que encontrar al que se capturó "5544332211").
UPDATE "edu_users"
SET "searchIndex" = left(
      edu_search_norm(
        concat_ws(' ',
          "firstName",
          "lastName",
          "email",
          regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g')
        )
      ), 400);

-- Los alumnos: SOLO la matrícula. El nombre vive en su edu_users y se
-- busca por ahí — el `where` del padrón mira las dos columnas. Meter aquí
-- el nombre de la persona haría que renombrarla dejara la matrícula pegada
-- a un nombre viejo, y nadie se enteraría hasta buscarlo.
UPDATE "edu_students"
SET "searchIndex" = left(edu_search_norm("matricula"), 400);

-- Los pacientes: folio + nombre + apellido + dígitos del teléfono + correo.
-- El folio va PRIMERO porque es lo que más se busca en un mostrador.
UPDATE "edu_patients"
SET "searchIndex" = left(
      edu_search_norm(
        concat_ws(' ',
          "folio",
          "firstName",
          "lastName",
          regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g'),
          coalesce("email", '')
        )
      ), 400);


-- ── 4. Documentación en la propia base ─────────────────────────────────
-- COMMENT ON reemplaza el comentario anterior: es idempotente por sí solo.
COMMENT ON COLUMN "edu_users"."searchIndex" IS
  'Nombre + apellido + correo + dígitos del teléfono, en minúsculas y SIN ACENTOS. La escribe la aplicación (eduUserSearchIndex) en cada alta y edición; nunca se pinta. Es lo único que mira el buscador de equipo.';
COMMENT ON COLUMN "edu_students"."searchIndex" IS
  'La matrícula normalizada. El nombre del alumno se busca por el searchIndex de su edu_users: cada índice se alimenta SOLO de su propia fila.';
COMMENT ON COLUMN "edu_patients"."searchIndex" IS
  'Folio + nombre + apellido + dígitos del teléfono + correo, sin acentos y en minúsculas. Sin ella, buscar "Rodriguez" devolvía cero con "Rodríguez" en la ficha.';
COMMENT ON FUNCTION edu_search_norm(TEXT) IS
  'Espejo en SQL de eduNormalizeSearch (src/lib/edu/search.ts). Solo la usa el backfill: en marcha, quien escribe el índice es la aplicación.';


-- ═══════════════════════════════════════════════════════════════════════
-- 5. ÍNDICES: POR QUÉ NO HAY NINGUNO (y cuándo hará falta uno)
--
-- Un `LIKE '%texto%'` no puede usar un índice B-tree: el comodín de delante
-- lo descarta. Así que crear uno sobre "searchIndex" no serviría de nada y
-- solo costaría escrituras.
--
-- Lo que SÍ serviría es un índice GIN de trigramas, pero necesita la
-- extensión pg_trgm y no hace falta todavía: la lista de un instituto son
-- cientos de filas y un recorrido secuencial sobre cientos de VARCHAR es
-- instantáneo. El día que una escuela pase de unas decenas de miles de
-- pacientes, esto es lo que hay que correr (y NADA más: la consulta no
-- cambia, el índice se usa solo):
--
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX IF NOT EXISTS "edu_patients_search_trgm"
--   ON "edu_patients" USING GIN ("searchIndex" gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS "edu_users_search_trgm"
--   ON "edu_users" USING GIN ("searchIndex" gin_trgm_ops);
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 6. BACKFILL DEL OVERRIDE DE PERMISOS  ← LÉELO ANTES DE CERRAR EL ARCHIVO
--
-- 🔴 "permissionsOverride" REEMPLAZA al default del rol, no se suma. Es
-- decir: a quien YA tenga un override guardado, la key nueva de esta ola
-- ("equipo.manage") NO le llega sola. Entrará al panel, no verá "Equipo" en
-- el menú, y desde fuera parecerá que la ola no se aplicó — que es
-- exactamente lo que pasó con las olas anteriores y por eso este bloque
-- existe en todos los .sql del vertical.
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
-- Y para dárselo, DESCOMENTA el bloque.
--
-- ⚠️ HAY UN SOLO BLOQUE, y no es un olvido: "equipo.manage" es de
-- DIRECCION y de nadie más. Desde esa pantalla se puede crear una cuenta
-- con rol DIRECCION, así que copiárselo a un docente o a caja sería
-- regalarles la llave de la escuela. Si una escuela quiere que su
-- coordinador dé altas, que se le encienda a ESA persona, a sabiendas.
--
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY['equipo.manage']::TEXT[]
--       )
--     )
-- WHERE "role" = 'DIRECCION'
--   AND cardinality("permissionsOverride") > 0;
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 7. COMPROBACIÓN
--
-- 1) Que las tres columnas existen y ninguna quedó vacía por accidente:
--
-- SELECT 'edu_users'    AS tabla, count(*) AS filas,
--        count(*) FILTER (WHERE "searchIndex" = '') AS sin_indice
-- FROM "edu_users"
-- UNION ALL
-- SELECT 'edu_students', count(*), count(*) FILTER (WHERE "searchIndex" = '')
-- FROM "edu_students"
-- UNION ALL
-- SELECT 'edu_patients', count(*), count(*) FILTER (WHERE "searchIndex" = '')
-- FROM "edu_patients";
--
-- (Un "sin_indice" mayor que cero solo es normal si esa fila no tiene NADA
-- que indexar, que en la práctica no puede pasar: el nombre y el correo son
-- obligatorios.)
--
-- 2) La prueba de verdad, la del bug reportado — buscar sin acento tiene
--    que encontrar al que lo lleva:
--
-- SELECT "folio", "firstName", "lastName", "searchIndex"
-- FROM "edu_patients"
-- WHERE "searchIndex" LIKE '%rodriguez%';
--
-- Eso tiene que devolver a "María Elena Rodríguez". Si devuelve cero filas
-- y la paciente existe, el sospechoso número uno es que el backfill de la
-- sección 3 no se corrió.
--
-- 3) Y al revés, que el acento también encuentra:
--
-- SELECT edu_search_norm('Rodríguez') = 'rodriguez' AS quita_el_acento,
--        edu_search_norm('MARÍA  ELENA') = 'maria elena' AS baja_y_colapsa,
--        edu_search_norm('Muñoz') = 'munoz' AS quita_la_enie;
--
-- Los tres tienen que salir true. Si alguno sale false, la función y
-- src/lib/edu/search.ts se desincronizaron y el buscador va a fallar solo
-- para esas letras.
-- ═══════════════════════════════════════════════════════════════════════
