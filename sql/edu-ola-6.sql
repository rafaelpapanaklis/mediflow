-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola 6 · EVALUACIÓN ACADÉMICA.
--
-- Va DESPUÉS de sql/edu-ola-0.sql, sql/edu-ola-1.sql, sql/edu-ola-2.sql y
-- sql/edu-ola-5.sql (necesita "edu_institutions", "edu_users",
-- "edu_students", "edu_programs", "edu_cases" y "edu_procedures").
-- Producto SEPARADO del dental, que está VIVO en producción: este archivo
-- NO toca ni una tabla, ni una columna, ni una fila del dental, de
-- barbería ni de inmuebles.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   0 enums    · esta ola no agrega ninguno (los tres estados del semáforo
--                se CALCULAN, no se guardan — ver la nota de más abajo)
--   5 tablas   · edu_rubrics, edu_rubric_criteria, edu_case_grades,
--                edu_case_grade_items, edu_requirements
--   4 columnas nuevas en edu_cases · "procedureId",
--                "transferredFromCaseId", "transferReason",
--                "transferredByUserId"
--  16 índices  · 3 únicos + 13 de consulta
--  20 llaves foráneas
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
-- 🔴 LO QUE NO ESTÁ EN ESTE ARCHIVO, Y ES LA MITAD DE LA OLA
--
-- 1. NO HAY TABLA DE AVANCE. No existe ninguna columna "requisitos
--    cumplidos". El "lleva 5 de 8" se CUENTA cada vez que alguien
--    pregunta, contando los casos que encajan
--    (src/lib/edu/evaluacion.ts). Un contador guardado se desincroniza el
--    día que una escritura falle a la mitad o que alguien cierre un caso
--    por SQL — y el número que se enseña en una acreditación es
--    justamente ése.
--
-- 2. NO HAY TABLA DE HORAS CLÍNICAS. Se derivan de las citas COMPLETADAS
--    del alumno (edu_appointments: "startedAt"/"checkedInAt" →
--    "completedAt"). No hay captura manual: unas horas que se teclean son
--    unas horas que se pueden teclear mal.
--
-- 3. NO HAY ENUM DE "ATRASADO". Los tres estados del semáforo (al día,
--    vigilar, atrasado) se calculan comparando el avance real contra lo
--    esperado a esta altura del ciclo. Guardarlos obligaría a recalcular
--    la tabla entera cada noche, y el día que el cron fallara la
--    dirección hablaría con el alumno equivocado.
--
-- 4. NO HAY COLUMNA "calificación vigente" EN edu_cases. La calificación
--    actual es la fila de edu_case_grades que nadie corrige
--    ("correctsId"), igual que en la Ola 4 el estado del gate se LEE de
--    las autorizaciones en vez de vivir en una bandera del caso.
--
-- 🔴 NOTA SOBRE LOS NÚMEROS: las calificaciones van en INTEGER ×100
-- ("finalScoreX100", "scoreX100"), no en NUMERIC ni en DOUBLE PRECISION.
-- Un 8,75 se guarda como 875. Misma razón que el dinero de la Ola 5 va en
-- centavos: en coma flotante 0,1 + 0,2 no da 0,3, y un promedio de veinte
-- casos acumula ese error hasta que el acta impresa no cuadra con la
-- pantalla.
--
-- 🔴 NOTA SOBRE LOS TIPOS DE FECHA — no es un descuido que convivan dos:
--   · TIMESTAMP(3)   → sellos internos ("createdAt"/"updatedAt").
--   · TIMESTAMPTZ(3) → cuándo se calificó ("gradedAt"). Es un INSTANTE, y
--     la escuela puede estar en cualquier zona del país: la bitácora se
--     ordena por esa columna.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Columnas nuevas en edu_cases ────────────────────────────────────
-- ADD COLUMN IF NOT EXISTS es idempotente por sí solo. Las cuatro son
-- NULLABLE, así que se pueden agregar a una tabla con filas sin default y
-- sin reescribirla.

-- El procedimiento PRINCIPAL del caso, del catálogo de la Ola 5.
--
-- 🔴 Es lo que hace CONTABLE un requisito del plan de estudios ("tres
-- endodoncias unirradiculares para cerrar tercer semestre"). Sin esta
-- columna, un requisito solo podría decir "N casos de la especialidad", y
-- una escuela cuenta por procedimiento, no por caso genérico.
--
-- Opcional a propósito: el caso nace en el TAMIZAJE, donde todavía no se
-- sabe qué se le va a hacer al paciente. Un caso sin procedimiento no
-- cuenta para ningún requisito que pida uno — y la pantalla del alumno lo
-- DICE, en vez de dejarlo en cero sin explicación.
ALTER TABLE "edu_cases" ADD COLUMN IF NOT EXISTS "procedureId" TEXT;

-- DE QUÉ CASO VIENE. Auto-referencia, opcional.
--
-- 🔴 Un traspaso NO reescribe el "studentId": CIERRA el caso viejo como
-- TRANSFERRED y ABRE uno nuevo con el alumno nuevo, conservando paciente y
-- especialidad. Si se pudiera reescribir la columna, se borraría la
-- respuesta a "¿quién lo atendía en marzo?" — que es exactamente la
-- pregunta que se hace cuando algo sale mal en el sillón.
--
-- El expediente, los estudios y las calificaciones del caso viejo NO se
-- mueven ni se copian: quedan donde ocurrieron. Este enlace es lo que
-- permite leer la historia completa desde el caso nuevo.
ALTER TABLE "edu_cases" ADD COLUMN IF NOT EXISTS "transferredFromCaseId" TEXT;

-- Por qué se traspasó (rotación, egreso, baja) y quién lo hizo. Van en el
-- caso NUEVO: son la razón por la que existe.
ALTER TABLE "edu_cases" ADD COLUMN IF NOT EXISTS "transferReason" VARCHAR(500);
ALTER TABLE "edu_cases" ADD COLUMN IF NOT EXISTS "transferredByUserId" TEXT;


-- ── 2. Tablas ──────────────────────────────────────────────────────────

-- LA RÚBRICA. Reusable: se define una vez y se usa en cada caso.
--
-- "programId" y "procedureId" son los dos filtros con que se propone en
-- pantalla y los DOS son opcionales: una escuela chica tiene una sola
-- rúbrica clínica para todo, y obligar a elegir especialidad la dejaría
-- dando de alta la misma rúbrica seis veces.
--
-- 🔴 LA ESCALA LA DECIDE LA ESCUELA, NO EL CÓDIGO. "scaleMin"/"scaleMax"
-- guardan de cuánto a cuánto se califica: 1–10 en una escuela mexicana,
-- 0–100 en otra, 0–5 en la que usa letras. En ningún lado del producto hay
-- un 100 escrito a mano — se lee de aquí, y se CONGELA en cada
-- calificación para que subir la escala mañana no reinterprete lo que se
-- calificó ayer.
CREATE TABLE IF NOT EXISTS "edu_rubrics" (
  "id"            TEXT         NOT NULL,
  "institutionId" TEXT         NOT NULL,
  "name"          VARCHAR(120) NOT NULL,
  -- La especialidad para la que sirve. NULL = para todas.
  "programId"     TEXT,
  -- El procedimiento concreto que evalúa. NULL = cualquiera.
  "procedureId"   TEXT,
  -- Enteros: media escala no existe (la fracción vive en el PESO).
  "scaleMin"      INTEGER      NOT NULL DEFAULT 0,
  "scaleMax"      INTEGER      NOT NULL DEFAULT 100,
  "isActive"      BOOLEAN      NOT NULL DEFAULT true,
  "orderIndex"    INTEGER      NOT NULL DEFAULT 0,
  "notes"         VARCHAR(300),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_rubrics_pkey" PRIMARY KEY ("id")
);

-- UN CRITERIO de la rúbrica, con su PESO.
--
-- 🔴 Los pesos de una rúbrica suman 100, y eso lo valida la APLICACIÓN al
-- GUARDAR LA RÚBRICA (src/lib/edu/rubricas.ts), no la base y no al
-- calificar. Un CHECK de Postgres no puede sumar filas hermanas, y validar
-- al calificar haría que el error saliera con el paciente ya atendido, el
-- docente de pie y el alumno esperando — con la única salida de no
-- calificar. Validado al guardar, el que se equivoca es quien diseña la
-- rúbrica, sentado, y lo arregla ahí mismo.
--
-- El peso es ENTERO en por ciento (20 = 20 %). Sin decimales: 33,33 % ×3
-- no suma 100 y la validación quedaría condenada a una tolerancia, que es
-- como se acaba con rúbricas que suman 99,99 y nadie sabe por qué.
CREATE TABLE IF NOT EXISTS "edu_rubric_criteria" (
  "id"            TEXT         NOT NULL,
  "institutionId" TEXT         NOT NULL,
  "rubricId"      TEXT         NOT NULL,
  "name"          VARCHAR(120) NOT NULL,
  -- Qué se está mirando, para que dos docentes califiquen lo mismo.
  "description"   VARCHAR(500),
  "weightPercent" INTEGER      NOT NULL,
  "orderIndex"    INTEGER      NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_rubric_criteria_pkey" PRIMARY KEY ("id")
);

-- LA CALIFICACIÓN DE UN CASO.
--
-- 🔴 SOLO EL DOCENTE (O LA DIRECCIÓN) CALIFICA. El alumno VE su
-- calificación y sus comentarios, y no puede escribirla: lo cierran el
-- permiso "evaluacion.grade" —que un alumno no tiene— y una regla que no
-- depende de ningún permiso: nadie puede calificar su propio caso.
--
-- 🔴 UNA CALIFICACIÓN GUARDADA NO SE EDITA EN SILENCIO. Corregirla es
-- INSERTAR una fila nueva que apunta a la anterior con "correctsId",
-- exactamente como la nota firmada del expediente (edu_records) y por la
-- misma razón: si se pudiera reescribir, el registro dejaría de decir lo
-- que pasó y pasaría a decir lo que alguien quiere que parezca que pasó.
-- La calificación VIGENTE es la fila que nadie corrige — se LEE de las
-- filas, no vive en una bandera.
--
-- 🔴 LO CONGELADO Y POR QUÉ. "rubricName", "scaleMin" y "scaleMax" se
-- copian aquí al calificar, igual que "feeScheduleLabel" de la Ola 5. Si
-- la dirección renombra la rúbrica o cambia la escala de 10 a 100, un 8
-- calificado en octubre tiene que seguir leyéndose como 8/10 — y no como
-- 8/100, que sería reprobar a alguien por una edición administrativa.
CREATE TABLE IF NOT EXISTS "edu_case_grades" (
  "id"             TEXT         NOT NULL,
  "institutionId"  TEXT         NOT NULL,
  "caseId"         TEXT         NOT NULL,
  -- El ALUMNO calificado. Se guarda ADEMÁS del caso porque un caso se
  -- TRASPASA: la calificación se queda con quien la recibió, no con quien
  -- tiene el caso hoy.
  "studentId"      TEXT         NOT NULL,
  -- La rúbrica que se usó, con su nombre congelado al lado: perder la
  -- referencia es aceptable, perder la calificación no.
  "rubricId"       TEXT,
  "rubricName"     VARCHAR(120) NOT NULL,
  "scaleMin"       INTEGER      NOT NULL,
  "scaleMax"       INTEGER      NOT NULL,
  -- Quién calificó. NOT NULL: una calificación sin firma no sirve para
  -- hablar con el alumno ni para una acreditación.
  "gradedById"     TEXT         NOT NULL,
  "gradedAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Σ(puntuación × peso) / 100, ENTERA ×100 (un 8,75 se guarda como 875).
  "finalScoreX100" INTEGER      NOT NULL,
  -- Lo que el docente le dice al alumno. Es la mitad de para qué existe
  -- esto: un número sin comentario no enseña nada.
  "comment"        VARCHAR(2000),
  -- La calificación a la que ésta CORRIGE.
  "correctsId"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_case_grades_pkey" PRIMARY KEY ("id")
);

-- LA PUNTUACIÓN DE UN CRITERIO dentro de una calificación.
--
-- "criterionName" y "weightPercent" se CONGELAN aquí por lo mismo que el
-- nombre de la rúbrica: cambiar los pesos mañana no puede recalcular lo
-- que se calificó ayer. Y "criterionId" se guarda igual, para poder
-- agrupar "cómo va la escuela en Aislamiento" mientras el criterio exista.
CREATE TABLE IF NOT EXISTS "edu_case_grade_items" (
  "id"            TEXT         NOT NULL,
  "institutionId" TEXT         NOT NULL,
  "gradeId"       TEXT         NOT NULL,
  "criterionId"   TEXT,
  "criterionName" VARCHAR(120) NOT NULL,
  "weightPercent" INTEGER      NOT NULL,
  -- La puntuación en la escala de la rúbrica, ENTERA ×100 (8,5 → 850).
  "scoreX100"     INTEGER      NOT NULL,
  -- El comentario de ESTE criterio. Es donde de verdad se enseña: "el
  -- aislamiento se movió a la mitad" vale más que un 6 global.
  "comment"       VARCHAR(1000),
  "orderIndex"    INTEGER      NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_case_grade_items_pkey" PRIMARY KEY ("id")
);

-- UN REQUISITO DEL PLAN DE ESTUDIOS: lo que un alumno debe cumplir.
--
-- Lo captura la DIRECCIÓN, porque cada escuela tiene su plan. Se cuenta
-- por CASOS del alumno que encajan con el requisito.
--
-- 🔴 EL AVANCE NO SE GUARDA. No hay aquí —ni en ninguna tabla— un
-- "cumplidos: 5". Se cuenta al preguntar.
--
-- "semesterFrom"/"semesterTo" NO filtran a qué alumnos les aplica: dicen
-- PARA CUÁNDO se espera. Un requisito de 1º–3º se le sigue exigiendo al de
-- 5º que no lo cumplió — si el rango lo excluyera, atrasarse sería la
-- forma de dejar de deber algo.
CREATE TABLE IF NOT EXISTS "edu_requirements" (
  "id"            TEXT         NOT NULL,
  "institutionId" TEXT         NOT NULL,
  "name"          VARCHAR(120) NOT NULL,
  -- NOT NULL: un requisito es de un plan de estudios, y un plan de
  -- estudios es de una especialidad.
  "programId"     TEXT         NOT NULL,
  "semesterFrom"  INTEGER,
  "semesterTo"    INTEGER,
  -- Qué cuenta: un procedimiento concreto, o toda una categoría del
  -- catálogo. Los dos nulos = cualquier caso de la especialidad. Que no se
  -- pongan LOS DOS lo garantiza la aplicación: juntos casi nunca coinciden
  -- y el requisito contaría cero sin que nadie supiera por qué.
  "procedureId"   TEXT,
  "category"      VARCHAR(60),
  "requiredCount" INTEGER      NOT NULL,
  -- En true (lo normal) un caso a medias no suma; en false suma desde que
  -- se abre, que es lo que quiere una escuela que mide exposición y no
  -- resultado.
  "onlyCompleted" BOOLEAN      NOT NULL DEFAULT true,
  "isActive"      BOOLEAN      NOT NULL DEFAULT true,
  "orderIndex"    INTEGER      NOT NULL DEFAULT 0,
  "notes"         VARCHAR(300),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_requirements_pkey" PRIMARY KEY ("id")
);


-- ── 3. Índices ─────────────────────────────────────────────────────────
-- Los nombres son los que genera (o los que le dice el `map:` de) Prisma:
-- si algún día se corre `prisma migrate diff` contra esta base, los
-- reconoce y no propone recrearlos.

-- Rúbricas: el nombre no se repite dentro del instituto. Es lo que el
-- docente elige en un desplegable, y dos que se llaman igual son dos
-- opciones indistinguibles.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_rubrics_institutionId_name_key"
  ON "edu_rubrics" ("institutionId", "name");

CREATE INDEX IF NOT EXISTS "edu_rubrics_orden_idx"
  ON "edu_rubrics" ("institutionId", "isActive", "orderIndex");

CREATE INDEX IF NOT EXISTS "edu_rubrics_program_idx"
  ON "edu_rubrics" ("institutionId", "programId");

CREATE INDEX IF NOT EXISTS "edu_rubrics_procedure_idx"
  ON "edu_rubrics" ("institutionId", "procedureId");

-- Criterios: el nombre no se repite DENTRO de una rúbrica (dos
-- "Aislamiento" en la misma rúbrica son un error de captura).
CREATE UNIQUE INDEX IF NOT EXISTS "edu_rubric_criteria_nombre_key"
  ON "edu_rubric_criteria" ("rubricId", "name");

CREATE INDEX IF NOT EXISTS "edu_rubric_criteria_orden_idx"
  ON "edu_rubric_criteria" ("institutionId", "rubricId", "orderIndex");

-- Calificaciones: por caso (la ficha), por alumno (la bitácora) y por la
-- cadena de correcciones (qué fila corrige a cuál).
CREATE INDEX IF NOT EXISTS "edu_case_grades_case_idx"
  ON "edu_case_grades" ("institutionId", "caseId", "gradedAt");

CREATE INDEX IF NOT EXISTS "edu_case_grades_student_idx"
  ON "edu_case_grades" ("institutionId", "studentId", "gradedAt");

CREATE INDEX IF NOT EXISTS "edu_case_grades_corrects_idx"
  ON "edu_case_grades" ("institutionId", "correctsId");

CREATE INDEX IF NOT EXISTS "edu_case_grade_items_grade_idx"
  ON "edu_case_grade_items" ("institutionId", "gradeId", "orderIndex");

CREATE INDEX IF NOT EXISTS "edu_case_grade_items_criterion_idx"
  ON "edu_case_grade_items" ("institutionId", "criterionId");

-- Requisitos: el nombre no se repite dentro de la misma especialidad.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_requirements_nombre_key"
  ON "edu_requirements" ("institutionId", "programId", "name");

CREATE INDEX IF NOT EXISTS "edu_requirements_plan_idx"
  ON "edu_requirements" ("institutionId", "programId", "isActive", "orderIndex");

CREATE INDEX IF NOT EXISTS "edu_requirements_procedure_idx"
  ON "edu_requirements" ("institutionId", "procedureId");

-- Casos: contar requisitos por procedimiento (la consulta que corre en
-- CADA apertura de la pantalla de Evaluación) y seguir la cadena de
-- traspasos hacia atrás sin recorrer la tabla.
CREATE INDEX IF NOT EXISTS "edu_cases_procedure_idx"
  ON "edu_cases" ("institutionId", "procedureId", "status");

CREATE INDEX IF NOT EXISTS "edu_cases_transfer_idx"
  ON "edu_cases" ("transferredFromCaseId");


-- ── 4. Llaves foráneas ─────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- envuelta en su bloque.
--
-- ⚠️ CASCADE vs SET NULL, y por qué no son todas iguales:
--   · CASCADE  → lo que pertenece al instituto y lo que no tiene sentido
--     sin su padre (los criterios sin su rúbrica, las puntuaciones sin su
--     calificación, la calificación sin su caso). El producto NO borra
--     nada de esto: una rúbrica se DESACTIVA y un requisito también. El
--     CASCADE está para que borrar un instituto entero —operación de
--     administración, no del panel— no se atore.
--   · SET NULL → las referencias "hacia los lados": la rúbrica que se
--     usó, el criterio de una puntuación, el procedimiento de un caso o
--     de un requisito, el caso del que viene un traspaso, quién lo hizo.
--     Perder la referencia es aceptable; perder la calificación, no. El
--     texto congelado ("rubricName", "criterionName") sobrevive a esos
--     NULL, que es justamente para lo que está.
--
-- 🔴 "gradedById" va en CASCADE y NO en SET NULL porque es NOT NULL: es el
-- rastro de quién calificó. En este producto un usuario no se borra —se
-- desactiva (isActive)— así que ese CASCADE no se dispara nunca desde el
-- panel; está para que borrar el instituto entero no se atore.

DO $edu$
BEGIN
  ALTER TABLE "edu_rubrics"
    ADD CONSTRAINT "edu_rubrics_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_rubrics"
    ADD CONSTRAINT "edu_rubrics_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "edu_programs" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_rubrics"
    ADD CONSTRAINT "edu_rubrics_procedureId_fkey"
    FOREIGN KEY ("procedureId") REFERENCES "edu_procedures" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_rubric_criteria"
    ADD CONSTRAINT "edu_rubric_criteria_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_rubric_criteria"
    ADD CONSTRAINT "edu_rubric_criteria_rubricId_fkey"
    FOREIGN KEY ("rubricId") REFERENCES "edu_rubrics" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_case_grades"
    ADD CONSTRAINT "edu_case_grades_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_case_grades"
    ADD CONSTRAINT "edu_case_grades_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "edu_cases" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_case_grades"
    ADD CONSTRAINT "edu_case_grades_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "edu_students" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_case_grades"
    ADD CONSTRAINT "edu_case_grades_rubricId_fkey"
    FOREIGN KEY ("rubricId") REFERENCES "edu_rubrics" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_case_grades"
    ADD CONSTRAINT "edu_case_grades_gradedById_fkey"
    FOREIGN KEY ("gradedById") REFERENCES "edu_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- La cadena de correcciones. SET NULL: perder el enlace es aceptable,
-- perder la corrección no.
DO $edu$
BEGIN
  ALTER TABLE "edu_case_grades"
    ADD CONSTRAINT "edu_case_grades_correctsId_fkey"
    FOREIGN KEY ("correctsId") REFERENCES "edu_case_grades" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_case_grade_items"
    ADD CONSTRAINT "edu_case_grade_items_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_case_grade_items"
    ADD CONSTRAINT "edu_case_grade_items_gradeId_fkey"
    FOREIGN KEY ("gradeId") REFERENCES "edu_case_grades" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_case_grade_items"
    ADD CONSTRAINT "edu_case_grade_items_criterionId_fkey"
    FOREIGN KEY ("criterionId") REFERENCES "edu_rubric_criteria" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_requirements"
    ADD CONSTRAINT "edu_requirements_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_requirements"
    ADD CONSTRAINT "edu_requirements_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "edu_programs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_requirements"
    ADD CONSTRAINT "edu_requirements_procedureId_fkey"
    FOREIGN KEY ("procedureId") REFERENCES "edu_procedures" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- Las tres columnas nuevas de edu_cases.
DO $edu$
BEGIN
  ALTER TABLE "edu_cases"
    ADD CONSTRAINT "edu_cases_procedureId_fkey"
    FOREIGN KEY ("procedureId") REFERENCES "edu_procedures" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- 🔴 Auto-referencia: SET NULL y NUNCA CASCADE. Con CASCADE, borrar el
-- caso viejo se llevaría por delante el caso NUEVO —el que tiene al
-- paciente hoy— y con él su expediente entero.
DO $edu$
BEGIN
  ALTER TABLE "edu_cases"
    ADD CONSTRAINT "edu_cases_transferredFromCaseId_fkey"
    FOREIGN KEY ("transferredFromCaseId") REFERENCES "edu_cases" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_cases"
    ADD CONSTRAINT "edu_cases_transferredByUserId_fkey"
    FOREIGN KEY ("transferredByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 5. Documentación en la propia base ─────────────────────────────────
-- COMMENT ON reemplaza el comentario anterior: es idempotente por sí solo.
COMMENT ON TABLE "edu_rubrics" IS
  'RÚBRICA reusable. La ESCALA la decide la escuela (scaleMin/scaleMax): en el código no hay ningún 100 escrito a mano, y la escala se CONGELA en cada calificación para que subirla mañana no reinterprete lo de ayer.';
COMMENT ON COLUMN "edu_rubric_criteria"."weightPercent" IS
  'Entero en por ciento. Los pesos de una rúbrica suman 100 y lo valida la APLICACIÓN al guardar la rúbrica: un CHECK no puede sumar filas hermanas, y validarlo al calificar sacaría el error con el paciente ya atendido.';
COMMENT ON TABLE "edu_case_grades" IS
  'CALIFICACIÓN de un caso. NO se edita: corregirla es INSERTAR una fila que apunta a la anterior (correctsId), igual que la nota firmada del expediente. La VIGENTE es la que nadie corrige — se lee de las filas, no vive en una bandera.';
COMMENT ON COLUMN "edu_case_grades"."finalScoreX100" IS
  'Σ(puntuación × peso)/100, ENTERA ×100 (8,75 = 875). Como el dinero en centavos: en coma flotante un promedio de veinte casos acumula error hasta que el acta impresa no cuadra con la pantalla.';
COMMENT ON COLUMN "edu_case_grades"."rubricName" IS
  'CONGELADO al calificar, igual que scaleMin/scaleMax. Renombrar la rúbrica o cambiar la escala no puede reinterpretar un 8/10 puesto en octubre.';
COMMENT ON COLUMN "edu_case_grades"."studentId" IS
  'Se guarda ADEMÁS del caso porque un caso se TRASPASA: la calificación se queda con quien la recibió, no con quien tiene el caso hoy.';
COMMENT ON COLUMN "edu_case_grade_items"."criterionName" IS
  'CONGELADO, con su peso. Cambiar la rúbrica mañana no recalcula lo que se calificó ayer.';
COMMENT ON TABLE "edu_requirements" IS
  'Requisito del plan de estudios. El AVANCE no se guarda en ningún lado: se cuenta contando los casos que encajan. Un contador guardado se desincroniza, y el número que se enseña en una acreditación es ése.';
COMMENT ON COLUMN "edu_requirements"."semesterFrom" IS
  'NO filtra a qué alumnos aplica: dice PARA CUÁNDO se espera. Un requisito de 1º-3º se le sigue exigiendo al de 5º que no lo cumplió; si el rango lo excluyera, atrasarse sería la forma de dejar de deber algo.';
COMMENT ON COLUMN "edu_cases"."procedureId" IS
  'El procedimiento PRINCIPAL. Es lo que hace contable un requisito del plan de estudios. Opcional: en el tamizaje todavía no se sabe qué se le va a hacer al paciente, y un caso sin procedimiento no cuenta para un requisito que pida uno (la pantalla lo dice).';
COMMENT ON COLUMN "edu_cases"."transferredFromCaseId" IS
  'DE QUÉ CASO VIENE. Un traspaso no reescribe el studentId: cierra el viejo como TRANSFERRED y abre uno nuevo. Si se reescribiera, se borraría la respuesta a "¿quién lo atendía en marzo?".';


-- ═══════════════════════════════════════════════════════════════════════
-- 6. BACKFILL DEL OVERRIDE DE PERMISOS  ← LÉELO ANTES DE CERRAR EL ARCHIVO
--
-- 🔴 "permissionsOverride" REEMPLAZA al default del rol, no se suma. Es
-- decir: a quien YA tenga un override guardado, las CINCO keys de esta ola
-- (rubricas.manage, requisitos.manage, evaluacion.view, evaluacion.grade,
-- traspaso.manage) NO le llegan solas. Entrará al panel, no verá
-- "Evaluación" ni "Rúbricas" ni "Requisitos" en el menú, y desde fuera
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
-- Y para dárselas, DESCOMENTA el bloque que corresponda.
--
-- ⚠️ SON TRES BLOQUES Y NO CUATRO: CAJA no recibe NI UNA key de esta ola.
-- Cobrar no es evaluar.
--
-- 🔴 Y OJO CON EL DEL ALUMNO: lleva "evaluacion.view" y NO
-- "evaluacion.grade". Copiarle el bloque del docente le dejaría calificar
-- —a sus compañeros, no a sí mismo, que eso lo impide el servidor— y esa
-- es exactamente la línea que sostiene la ola.
--
-- -- DIRECCION: las cinco. Diseña las rúbricas, captura el plan de
-- -- estudios, califica y traspasa.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'rubricas.manage', 'requisitos.manage',
--           'evaluacion.view', 'evaluacion.grade', 'traspaso.manage'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'DIRECCION'
--   AND cardinality("permissionsOverride") > 0;
--
-- -- DOCENTE: califica y reparte casos. NO diseña la rúbrica con la que
-- -- mide ni el plan contra el que se mide a su alumno.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'evaluacion.view', 'evaluacion.grade', 'traspaso.manage'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'DOCENTE'
--   AND cardinality("permissionsOverride") > 0;
--
-- -- ALUMNO: UNA sola key. Ve su calificación, sus comentarios y lo que le
-- -- falta; no escribe ninguna de esas cosas.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY['evaluacion.view']::TEXT[]
--       )
--     )
-- WHERE "role" = 'ALUMNO'
--   AND cardinality("permissionsOverride") > 0;
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 7. EJEMPLO: UNA RÚBRICA Y DOS REQUISITOS
--
-- Todo lo de aquí abajo está COMENTADO a propósito: es el ejemplo, no
-- parte de la migración. Descoméntalo, cámbiale los datos y córrelo aparte
-- — o hazlo desde /instituto/rubricas y /instituto/requisitos sin tocar
-- SQL, que es lo normal.
--
-- Sustituye 'ieo' por el slug del instituto que creaste con edu-ola-0.sql
-- y 'ENDO' por el código de tu especialidad.
--
-- ── La rúbrica ─────────────────────────────────────────────────────────
-- 🔴 La escala va de 1 a 10 en este ejemplo porque así califica una
-- escuela mexicana. Si la tuya usa 0-100, cámbialo aquí: el producto no
-- opina, lee esta columna.
--
-- INSERT INTO "edu_rubrics"
--   ("id", "institutionId", "name", "programId", "procedureId",
--    "scaleMin", "scaleMax", "isActive", "orderIndex", "notes",
--    "createdAt", "updatedAt")
-- SELECT
--   gen_random_uuid()::text,   -- Prisma escribe cuids; la columna es TEXT,
--                              -- así que cualquier id único sirve
--   i."id", 'Evaluación clínica de endodoncia', p."id", NULL,
--   1, 10, true, 1,
--   'Se usa en los casos de endodoncia de 3º y 4º semestre.',
--   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
-- FROM "edu_institutions" i
-- JOIN "edu_programs" p ON p."institutionId" = i."id" AND p."code" = 'ENDO'
-- WHERE i."slug" = 'ieo'
-- ON CONFLICT DO NOTHING;
--
-- ── Sus criterios: TIENEN QUE SUMAR 100 ────────────────────────────────
-- INSERT INTO "edu_rubric_criteria"
--   ("id", "institutionId", "rubricId", "name", "description",
--    "weightPercent", "orderIndex", "createdAt", "updatedAt")
-- SELECT
--   gen_random_uuid()::text, r."institutionId", r."id",
--   v."name", v."descripcion", v."peso", v."orden",
--   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
-- FROM "edu_rubrics" r
-- JOIN "edu_institutions" i ON i."id" = r."institutionId"
-- CROSS JOIN (VALUES
--   ('Aislamiento',   'Dique colocado antes de abrir, sin filtraciones.', 20, 1),
--   ('Conformación',  'Conductos permeables, sin escalones ni transportación.', 30, 2),
--   ('Obturación',    'Sin sobreobturación ni espacios; nivel correcto.', 30, 3),
--   ('Expediente',    'Nota firmada, radiografías subidas, consentimiento.', 20, 4)
-- ) AS v("name", "descripcion", "peso", "orden")
-- WHERE i."slug" = 'ieo'
--   AND r."name" = 'Evaluación clínica de endodoncia'
-- ON CONFLICT DO NOTHING;
--
-- ── Comprobación de los pesos (tiene que dar 100) ──────────────────────
-- SELECT r."name", sum(c."weightPercent") AS suma
-- FROM "edu_rubrics" r
-- JOIN "edu_rubric_criteria" c ON c."rubricId" = r."id"
-- JOIN "edu_institutions" i ON i."id" = r."institutionId"
-- WHERE i."slug" = 'ieo'
-- GROUP BY r."name";
--
-- ── Dos requisitos del plan ────────────────────────────────────────────
-- 🔴 El segundo cuenta por CATEGORÍA en vez de por procedimiento: es lo
-- que se usa cuando el plan dice "20 casos de operatoria" sin importar
-- cuál. La categoría es la del catálogo de procedimientos (Ola 5) y se
-- compara sin distinguir mayúsculas.
--
-- INSERT INTO "edu_requirements"
--   ("id", "institutionId", "name", "programId", "semesterFrom",
--    "semesterTo", "procedureId", "category", "requiredCount",
--    "onlyCompleted", "isActive", "orderIndex", "notes",
--    "createdAt", "updatedAt")
-- SELECT
--   gen_random_uuid()::text, i."id", v."name", p."id",
--   v."desde", v."hasta",
--   (SELECT pr."id" FROM "edu_procedures" pr
--     WHERE pr."institutionId" = i."id" AND pr."code" = v."codigo"),
--   v."categoria", v."cuantos", true, true, v."orden", NULL,
--   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
-- FROM "edu_institutions" i
-- JOIN "edu_programs" p ON p."institutionId" = i."id" AND p."code" = 'ENDO'
-- CROSS JOIN (VALUES
--   ('Endodoncias unirradiculares', 1, 4, 'ENDO-1', NULL,          8,  1),
--   ('Casos de operatoria',         1, 6, NULL,     'Operatoria', 20,  2)
-- ) AS v("name", "desde", "hasta", "codigo", "categoria", "cuantos", "orden")
-- WHERE i."slug" = 'ieo'
-- ON CONFLICT DO NOTHING;
--
-- ── Comprobación del avance de un alumno ───────────────────────────────
-- Es la MISMA cuenta que hace la pantalla, escrita en SQL. Si aquí sale un
-- número y en /instituto/evaluacion sale otro, el sospechoso número uno es
-- el "procedureId" de los casos: uno sin capturar no cuenta para un
-- requisito que pide un procedimiento.
--
-- SELECT s."matricula", rq."name", rq."requiredCount",
--        count(c."id") AS lleva
-- FROM "edu_students" s
-- JOIN "edu_institutions" i ON i."id" = s."institutionId"
-- JOIN "edu_requirements" rq
--   ON rq."institutionId" = s."institutionId"
--  AND rq."programId" = s."programId"
--  AND rq."isActive"
-- LEFT JOIN "edu_cases" c
--   ON c."studentId" = s."id"
--  AND c."programId" = rq."programId"
--  AND c."status" NOT IN ('TRANSFERRED', 'ABANDONED')
--  AND (NOT rq."onlyCompleted" OR c."status" = 'COMPLETED')
--  AND (rq."procedureId" IS NULL OR c."procedureId" = rq."procedureId")
--  AND (rq."category" IS NULL OR EXISTS (
--        SELECT 1 FROM "edu_procedures" pr
--        WHERE pr."id" = c."procedureId"
--          AND lower(btrim(pr."category")) = lower(btrim(rq."category"))))
-- WHERE i."slug" = 'ieo'
-- GROUP BY s."matricula", rq."name", rq."requiredCount", rq."orderIndex"
-- ORDER BY s."matricula", rq."orderIndex";
--
-- ── Comprobación de las horas clínicas ─────────────────────────────────
-- ⚠️ Este SELECT es una APROXIMACIÓN: la aplicación además recorta cada
-- cita a 8 horas (una cerrada a la mañana siguiente valdría dieciocho) y
-- separa lo real de lo estimado. La cuenta buena vive en
-- src/lib/edu/evaluacion-core.ts, que es donde se puede probar.
--
-- SELECT s."matricula",
--        round(sum(EXTRACT(EPOCH FROM (
--          a."completedAt" - COALESCE(a."startedAt", a."checkedInAt", a."startsAt")
--        )) / 3600.0)::numeric, 1) AS horas
-- FROM "edu_students" s
-- JOIN "edu_institutions" i ON i."id" = s."institutionId"
-- JOIN "edu_appointments" a
--   ON a."studentId" = s."id" AND a."status" = 'COMPLETED'
-- WHERE i."slug" = 'ieo'
-- GROUP BY s."matricula"
-- ORDER BY s."matricula";
--
-- Si la pantalla dice "sin calcular" sobre el semáforo de un alumno, el
-- sospechoso número uno es su GENERACIÓN: sin "startDate" y "endDate" no
-- se puede saber cuánto del ciclo ha transcurrido, y el producto prefiere
-- decirlo a inventar una duración.
--
-- SELECT "name", "startDate", "endDate" FROM "edu_cohorts"
-- WHERE "endDate" IS NULL;
-- ═══════════════════════════════════════════════════════════════════════
