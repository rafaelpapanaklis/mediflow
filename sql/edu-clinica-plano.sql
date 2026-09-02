-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — EL PLANO DE LA CLÍNICA.
--
-- Va DESPUÉS de sql/edu-ola-11.sql (necesita "edu_campuses") y de
-- sql/edu-ola-0.sql (necesita "edu_institutions" y "edu_users"). En el
-- orden general de aplicación va al FINAL, después de sql/edu-volumen.sql.
-- Producto SEPARADO del dental, que está VIVO en producción: este archivo
-- NO toca ni una tabla, ni una columna, ni una fila del dental, de
-- barbería ni de inmuebles. En particular NO toca "clinic_layouts", que es
-- la tabla equivalente del dental.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   0 enums    · ninguno
--   1 tabla    · edu_campus_layouts
--   2 índices  · 1 único (la sede) + 1 de consulta (el instituto)
--   3 llaves foráneas
--   1 backfill · COMENTADO — la key de permiso nueva "clinica.edit" para
--                quien ya tenga "permissionsOverride" con contenido.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
--
-- Nota sobre $$: delimitador con nombre, $edu$, y NUNCA bloques DO
-- anidados — el parser SQL de Supabase rompe con $$ anidado.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 LO QUE ESTE ESQUEMA NO GUARDA, A PROPÓSITO:
--
--   · NO hay una fila por sede creada de antemano. SIN FILA = PLANO
--     AUTOMÁTICO: la pantalla arma una rejilla con los sillones activos de
--     esa sede (src/lib/edu/plano-core.ts, `eduPlanoAuto`) para que sirva
--     desde el primer día. La fila nace cuando la dirección acomoda el
--     plano y guarda. Por eso este .sql no lleva backfill de datos: no hay
--     nada que rellenar.
--
--   · NO hay tabla de "elementos": el plano entero viaja en UNA columna
--     JSONB, exactamente como "clinic_layouts"."elements" del dental. No
--     es pereza — el editor isométrico y el mundo 3D que lo pintan son los
--     del dental y leen `LayoutElement[]`; partirlo en filas obligaría a
--     recomponer el array en cada lectura para volver a la misma forma.
--
--   · NO hay llave foránea del sillón. El vínculo con la unidad real vive
--     DENTRO del JSON (`LayoutElement.resourceId` guarda un
--     "edu_chairs"."id"), así que la base no lo puede cuidar. Lo cuida la
--     ESCRITURA: `eduPlanoValidar` rechaza un sillón que no sea de ESA
--     sede y rechaza dos elementos ligados al mismo sillón; y la LECTURA
--     marca en pantalla el que se quedó colgando (un sillón dado de baja
--     después de dibujarlo). Un JSON no puede tener integridad
--     referencial: la tiene el código, y está en un solo sitio.
--
-- 🔴 UNO POR SEDE, NO POR INSTITUTO. El número de un sillón está pintado
-- en la pared de SU edificio y es único dentro de la SEDE (Ola 11), así
-- que un plano por escuela dibujaría dos edificios encima del otro. De ahí
-- que el índice único sea sobre "campusId".
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Tabla ───────────────────────────────────────────────────────────

-- EL PLANO DE UNA SEDE. Espejo de "clinic_layouts" del dental (mismas dos
-- columnas Json) porque lo pintan sus mismas piezas.
--
-- "updatedByUserId" es AUTORÍA y nada más: quién lo acomodó la última vez.
-- No decide visibilidad — el plano lo mira todo el piso clínico.
CREATE TABLE IF NOT EXISTS "edu_campus_layouts" (
  "id"              TEXT         NOT NULL,
  "institutionId"   TEXT         NOT NULL,
  -- 1:1 con la sede (índice único más abajo).
  "campusId"        TEXT         NOT NULL,
  -- `LayoutElement[]` tal como lo escribe el editor: [{ id, type, col,
  -- row, rotation, resourceId, name }]. '[]' = plano vacío GUARDADO, que
  -- NO es lo mismo que no tener fila (eso es plano automático).
  "elements"        JSONB        NOT NULL DEFAULT '[]',
  -- `LayoutMetadata`: { zoom, panOffset, lastEditAt, gridSize }.
  "metadata"        JSONB,
  "updatedByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_campus_layouts_pkey" PRIMARY KEY ("id")
);


-- ── 2. Índices ─────────────────────────────────────────────────────────

-- 🔴 UN plano por sede. Es el índice del que se agarra el upsert de
-- guardar (`where: { campusId }`), así que sin él la escritura falla.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_campus_layouts_campusId_key"
  ON "edu_campus_layouts" ("campusId");

-- "los planos de esta escuela": para verlos todos o para un borrado por
-- instituto sin recorrer la tabla entera.
CREATE INDEX IF NOT EXISTS "edu_campus_layouts_institucion_idx"
  ON "edu_campus_layouts" ("institutionId");


-- ── 3. Llaves foráneas ─────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- envuelta en su bloque.
--
-- ⚠️ CASCADE vs SET NULL:
--   · CASCADE  → el plano no significa nada sin su instituto ni sin su
--     sede. Cerrar una sede se lleva su dibujo; sus sillones ya no están.
--   · SET NULL → quién lo acomodó. Dar de baja a esa persona no puede
--     borrar el plano de la clínica.

DO $edu$
BEGIN
  ALTER TABLE "edu_campus_layouts"
    ADD CONSTRAINT "edu_campus_layouts_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_campus_layouts"
    ADD CONSTRAINT "edu_campus_layouts_campusId_fkey"
    FOREIGN KEY ("campusId") REFERENCES "edu_campuses" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_campus_layouts"
    ADD CONSTRAINT "edu_campus_layouts_updatedByUserId_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 4. 🔴 BACKFILL DE PERMISOS — LÉELO ANTES DE DAR POR APLICADA LA OLA
--
-- La key nueva es UNA: "clinica.edit" (acomodar el plano). La de mirar el
-- piso, "clinica.view", ya existe desde la ola de la Clínica en vivo y no
-- se toca.
--
-- El override REEMPLAZA al default del rol, NO se suma. Consecuencia: a
-- quien ya tenga un "permissionsOverride" con keys guardadas, ésta NO le
-- llega sola. Verá el plano y no el botón de acomodarlo, y desde fuera
-- parecerá que la ola no se aplicó.
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
-- ⚠️ ES UN SOLO BLOQUE Y ES SOLO PARA DIRECCION. El DOCENTE MIRA el piso
-- —lleva "clinica.view" desde la ola anterior— pero NO lo acomoda: mover
-- un sillón de sitio cambia el plano que ven los otros treinta docentes y
-- los ciento veinte estudiantes de la escuela. Es infraestructura del
-- edificio, no la fila de nadie. Copiarle este bloque al docente le deja
-- redibujar la clínica entera.
--
-- -- DIRECCION: acomoda el plano de sus sedes.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY['clinica.edit']::TEXT[]
--       )
--     )
-- WHERE "role" = 'DIRECCION'
--   AND cardinality("permissionsOverride") > 0;
-- ═══════════════════════════════════════════════════════════════════════
