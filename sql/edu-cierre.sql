-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — LA OLA DE CIERRE.
--
-- Va DESPUÉS de sql/edu-ola-0.sql … edu-ola-14.sql y de
-- sql/edu-fix-auditoria.sql (usa "edu_appointments", "edu_cases",
-- "edu_charges", "edu_users", "edu_patients" y "edu_students").
--
-- Producto SEPARADO del dental, que está VIVO en producción: este archivo
-- NO toca ni una tabla, ni una columna, ni una fila del dental, de
-- barbería ni de inmuebles.
--
-- IDEMPOTENTE: cada sección se puede correr dos veces sin duplicar ni
-- deshacer nada (IF NOT EXISTS en el DDL; los UPDATE dejan de encontrar
-- filas en la segunda pasada).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⚠️ HAZ RESPALDO ANTES: la sección 2 es un UPDATE sobre datos existentes.
--
-- Nota sobre los nombres: las columnas van en camelCase ENTRECOMILLADO
-- porque así las escribe Prisma; sin comillas Postgres las bajaría a
-- minúsculas y el cliente dejaría de encontrarlas.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 1. P2-10 · LA CLAVE DE IDEMPOTENCIA DEL COBRO (DDL, aditivo)
--
-- Dos POST idénticos emitían DOS cobros con dos folios, los dos con su
-- pago (el doble clic lo tapaba la pantalla; un reintento de red o un
-- Enter en dos pestañas, no). La columna guarda la clave que manda el
-- cliente y el índice único convierte la carrera de dos POST simultáneos
-- en "devuélvele el que ganó".
--
-- NULL no choca con NULL en un índice único de Postgres, así que los
-- cobros viejos (sin clave) y los POST de clientes que no la manden
-- siguen entrando igual.
--
-- 🔴 SIN ESTO, EL DESPLIEGUE DEL CIERRE TRUENA LA CAJA: el código escribe
-- "idempotencyKey" en cada cobro nuevo, y sin la columna el INSERT
-- fallaría (la lección de "una columna nueva rompe lecturas" vale igual
-- para escrituras). Este .sql va ANTES del deploy.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "edu_charges"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(80);

CREATE UNIQUE INDEX IF NOT EXISTS "edu_charges_idem_key"
  ON "edu_charges" ("institutionId", "idempotencyKey");


-- ═══════════════════════════════════════════════════════════════════════
-- 2. EL PUNTO 1 DEL CIERRE · LAS CITAS QUE SE AGENDARON ANTES DE ABRIR EL
--    CASO Y SE QUEDARON SUELTAS PARA SIEMPRE
--
-- El orden NORMAL del producto: recepción agenda → el paciente llega → el
-- tamizaje abre el caso. El arreglo del P0-2 enganchaba al AGENDAR, al
-- REAGENDAR y al TRASPASAR — ninguno corre cuando el caso nace DESPUÉS de
-- la cita. Desde el cierre, createEduCase engancha al abrir
-- (src/lib/edu/casos.ts, eduAttachLooseAppointments); este UPDATE repara
-- las filas que ya quedaron así.
--
-- Es LA MISMA regla del código y del paso 1 de sql/edu-fix-auditoria.sql:
--   · solo citas SUELTAS ("caseId" IS NULL);
--   · solo si el par (paciente, alumno) tiene EXACTAMENTE UN caso vivo —
--     con dos (dos especialidades) no hay forma de saber cuál, y adivinar
--     mueve una sesión al expediente equivocado;
--   · el TAMIZAJE se queda fuera: es la valoración ANTERIOR al caso, y la
--     que abrió el caso ya la engancha el propio caso por su lado
--     ("screeningAppointmentId").
--
-- Si sql/edu-fix-auditoria.sql ya se corrió, esto solo alcanza a las citas
-- que quedaron sueltas DESPUÉS (las del hueco que este cierre tapa).
-- Correrlo dos veces actualiza cero filas la segunda. Las citas sueltas de
-- pares ya TRASPASADOS las repara el paso 2 de edu-fix-auditoria.sql — no
-- se repite aquí.
-- ═══════════════════════════════════════════════════════════════════════

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


-- ═══════════════════════════════════════════════════════════════════════
-- 3. P2-13 · BACKFILL DE "expediente.sign" EN LOS OVERRIDES
--
-- La ola parte "expediente.write" en escribir/entregar (write) y FIRMAR
-- (sign). El override REEMPLAZA al default del rol, así que la key nueva
-- NO le llega sola a quien tenga un override guardado.
--
-- 🔴 A DIFERENCIA de los backfills de olas anteriores, estos DOS UPDATE
-- van VIVOS (sin comentar), porque no correrlos no es "quedarse como
-- antes": es una REGRESIÓN. Antes del cierre, un DOCENTE o una DIRECCIÓN
-- con override que incluyera "expediente.write" PODÍA firmar; sin este
-- backfill dejaría de poder, en silencio, hasta que alguien tocara sus
-- casillas. Solo se les da a quienes ya tenían "expediente.write" en su
-- override (conservar lo que podían hacer, ni una llave más).
--
-- ⚠️ Y NO HAY BLOQUE DE ALUMNO, que es exactamente el punto de la ola: el
-- alumno escribe y ENTREGA; su nota la firma quien responde por él.
-- Copiarle el bloque del docente le devolvería la auto-firma que esto
-- viene a quitar.
-- ═══════════════════════════════════════════════════════════════════════

UPDATE "edu_users"
SET "permissionsOverride" = ARRAY(
      SELECT DISTINCT unnest("permissionsOverride" || ARRAY['expediente.sign']::TEXT[])
    )
WHERE "role" IN ('DIRECCION', 'DOCENTE')
  AND cardinality("permissionsOverride") > 0
  AND 'expediente.write' = ANY("permissionsOverride")
  AND NOT ('expediente.sign' = ANY("permissionsOverride"));


-- ═══════════════════════════════════════════════════════════════════════
-- 4. P3-16 · EL ÍNDICE DEL BUSCADOR (trigramas)
--
-- Los tres buscadores del vertical comparan con `contains` (LIKE '%…%')
-- sobre la columna normalizada "searchIndex" (pacientes, alumnos y
-- equipo), y un B-tree no sirve para un comodín inicial: cada búsqueda
-- recorría la tabla. Con cientos de filas da igual; con decenas de miles,
-- no — y un índice GIN de trigramas cubre exactamente ese operador.
--
-- ⚠️ Estos tres índices viven SOLO aquí y no en prisma/schema.prisma, y no
-- es un olvido: expresar `gin_trgm_ops` en el schema exigiría encender el
-- preview de extensiones de Prisma para TODO el repo — tocar la config del
-- producto dental por un índice del instituto. El schema y la base quedan
-- con esta diferencia A PROPÓSITO y este comentario es su registro (mismo
-- trato que los backfills: cosas que el .sql sabe y el schema no).
--
-- `pg_trgm` viene incluida en Supabase; el CREATE EXTENSION es inofensivo
-- si ya estaba.
-- ═══════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "edu_patients_search_trgm"
  ON "edu_patients" USING gin ("searchIndex" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "edu_students_search_trgm"
  ON "edu_students" USING gin ("searchIndex" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "edu_users_search_trgm"
  ON "edu_users" USING gin ("searchIndex" gin_trgm_ops);


-- ═══════════════════════════════════════════════════════════════════════
-- 5. COMPROBACIONES (correr a mano; no forman parte del arreglo)
--
-- ── ANTES de la sección 2 · cuántas citas va a enganchar ───────────────
--
-- SELECT count(*) AS sueltas_con_caso_vivo_unico
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
-- ── DESPUÉS de la sección 2 · el mismo SELECT tiene que dar 0 ──────────
--
-- ── DESPUÉS de la sección 3 · nadie con write y sin sign en su override ─
-- (solo DIRECCION y DOCENTE; un ALUMNO con write y sin sign es lo
--  CORRECTO, no un pendiente)
--
-- SELECT "email", "role", "permissionsOverride"
-- FROM "edu_users"
-- WHERE "role" IN ('DIRECCION', 'DOCENTE')
--   AND cardinality("permissionsOverride") > 0
--   AND 'expediente.write' = ANY("permissionsOverride")
--   AND NOT ('expediente.sign' = ANY("permissionsOverride"));
--
-- ── DESPUÉS de la sección 4 · los tres índices existen ─────────────────
--
-- SELECT indexname FROM pg_indexes
-- WHERE indexname IN ('edu_patients_search_trgm',
--                     'edu_students_search_trgm',
--                     'edu_users_search_trgm');
-- ═══════════════════════════════════════════════════════════════════════
