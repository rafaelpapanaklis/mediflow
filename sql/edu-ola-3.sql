-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola 3 · EL EXPEDIENTE CLÍNICO.
--
-- Va DESPUÉS de sql/edu-ola-0.sql, sql/edu-ola-1.sql y sql/edu-ola-2.sql
-- (necesita "edu_institutions", "edu_users", "edu_students", "edu_patients",
-- "edu_cases" y "edu_appointments"). Producto SEPARADO del dental, que está
-- VIVO en producción: este archivo NO toca ni una tabla, ni una columna, ni
-- una fila del dental, de barbería ni de inmuebles.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   2 enums    · "EduRecordStatus", "EduStudyKind"
--   3 tablas   · edu_records, edu_odontogram_entries, edu_studies
--   9 índices  · 2 únicos + 7 de consulta
--  14 llaves foráneas
--   1 bucket   · edu-files (PRIVADO) — sección 5, al final
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
-- 🔴 TRES DECISIONES DE ESTE ARCHIVO QUE NO SON DE ESTILO:
--
--   1. "edu_odontogram_entries"."surface" es NOT NULL con DEFAULT ''.
--      Postgres considera DISTINTOS dos NULL dentro de un índice único: con
--      la columna nullable, el mismo hallazgo de diente completo entraría
--      dos, diez o mil veces y el índice no diría nada. La cadena VACÍA
--      significa "el diente entero" y sí la compara el índice.
--
--   2. "edu_studies"."sizeBytes" es BIGINT y no INTEGER. El tope de subida
--      son 2 GB = 2 147 483 648 bytes, UNO MÁS que el máximo de un INTEGER
--      (2 147 483 647). Con INTEGER, el archivo más grande que el producto
--      acepta desborda la columna justo después de que el usuario esperó
--      la subida entera.
--
--   3. NADA de bytes en la base. "edu_studies"."storagePath" guarda el PATH
--      interno del bucket, jamás una URL: una URL firmada caduca y quedaría
--      muerta en la columna. Se firma on-demand al leer.
--
-- 🔴 NOTA SOBRE LOS TIPOS DE FECHA — igual que en la Ola 2:
--   · TIMESTAMP(3) para todo lo de aquí. Las notas, los hallazgos y los
--     estudios se sellan con el instante en que se escribieron y se pintan
--     convirtiendo a la zona del instituto en la aplicación
--     (src/lib/edu/agenda-core.ts). Las columnas TIMESTAMPTZ de la Ola 2
--     son las de la AGENDA, donde la hora la teclea una persona.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Enums ───────────────────────────────────────────────────────────

-- Dónde va una nota clínica.
--
-- 🔴 NOM-004: FIRMADA es un estado FINAL. Una nota firmada no se edita ni
-- se borra; se corrige con una nota NUEVA que referencia a la anterior
-- ("correctsId"). Si se pudiera reescribir, el expediente dejaría de ser el
-- registro de lo que pasó y pasaría a ser el registro de lo que alguien
-- quiere que parezca que pasó.
DO $edu$
BEGIN
  CREATE TYPE "EduRecordStatus" AS ENUM ('BORRADOR', 'ENVIADA', 'FIRMADA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- Qué es el archivo que se subió. Lo decide el SERVIDOR a partir de la
-- extensión del path que él mismo compuso, nunca el cliente.
DO $edu$
BEGIN
  CREATE TYPE "EduStudyKind" AS ENUM ('RADIOGRAFIA', 'TOMOGRAFIA', 'FOTO', 'PDF', 'OTRO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 2. Tablas ──────────────────────────────────────────────────────────

-- LA NOTA CLÍNICA (SOAP) de una sesión.
--
-- Cuelga del CASO —este paciente, con este alumno, en esta especialidad—
-- porque es el registro de un acto clínico y un acto clínico tiene un
-- responsable. Meterlas todas en un "expediente del paciente" es lo que
-- hace que en una escuela nadie sepa de quién era la responsabilidad.
--
-- ⚠️ DOS PERSONAS, DOS COLUMNAS, y no es una duplicación:
--   · "studentId"    → el alumno RESPONSABLE del caso. Sale del caso, no
--     del cuerpo de la petición: es de quién es el acto clínico.
--   · "authorUserId" → QUIÉN TECLEÓ la nota. Sale de la sesión. Cuando el
--     que escribe es el alumno, los dos apuntan a la misma persona; cuando
--     el docente escribe una adenda, no. Sin esta columna habría que
--     atribuirle al alumno una nota que no escribió, que es falsear la
--     autoría de un documento clínico.
CREATE TABLE IF NOT EXISTS "edu_records" (
  "id"             TEXT              NOT NULL,
  "institutionId"  TEXT              NOT NULL,
  "caseId"         TEXT              NOT NULL,
  "patientId"      TEXT              NOT NULL,
  "studentId"      TEXT              NOT NULL,
  -- NOM-004: el autor SIEMPRE identificable. Nunca nulo.
  "authorUserId"   TEXT              NOT NULL,
  -- La sesión que documenta. Opcional en los dos sentidos: hay citas sin
  -- nota (la que se canceló) y notas sin cita (la corrección del día
  -- siguiente).
  "appointmentId"  TEXT,

  -- SOAP. Cuatro campos separados y no un textarea gigante: es el formato
  -- que la escuela enseña, y separarlos permite después leer "qué
  -- diagnosticó" sin leer la nota entera.
  "subjetivo"      VARCHAR(4000),
  "objetivo"       VARCHAR(4000),
  "analisis"       VARCHAR(4000),
  "plan"           VARCHAR(4000),
  "diagnostico"    VARCHAR(500),

  "status"         "EduRecordStatus" NOT NULL DEFAULT 'BORRADOR',
  -- Se DERIVAN del status (no se capturan), igual que "edu_cases"."closedAt":
  -- así no existe una nota "firmada" sin fecha de firma ni una fecha de
  -- firma en una que sigue en borrador.
  "submittedAt"    TIMESTAMP(3),
  "signedAt"       TIMESTAMP(3),
  -- Quién firmó. Puede NO ser el autor: el docente firma lo que el alumno
  -- escribió, y ésa es justo la pregunta que se hace un año después.
  "signedByUserId" TEXT,

  -- La nota a la que ésta CORRIGE. Una firmada no se edita.
  "correctsId"     TEXT,

  "createdAt"      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- @updatedAt lo escribe Prisma en cada UPDATE. El DEFAULT es para que un
  -- INSERT hecho a mano desde el SQL Editor no falle por una columna NOT
  -- NULL sin valor.
  "updatedAt"      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_records_pkey" PRIMARY KEY ("id")
);

-- UN HALLAZGO en UN diente (y opcionalmente en UNA cara).
--
-- El odontograma cuelga del PACIENTE y no del caso: la boca es una sola. El
-- alumno de endodoncia y el de ortodoncia miran el mismo diente 16.
--
-- 🔴 "surface" NO ES NULLABLE — ver la nota 1 de la cabecera. "" = el
-- diente entero.
--
-- "condition" es el id del catálogo compartido de hallazgos (los ~45 de
-- src/components/dashboard/odontogram-v2/data.ts, que el vertical IMPORTA y
-- no copia). El servidor valida contra ese catálogo: sin eso, cualquiera
-- escribe texto libre en el odontograma y el hallazgo se guarda invisible
-- (no hay glifo que dibujar) pero cuenta en los totales. La única key que no
-- está en el catálogo es la RESERVADA '__nota__', que es como se guarda la
-- nota por diente — y el saneo del endpoint rechaza cualquier id que empiece
-- con '__' para que el pincel no pueda pisarla ni borrarla.
CREATE TABLE IF NOT EXISTS "edu_odontogram_entries" (
  "id"            TEXT         NOT NULL,
  "institutionId" TEXT         NOT NULL,
  "patientId"     TEXT         NOT NULL,
  -- Número FDI: 11-18, 21-28, 31-38, 41-48 y los temporales 51-55, 61-65,
  -- 71-75, 81-85. Lo valida la aplicación (src/lib/edu/odontograma-core.ts).
  "tooth"         INTEGER      NOT NULL,
  -- Cara: O/I/M/D/V/L. '' = el diente entero. NUNCA NULL.
  "surface"       VARCHAR(4)   NOT NULL DEFAULT '',
  "condition"     VARCHAR(40)  NOT NULL,
  "notes"         VARCHAR(1000),
  -- Quién lo marcó y cuándo. El odontograma es parte del expediente: "el 16
  -- tiene una corona" sin firma no contesta ninguna pregunta.
  "recordedById"  TEXT         NOT NULL,
  "recordedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_odontogram_entries_pkey" PRIMARY KEY ("id")
);

-- UN ARCHIVO del expediente: radiografía, tomografía, foto o PDF.
--
-- 🔴 "storagePath" es el PATH INTERNO del bucket privado `edu-files`, con el
-- institutionId ADENTRO ("<institutionId>/estudios/<patientId>/<uuid>-<n>").
-- Jamás una URL: una URL firmada caduca en minutos y quedaría muerta en la
-- columna. Se firma on-demand al leer.
--
-- 🔴 "sizeBytes" es BIGINT — ver la nota 2 de la cabecera.
CREATE TABLE IF NOT EXISTS "edu_studies" (
  "id"            TEXT           NOT NULL,
  "institutionId" TEXT           NOT NULL,
  "patientId"     TEXT           NOT NULL,
  -- El caso al que se enganchó, si se enganchó a alguno. Opcional: una
  -- panorámica de tamizaje existe antes que cualquier caso.
  "caseId"        TEXT,
  "kind"          "EduStudyKind" NOT NULL DEFAULT 'OTRO',
  -- El nombre ORIGINAL, tal como lo tenía el archivo. Es lo que se le enseña
  -- a la persona; el path lleva un nombre saneado aparte.
  "name"          VARCHAR(160)   NOT NULL,
  "storagePath"   VARCHAR(400)   NOT NULL,
  "mimeType"      VARCHAR(120)   NOT NULL,
  "sizeBytes"     BIGINT         NOT NULL,
  "notes"         VARCHAR(1000),
  "uploadedById"  TEXT           NOT NULL,
  "createdAt"     TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_studies_pkey" PRIMARY KEY ("id")
);


-- ── 3. Índices ─────────────────────────────────────────────────────────
-- Los nombres son los que le dice el `map:` de Prisma: si algún día se corre
-- `prisma migrate diff` contra esta base, los reconoce y no propone
-- recrearlos.

-- Notas: por caso (la pestaña de expediente filtrada), por paciente (la
-- pestaña completa), por alumno + estado (cuántas lleva sin firmar, que es
-- el reporte de la Ola 4) y por cita (la nota de ESTA sesión).
CREATE INDEX IF NOT EXISTS "edu_records_case_idx"
  ON "edu_records" ("institutionId", "caseId", "createdAt");

CREATE INDEX IF NOT EXISTS "edu_records_patient_idx"
  ON "edu_records" ("institutionId", "patientId", "createdAt");

CREATE INDEX IF NOT EXISTS "edu_records_student_idx"
  ON "edu_records" ("institutionId", "studentId", "status");

CREATE INDEX IF NOT EXISTS "edu_records_appt_idx"
  ON "edu_records" ("institutionId", "appointmentId");

-- 🔴 EL ÍNDICE ÚNICO COMPLETO DEL ODONTOGRAMA. Es el que hace posible el
-- upsert (marcar dos veces refresca quién y cuándo en vez de duplicar) y el
-- que impide que un doble clic meta el mismo hallazgo dos veces. Lleva las
-- CINCO columnas: con cuatro, el mismo hallazgo en dos caras distintas se
-- rebotaría entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_odontogram_hallazgo_key"
  ON "edu_odontogram_entries" ("institutionId", "patientId", "tooth", "surface", "condition");

CREATE INDEX IF NOT EXISTS "edu_odontogram_patient_idx"
  ON "edu_odontogram_entries" ("institutionId", "patientId", "tooth");

-- Un path solo puede estar registrado UNA vez. Es lo que hace idempotente al
-- /confirm de la subida: un reintento del cliente devuelve la fila que ya
-- existe en vez de duplicar el estudio.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_studies_path_key"
  ON "edu_studies" ("institutionId", "storagePath");

CREATE INDEX IF NOT EXISTS "edu_studies_patient_idx"
  ON "edu_studies" ("institutionId", "patientId", "createdAt");

CREATE INDEX IF NOT EXISTS "edu_studies_case_idx"
  ON "edu_studies" ("institutionId", "caseId");


-- ── 4. Llaves foráneas ─────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- envuelta en su bloque.
--
-- ⚠️ CASCADE vs SET NULL, con el mismo criterio de la Ola 2:
--   · CASCADE  → lo que PERTENECE al expediente (el instituto, el caso, el
--     paciente, el alumno, el autor, quien marcó, quien subió). El producto
--     NO borra nada de esto; el CASCADE está para que borrar un instituto
--     entero —operación de administración, no del panel— no se atore.
--   · SET NULL → las referencias "hacia los lados": la cita que documenta la
--     nota, quién la firmó, la nota que corrige y el caso de un estudio.
--     Perder la referencia es aceptable; perder la fila entera, no.
--
-- ⚠️ "edu_records"."correctsId" apunta a la MISMA tabla. Va SET NULL a
-- propósito: con CASCADE, borrar una nota se llevaría en cadena todas sus
-- correcciones — justo lo contrario de lo que pide la NOM.

DO $edu$
BEGIN
  ALTER TABLE "edu_records"
    ADD CONSTRAINT "edu_records_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_records"
    ADD CONSTRAINT "edu_records_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "edu_cases" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_records"
    ADD CONSTRAINT "edu_records_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_records"
    ADD CONSTRAINT "edu_records_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "edu_students" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_records"
    ADD CONSTRAINT "edu_records_authorUserId_fkey"
    FOREIGN KEY ("authorUserId") REFERENCES "edu_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_records"
    ADD CONSTRAINT "edu_records_signedByUserId_fkey"
    FOREIGN KEY ("signedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_records"
    ADD CONSTRAINT "edu_records_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "edu_appointments" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_records"
    ADD CONSTRAINT "edu_records_correctsId_fkey"
    FOREIGN KEY ("correctsId") REFERENCES "edu_records" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_odontogram_entries"
    ADD CONSTRAINT "edu_odontogram_entries_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_odontogram_entries"
    ADD CONSTRAINT "edu_odontogram_entries_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_odontogram_entries"
    ADD CONSTRAINT "edu_odontogram_entries_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "edu_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_studies"
    ADD CONSTRAINT "edu_studies_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_studies"
    ADD CONSTRAINT "edu_studies_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_studies"
    ADD CONSTRAINT "edu_studies_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "edu_cases" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_studies"
    ADD CONSTRAINT "edu_studies_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "edu_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 5. EL BUCKET DE STORAGE — `edu-files`, PRIVADO.
--
-- 🔴 ESTO SÍ HAY QUE CORRERLO: sin el bucket, subir un estudio falla con un
-- "Bucket not found" que desde la pantalla se lee como "no se pudo preparar
-- la subida", y nadie sabe por qué.
--
-- Es un bucket PROPIO del vertical y no el `patient-files` del dental. No es
-- purismo: el dental cobra almacenamiento por clínica contra ESE bucket y
-- mezclar los objetos de las escuelas ahí le rompería la contabilidad.
--
-- ⚠️ file_size_limit: 2 GB (2147483648). Si el proyecto de Supabase tiene un
-- tope global MENOR, este valor no lo sube — el PUT del navegador fallará con
-- 413 y el endpoint /sign no puede detectarlo (los bytes no pasan por el
-- servidor). Revísalo en Settings → Storage antes de anunciarle 2 GB a nadie.
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'edu-files',
  'edu-files',
  false,
  2147483648,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf',
    'application/zip',
    'application/dicom',
    'model/stl', 'model/obj',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = 2147483648,
      allowed_mime_types = ARRAY[
        'image/jpeg', 'image/png', 'image/webp',
        'application/pdf',
        'application/zip',
        'application/dicom',
        'model/stl', 'model/obj',
        'application/octet-stream'
      ];

-- SIN policies para anon/authenticated: storage.objects tiene RLS activo por
-- defecto en Supabase, así que "sin policy" = nadie entra con la anon key
-- (que SÍ se expone al navegador como NEXT_PUBLIC_SUPABASE_ANON_KEY). La app
-- firma, lee y borra con el service role, que bypassa RLS por diseño — mismo
-- criterio que barbería, que el marketplace y que inmuebles.
--
-- Se limpian por si una ejecución anterior las hubiera dejado abiertas.
DROP POLICY IF EXISTS "edu_files_auth_select" ON storage.objects;
DROP POLICY IF EXISTS "edu_files_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "edu_files_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "edu_files_auth_delete" ON storage.objects;
DROP POLICY IF EXISTS "edu_files_public_read" ON storage.objects;


-- ═══════════════════════════════════════════════════════════════════════
-- 6. BACKFILL DEL OVERRIDE DE PERMISOS — LÉELO ANTES DE DAR POR HECHO QUE
--    LA OLA "NO SE APLICÓ".
--
-- 🔴 "permissionsOverride" REEMPLAZA al default del rol, no se suma. Es
-- decir: a quien YA tenga un override guardado, las SEIS keys de esta ola
-- (expediente.view/write, odontograma.view/edit, estudios.view/upload) NO le
-- llegan solas. Entrará a la ficha de un paciente, no verá las pestañas de
-- Expediente, Odontograma ni Estudios, y desde fuera parecerá que la ola no
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
-- Y para dárselas, DESCOMENTA el bloque de abajo.
--
-- ⚠️ HAY UN SOLO BLOQUE, Y **EXCLUYE A CAJA** A PROPÓSITO. No es un olvido:
-- caja recibe, agenda y cobra, y NO abre expediente clínico. Aunque alguien
-- le encendiera estas keys a mano, el ALCANCE (src/lib/edu/visibility.ts)
-- le devolvería cero filas — pero entonces vería tres pestañas vacías y
-- creería que el sistema está roto. Es peor que no verlas.
--
-- -- DIRECCION, DOCENTE y ALUMNO: las seis. Lo que cada uno VE lo recorta
-- -- el alcance, no el permiso.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'expediente.view', 'expediente.write',
--           'odontograma.view', 'odontograma.edit',
--           'estudios.view', 'estudios.upload'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" IN ('DIRECCION', 'DOCENTE', 'ALUMNO')
--   AND cardinality("permissionsOverride") > 0;
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 7. COMPROBACIONES (todo comentado: correlas a mano después del Run)
--
-- 7.a) Las tres tablas existen.
-- SELECT table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('edu_records', 'edu_odontogram_entries', 'edu_studies')
-- ORDER BY table_name;
--
-- 7.b) 🔴 "surface" es NOT NULL y "sizeBytes" es BIGINT. Si alguna de estas
--      dos filas dice otra cosa, PARA: con "surface" nullable el odontograma
--      duplica hallazgos en silencio, y con INTEGER un archivo de 2 GB
--      revienta al escribir después de subirse entero.
-- SELECT table_name, column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND (table_name, column_name) IN (
--     ('edu_odontogram_entries', 'surface'),
--     ('edu_studies', 'sizeBytes')
--   );
-- -- Esperado:
-- --   edu_odontogram_entries | surface   | character varying | NO | ''::character varying
-- --   edu_studies            | sizeBytes | bigint            | NO |
--
-- 7.c) El índice único del odontograma tiene las CINCO columnas.
-- SELECT indexdef FROM pg_indexes
-- WHERE schemaname = 'public' AND indexname = 'edu_odontogram_hallazgo_key';
--
-- 7.d) Las 14 llaves foráneas quedaron puestas.
-- SELECT conrelid::regclass AS tabla, conname
-- FROM pg_constraint
-- WHERE contype = 'f'
--   AND conrelid::regclass::text IN
--       ('edu_records', 'edu_odontogram_entries', 'edu_studies')
-- ORDER BY 1, 2;
--
-- 7.e) El bucket está PRIVADO y con el tope correcto.
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'edu-files';
-- -- Esperado: edu-files | false | 2147483648
--
-- 7.f) NO debe quedar ninguna policy de edu-files en storage.objects.
--      OJO: pg_policies guarda el esquema y la tabla POR SEPARADO. Con
--      tablename = 'storage.objects' esta consulta devolvería SIEMPRE vacío,
--      o sea un "todo bien" falso.
-- SELECT policyname FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname LIKE 'edu_files%';
--
-- 7.g) Ninguna nota FIRMADA sin fecha de firma, ni al revés. Los sellos los
--      DERIVA la aplicación del estado; esta consulta detecta una escritura
--      hecha a mano que se los saltó. Debe devolver 0 filas.
-- SELECT "id", "status", "signedAt", "signedByUserId"
-- FROM "edu_records"
-- WHERE ("status" = 'FIRMADA' AND "signedAt" IS NULL)
--    OR ("status" <> 'FIRMADA' AND "signedAt" IS NOT NULL);
--
-- 7.h) Ningún hallazgo con la cara en NULL (no debería poder existir, pero
--      si alguien altera la columna a mano, aquí se ve). 0 filas.
-- SELECT count(*) FROM "edu_odontogram_entries" WHERE "surface" IS NULL;
--
-- 7.i) Ningún estudio cuyo path se salga de la carpeta de su instituto. Es
--      la comprobación que corresponde a la que el servidor hace en cada
--      /confirm. 0 filas.
-- SELECT "id", "institutionId", "storagePath"
-- FROM "edu_studies"
-- WHERE "storagePath" NOT LIKE "institutionId" || '/estudios/%';
-- ═══════════════════════════════════════════════════════════════════════
