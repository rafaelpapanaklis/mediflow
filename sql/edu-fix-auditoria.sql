-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — ARREGLO DE LA AUDITORÍA · las filas VIEJAS.
--
-- Va DESPUÉS de sql/edu-ola-0.sql, sql/edu-ola-1.sql y sql/edu-ola-2.sql
-- (necesita "edu_appointments" y "edu_cases"). Producto SEPARADO del
-- dental, que está VIVO en producción: este archivo NO toca ni una tabla,
-- ni una columna, ni una fila del dental, de barbería ni de inmuebles.
--
-- 🔴 SIN DDL. CERO DROP. Ni una tabla, ni una columna, ni un índice, ni un
-- enum. Este archivo solo REPARA DATOS de la tabla de citas del vertical, y
-- únicamente la columna "caseId".
--
-- Idempotente: los cuatro UPDATE están escritos de forma que, una vez
-- corridos, la segunda pasada actualiza CERO filas (las condiciones dejan
-- de cumplirse). Correrlo dos veces no duplica ni deshace nada.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
--
-- Nota sobre los nombres: las columnas van en camelCase ENTRECOMILLADO
-- porque así las escribe Prisma; sin comillas Postgres las bajaría a
-- minúsculas y el cliente dejaría de encontrarlas.
--
-- ═══════════════════════════════════════════════════════════════════════
-- POR QUÉ EXISTE ESTE ARCHIVO
--
-- Los arreglos del P0-2 y del P1-3 (ver docs/audits/EDU_AUDIT.md) están en
-- el CÓDIGO y valen desde el primer despliegue:
--
--   · al AGENDAR y al REAGENDAR, la cita se engancha sola al caso vivo de
--     ese paciente con ese alumno (src/lib/edu/agenda.ts);
--   · al TRASPASAR, las citas sueltas del alumno saliente con ese paciente
--     se enganchan al caso que entrega (src/lib/edu/traspasos.ts).
--
-- Lo que el código NO puede arreglar es lo que ya está escrito: las citas
-- que nacieron sin "caseId" ANTES de esto, y en particular las de los
-- traspasos que ya ocurrieron. Ésas son las filas que este archivo repara.
--
-- ⚠️ AUNQUE NO SE APLIQUE, EL AGUJERO ESTÁ CERRADO. El `where` de
-- visibilidad (src/lib/edu/visibility.ts) ya no le abre la ficha de un
-- paciente a quien le entregó un caso, tenga la cita suelta o no. Este
-- archivo NO es lo que cierra la puerta: es lo que deja los datos
-- diciendo la verdad, que además es lo que hace que la etapa SESSION del
-- gate de la Ola 4 sea alcanzable para las citas viejas y que la bitácora
-- enseñe el par caso↔cita completo.
--
-- ⚠️ HAZ RESPALDO ANTES. Son UPDATE sobre datos existentes, no CREATE. La
-- sección 5 trae los SELECT que hay que correr ANTES (para ver cuántas
-- filas va a tocar) y DESPUÉS (para comprobar que no quedó ninguna).
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Las citas SUELTAS que tienen un caso VIVO de ese mismo par ──────
--
-- Una cita de TRATAMIENTO o de CONTROL de un paciente con un alumno que ya
-- tiene un caso abierto con él pertenece a ese caso: es lo que la agenda
-- escribe desde el arreglo, y aquí se le pone a las que ya estaban.
--
-- Solo si el par (paciente, alumno) tiene EXACTAMENTE UN caso vivo. Con dos
-- (dos especialidades) no hay forma de saber cuál, y adivinar mueve una
-- sesión al expediente equivocado — que es peor que dejarla suelta.
--
-- El TAMIZAJE se queda fuera a propósito: es la valoración ANTERIOR al
-- caso, y el caso que abre ya la engancha por su lado
-- ("screeningAppointmentId", src/lib/edu/casos.ts).
UPDATE "edu_appointments" a
SET "caseId" = (
  SELECT c."id"
  FROM "edu_cases" c
  WHERE c."institutionId" = a."institutionId"
    AND c."patientId"     = a."patientId"
    AND c."studentId"     = a."studentId"
    AND c."status" NOT IN ('COMPLETED', 'TRANSFERRED', 'ABANDONED')
)
WHERE a."caseId" IS NULL
  AND a."type" <> 'TAMIZAJE'
  AND (
    SELECT count(*)
    FROM "edu_cases" c
    WHERE c."institutionId" = a."institutionId"
      AND c."patientId"     = a."patientId"
      AND c."studentId"     = a."studentId"
      AND c."status" NOT IN ('COMPLETED', 'TRANSFERRED', 'ABANDONED')
  ) = 1;


-- ── 2. Las citas SUELTAS de un caso que YA SE TRASPASÓ ─────────────────
--
-- 🔴 ÉSTA ES LA DEL P0-2. Un traspaso anterior a este arreglo movió el
-- caso y dejó las citas del alumno saliente colgando de nada — y una cita
-- suelta le seguía abriendo la ficha, el expediente, el odontograma y las
-- radiografías del paciente que entregó.
--
-- Engancharlas al caso TRANSFERRED no les quita nada al alumno: la cita
-- sigue siendo suya y sus horas clínicas se cuentan por
-- "edu_appointments"."studentId", no por el caso. Lo que deja de dar es
-- acceso al PACIENTE, que es lo que un traspaso significa.
--
-- Aquí sí entra el TAMIZAJE: si quedó suelto, es una llave suelta igual.
--
-- Va DESPUÉS del paso 1 a propósito: si el par además tiene un caso vivo
-- (el paciente volvió y se le abrió otro), el paso 1 ya se llevó sus citas
-- y este paso no las toca. Lo vivo manda sobre lo entregado.
UPDATE "edu_appointments" a
SET "caseId" = (
  SELECT c."id"
  FROM "edu_cases" c
  WHERE c."institutionId" = a."institutionId"
    AND c."patientId"     = a."patientId"
    AND c."studentId"     = a."studentId"
    AND c."status" = 'TRANSFERRED'
)
WHERE a."caseId" IS NULL
  AND (
    SELECT count(*)
    FROM "edu_cases" c
    WHERE c."institutionId" = a."institutionId"
      AND c."patientId"     = a."patientId"
      AND c."studentId"     = a."studentId"
      AND c."status" = 'TRANSFERRED'
  ) = 1;


-- ── 3. Las citas cuyo caso es de OTRO alumno o de OTRO paciente ────────
--
-- 🔴 ÉSTA ES LA DEL P1-3. Reagendar cambiaba el alumno de la cita y dejaba
-- el "caseId" del anterior: la fila decía que B atendió el caso de A. Con
-- eso, las horas se cuentan por un lado, el caso pertenece a otro, y la
-- etapa SESSION del gate de la Ola 4 firmaría una sesión que nadie dio.
--
-- 3.1 · Si el alumno que de verdad atendió tiene UN caso vivo con ese
-- paciente, la cita pasa a ESE caso, que es lo que el PATCH hace ahora.
UPDATE "edu_appointments" a
SET "caseId" = (
  SELECT c."id"
  FROM "edu_cases" c
  WHERE c."institutionId" = a."institutionId"
    AND c."patientId"     = a."patientId"
    AND c."studentId"     = a."studentId"
    AND c."status" NOT IN ('COMPLETED', 'TRANSFERRED', 'ABANDONED')
)
WHERE a."caseId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "edu_cases" c0
    WHERE c0."id" = a."caseId"
      AND (c0."studentId" <> a."studentId" OR c0."patientId" <> a."patientId")
  )
  AND (
    SELECT count(*)
    FROM "edu_cases" c
    WHERE c."institutionId" = a."institutionId"
      AND c."patientId"     = a."patientId"
      AND c."studentId"     = a."studentId"
      AND c."status" NOT IN ('COMPLETED', 'TRANSFERRED', 'ABANDONED')
  ) = 1;

-- 3.2 · Y si no lo tiene, la cita se SUELTA. Una cita sin caso es un dato
-- incompleto; una cita colgada del caso de otro es un dato FALSO, y de los
-- dos el que hay que quitar es el falso.
UPDATE "edu_appointments" a
SET "caseId" = NULL
WHERE a."caseId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "edu_cases" c0
    WHERE c0."id" = a."caseId"
      AND (c0."studentId" <> a."studentId" OR c0."patientId" <> a."patientId")
  );


-- ═══════════════════════════════════════════════════════════════════════
-- 4. LO QUE ESTE ARCHIVO NO ARREGLA, Y NO ES UN OLVIDO
--
-- · El P0-1 (las calificaciones del compañero) y el P1-4 (el padrón que
--   viajaba al navegador) son CÓDIGO. No hay una fila que reparar: lo que
--   estaba mal era la consulta, y ya no se hace.
--
-- · Las citas que quedan sueltas después de correr esto son las legítimas:
--   el TAMIZAJE anterior al caso, y la cita que se agendó antes de abrirlo.
--   Ésas TIENEN que seguir sueltas — son la razón de que el `where` de
--   pacientes contemple `"caseId" IS NULL`, y engancharlas a la fuerza
--   dejaría sin ficha a quien está valorando al paciente que tiene
--   enfrente.
--
-- · Los pares (paciente, alumno) con DOS casos vivos o DOS traspasos no se
--   tocan: no hay forma de saber a cuál pertenece cada cita. El primer
--   SELECT de la sección 5 los lista para revisarlos a mano; son los únicos
--   que quedan pendientes y en una escuela normal la cuenta es cero.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 5. COMPROBACIONES (correr a mano; no forman parte del arreglo)
--
-- ── ANTES · cuántas filas va a tocar ───────────────────────────────────
--
-- SELECT
--   count(*) FILTER (WHERE a."caseId" IS NULL)                    AS sueltas,
--   count(*) FILTER (WHERE a."caseId" IS NULL
--                      AND a."type" <> 'TAMIZAJE')                AS sueltas_no_tamizaje,
--   count(*) FILTER (WHERE a."caseId" IS NOT NULL AND EXISTS (
--       SELECT 1 FROM "edu_cases" c0 WHERE c0."id" = a."caseId"
--         AND (c0."studentId" <> a."studentId"
--           OR c0."patientId" <> a."patientId")))                 AS incoherentes
-- FROM "edu_appointments" a;
--
-- ── DESPUÉS · las tres tienen que dar 0 ────────────────────────────────
--
-- 1) Ninguna cita colgada del caso de otro alumno o de otro paciente:
--
-- SELECT count(*) AS incoherentes
-- FROM "edu_appointments" a
-- JOIN "edu_cases" c ON c."id" = a."caseId"
-- WHERE c."studentId" <> a."studentId" OR c."patientId" <> a."patientId";
--
-- 2) Ninguna cita suelta de un par que tiene caso TRANSFERIDO (la llave
--    que se quedaba puesta):
--
-- SELECT count(*) AS llaves_sueltas
-- FROM "edu_appointments" a
-- WHERE a."caseId" IS NULL
--   AND EXISTS (
--     SELECT 1 FROM "edu_cases" c
--     WHERE c."institutionId" = a."institutionId"
--       AND c."patientId"     = a."patientId"
--       AND c."studentId"     = a."studentId"
--       AND c."status" = 'TRANSFERRED'
--   )
--   AND (
--     SELECT count(*) FROM "edu_cases" c
--     WHERE c."institutionId" = a."institutionId"
--       AND c."patientId"     = a."patientId"
--       AND c."studentId"     = a."studentId"
--       AND c."status" = 'TRANSFERRED'
--   ) = 1;
--
-- 3) Ninguna cita suelta de TRATAMIENTO/CONTROL con un caso vivo del par:
--
-- SELECT count(*) AS deberian_estar_enganchadas
-- FROM "edu_appointments" a
-- WHERE a."caseId" IS NULL
--   AND a."type" <> 'TAMIZAJE'
--   AND (
--     SELECT count(*) FROM "edu_cases" c
--     WHERE c."institutionId" = a."institutionId"
--       AND c."patientId"     = a."patientId"
--       AND c."studentId"     = a."studentId"
--       AND c."status" NOT IN ('COMPLETED', 'TRANSFERRED', 'ABANDONED')
--   ) = 1;
--
-- ── LOS AMBIGUOS · los que hay que mirar a mano ────────────────────────
--
-- SELECT a."id" AS cita, a."type", a."startsAt", p."folio", s."matricula",
--        (SELECT count(*) FROM "edu_cases" c
--          WHERE c."institutionId" = a."institutionId"
--            AND c."patientId" = a."patientId"
--            AND c."studentId" = a."studentId"
--            AND c."status" NOT IN ('COMPLETED','TRANSFERRED','ABANDONED')) AS casos_vivos
-- FROM "edu_appointments" a
-- JOIN "edu_patients" p ON p."id" = a."patientId"
-- JOIN "edu_students" s ON s."id" = a."studentId"
-- WHERE a."caseId" IS NULL AND a."type" <> 'TAMIZAJE'
-- ORDER BY casos_vivos DESC, a."startsAt" DESC;
-- ═══════════════════════════════════════════════════════════════════════
