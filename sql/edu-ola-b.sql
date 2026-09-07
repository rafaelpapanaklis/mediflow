-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — OLA B · LOS CIMIENTOS.
--
-- 🔴 UN SOLO ARCHIVO PARA TODA LA OLA B. Cada .sql es un clic de Rafael en
-- Supabase, así que aquí va TODO lo que la ola necesita de base de datos:
-- la tabla nueva de FOTOS CLÍNICAS, el borrado suave de estudios, la baja
-- lógica del odontograma, los campos que le faltan al paciente y el
-- borrado suave de las notas. Las pantallas y la lógica que se apoyan en
-- estas columnas llegan DESPUÉS, en las casillas de la ola.
--
-- Va DESPUÉS de sql/edu-ola-0.sql … sql/edu-ola-3.sql (necesita
-- "edu_institutions", "edu_users", "edu_patients", "edu_cases",
-- "edu_records", "edu_odontogram_entries", "edu_studies" y el bucket
-- `edu-files`). El resto de las olas no importa: nada de aquí las toca.
--
-- Producto SEPARADO del dental, que está VIVO en producción: este archivo
-- NO toca ni una tabla, ni una columna, ni una fila del dental, de
-- barbería ni de inmuebles. En particular NO toca "clinical_photos",
-- "patients" ni "patient_files", que son del dental.
--
-- ⛔ SOLO AÑADE. Cero DROP, cero RENAME, cero ALTER de tipo, cero borrado
-- de datos. Ninguna columna que ya exista cambia de nombre, de tipo ni de
-- nulabilidad. Todo lo nuevo es NULLABLE o trae DEFAULT, así que el código
-- que ya está desplegado sigue compilando y corriendo sin tocarlo.
--
-- IDEMPOTENTE: CREATE TABLE IF NOT EXISTS · ADD COLUMN IF NOT EXISTS ·
-- CREATE INDEX IF NOT EXISTS · los enums y las llaves foráneas envueltos
-- en DO $edu$ … EXCEPTION WHEN duplicate_object. Correrlo dos veces no
-- falla y no cambia nada la segunda vez.
--
-- Contenido:
--   5 enums    · "EduPhotoType", "EduPhotoStage", "EduPregnancy",
--                "EduContactPreference", "EduHabitLevel"
--   1 tabla    · edu_clinical_photos
--   3 índices  · de la tabla nueva (uno de ellos ÚNICO)
--   5 FK       · de la tabla nueva
--   5 columnas · edu_studies (borrado suave + takenAt + annotations)
--   3 columnas · edu_odontogram_entries (baja lógica + firstRecordedAt)
--   2 columnas · edu_records (borrado suave)
--  23 columnas · edu_patients (domicilio, tutor, seguro, CURP, NOM-004,
--                hábitos, embarazo, menor, aviso de privacidad, contacto,
--                y quién tocó la ficha)
--   4 FK       · de las columnas "quién" que se agregan arriba
--   1 backfill · edu_odontogram_entries."firstRecordedAt" (sección 8)
--   1 UPDATE   · storage.buckets: dos MIME más para `edu-files` (HEIC/HEIF)
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run. Es la ÚNICA fuente
-- de verdad del SQL del vertical; las mismas tablas y columnas están en
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
--   · TIMESTAMP(3)   → sellos internos ("createdAt"/"updatedAt").
--   · TIMESTAMPTZ(3) → los INSTANTES que se ordenan y se comparan
--     ("capturedAt", "takenAt", "deletedAt", "firstRecordedAt",
--     "privacyNoticeAcceptedAt"). El antes/después ORDENA por
--     "capturedAt", y la escuela puede estar en cualquier zona del país.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 LAS CINCO DECISIONES DE ESTA OLA, Y DÓNDE ESTÁN ESCRITAS
--
-- 1. LA FOTO CLÍNICA ES SU PROPIA TABLA, NO UN "EduStudy" CON ETAPA.
--    Un estudio sube DIRECTO al bucket (una tomografía pesa cientos de MB
--    y no cabe en el cuerpo de una petición) y por eso no se puede
--    comprimir ni hacerle miniatura. Una foto sí pasa por el servidor: 25
--    MB de tope, se valida por número mágico, se reduce a 2 400 px y se le
--    genera una miniatura de 300 px. Son dos tuberías distintas con dos
--    topes distintos, y meterlas en la misma tabla obligaría a que la
--    galería adivine cuál es cuál. Además la foto necesita VISTA y ETAPA,
--    que a una tomografía no le significan nada.
--
-- 2. LA ETAPA ES TODO EL ANTES/DESPUÉS. El comparador no empareja fotos
--    por ningún algoritmo: ordena por "capturedAt" y propone A = la
--    primera PRE y B = la última POST o CONTROL. Por eso "stage" y
--    "capturedAt" son NOT NULL con default: una foto sin etapa o sin fecha
--    de toma es una foto que el comparador no puede colocar.
--
-- 3. "capturedAt" NO ES "createdAt". El alumno sube el "antes" una semana
--    tarde y el orden saldría al revés. Misma razón por la que
--    edu_studies gana "takenAt" en esta ola.
--
-- 4. NADA SE BORRA: SE DA DE BAJA CON MOTIVO. Las fotos, los estudios, los
--    hallazgos del odontograma y las notas ganan "deletedAt" +
--    "deletedById" (y motivo donde una persona lo teclea). Hoy el
--    odontograma es la ÚNICA pantalla del vertical que hace DELETE de
--    verdad — H-17 del informe ws2-t8 —, y estas columnas son lo que le
--    permite dejar de hacerlo.
--
-- 5. LOS BYTES DE LAS FOTOS CUENTAN PARA LA CUOTA. La cuota del instituto
--    era SUM(edu_studies."sizeBytes"); desde esta ola es esa suma MÁS
--    SUM(edu_clinical_photos."sizeBytes") de las que no están dadas de
--    baja. Por eso "sizeBytes" es NOT NULL aquí: una foto sin tamaño es
--    espacio que la escuela paga y el medidor no ve.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 1. LOS ENUMS
--
-- Los cinco son PROPIOS del vertical. En particular "EduPhotoType" y
-- "EduPhotoStage" NO son los "ClinicalPhotoType"/"ClinicalPhotoStage" del
-- dental: aquellos tienen 40 valores de sus especialidades (endodoncia,
-- periodoncia, implantes) y sus etapas van en minúsculas. Compartir un
-- tipo de Postgres entre dos productos es cómo se llega a que agregar un
-- valor para una escuela mueva el dental.
-- ═══════════════════════════════════════════════════════════════════════

-- LA VISTA de la foto: desde dónde se tomó. 'OTRA' es el default y existe
-- a propósito — obligar a clasificar antes de subir produce datos
-- inventados, y la vista se corrige después desde la galería.
DO $edu$
BEGIN
  CREATE TYPE "EduPhotoType" AS ENUM (
    'FRONTAL', 'SONRISA', 'PERFIL_DER', 'PERFIL_IZQ',
    'OCLUSAL_SUP', 'OCLUSAL_INF',
    'INTRAORAL_FRONTAL', 'INTRAORAL_DER', 'INTRAORAL_IZQ',
    'OTRA'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- LA ETAPA del tratamiento. Es LO ÚNICO que mira el comparador
-- antes/después: A = la primera 'PRE', B = la última 'POST' o 'CONTROL'.
DO $edu$
BEGIN
  CREATE TYPE "EduPhotoStage" AS ENUM ('PRE', 'DURANTE', 'POST', 'CONTROL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- EMBARAZO / LACTANCIA del paciente.
--
-- 🔴 La columna es NULLABLE y el enum tiene 'DESCONOCIDO', y NO es
-- redundante: NULL significa "nadie ha preguntado" y 'DESCONOCIDO'
-- significa "se preguntó y no se sabe". Es la misma distinción que ya hace
-- "historyRecordedAt" con los antecedentes, y confundir esos dos estados
-- es exactamente lo que esta escuela no se puede permitir antes de una
-- radiografía.
DO $edu$
BEGIN
  CREATE TYPE "EduPregnancy" AS ENUM ('NO', 'EMBARAZO', 'LACTANCIA', 'DESCONOCIDO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- Por dónde quiere que le hablen. 'NINGUNO' es una respuesta legítima (no
-- quiere recordatorios) y por eso está en el enum; NULL sigue siendo
-- "nadie se lo preguntó".
DO $edu$
BEGIN
  CREATE TYPE "EduContactPreference" AS ENUM ('WHATSAPP', 'LLAMADA', 'CORREO', 'NINGUNO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- CUÁNTO, para los tres hábitos que le importan a una escuela dental
-- (tabaco, alcohol, bruxismo). UN enum para las tres columnas y no tres
-- enums iguales.
--
-- 🔴 Enum y no texto libre, y ésa es toda la diferencia: el informe ws2-t8
-- (sección e) dice que hoy el embarazo "cabe a mano en padecimientos, y
-- por eso nadie lo puede filtrar ni alertar". Un hábito escrito a mano
-- tiene el mismo problema. El detalle en palabras ("10 cigarros al día")
-- va en "habitsNotes", al lado — igual que el dental pone
-- `habitsDescription` junto a su `habits[]`.
DO $edu$
BEGIN
  CREATE TYPE "EduHabitLevel" AS ENUM ('NO', 'OCASIONAL', 'FRECUENTE', 'DESCONOCIDO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. LA TABLA NUEVA — edu_clinical_photos
--
-- 🔴 "storagePath" y "thumbnailPath" son PATHS INTERNOS del bucket privado
-- `edu-files`, con el institutionId ADENTRO
-- ("<institutionId>/fotos/<patientId>/<uuid>-<nombre>"). Jamás una URL:
-- una URL firmada caduca en una hora y quedaría muerta en la columna. Se
-- firma on-demand al leer, como los estudios.
--
-- 🔴 "sizeBytes" es BIGINT como en edu_studies. El tope por foto son 25 MB
-- —cabrían de sobra en un INTEGER— pero la cuota SUMA las dos tablas, y
-- que las dos columnas tengan el mismo tipo evita un cast en cada consulta
-- del medidor.
--
-- 🔴 "deletedAt"/"deletedById"/"deleteReason" van JUNTAS y se escriben
-- juntas: una foto retirada del expediente sin quién ni por qué no es una
-- baja, es una desaparición.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "edu_clinical_photos" (
  "id"             TEXT              NOT NULL,
  "institutionId"  TEXT              NOT NULL,
  "patientId"      TEXT              NOT NULL,
  -- El caso al que se enganchó, si se enganchó a alguno. Opcional por lo
  -- mismo que en edu_studies: una foto de tamizaje existe antes que
  -- cualquier caso, y la boca es una sola.
  "caseId"         TEXT,
  "uploadedById"   TEXT              NOT NULL,

  -- La VISTA y la ETAPA. Las dos NOT NULL con default: una foto sin etapa
  -- es una foto que el comparador no puede colocar, y una sin vista es una
  -- que la galería no puede agrupar.
  "photoType"      "EduPhotoType"    NOT NULL DEFAULT 'OTRA',
  "stage"          "EduPhotoStage"   NOT NULL DEFAULT 'PRE',

  -- CUÁNDO SE TOMÓ, que no es cuándo se subió. Es la columna por la que
  -- ordena el antes/después.
  "capturedAt"     TIMESTAMPTZ(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "storagePath"    VARCHAR(400)      NOT NULL,
  -- La miniatura de 300 px. NULLABLE porque la compresión es best-effort:
  -- si sharp no puede con el formato (HEIC en algunas plataformas), se
  -- sube el original SIN miniatura y la galería cae a la foto completa.
  -- Rebotar la subida por la miniatura sería perder la foto por la copia.
  "thumbnailPath"  VARCHAR(400),
  "mime"           VARCHAR(120)      NOT NULL,
  "sizeBytes"      BIGINT            NOT NULL,
  -- Alto y ancho del binario ALMACENADO (post-compresión). Opcionales: si
  -- sharp falla no se conocen, y la galería sabe vivir sin ellos.
  "width"          INTEGER,
  "height"         INTEGER,

  "notes"          VARCHAR(1000),
  -- Anotaciones libres sobre la foto ("diente 36, fractura vestibular").
  -- JSONB y no JSON: se consulta y se indexa; JSON guarda el texto crudo.
  "annotations"    JSONB,

  -- La BAJA. No borra la fila ni el rastro: deja constancia con autor y
  -- motivo, igual que la revocación de un consentimiento o la anulación de
  -- una receta.
  "deletedAt"      TIMESTAMPTZ(3),
  "deletedById"    TEXT,
  "deleteReason"   VARCHAR(500),

  "createdAt"      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_clinical_photos_pkey" PRIMARY KEY ("id")
);


-- ═══════════════════════════════════════════════════════════════════════
-- 3. ÍNDICES DE LA TABLA NUEVA
--
-- Los nombres son los que le dice el `map:` de Prisma: si algún día se
-- corre `prisma migrate diff` contra esta base, los reconoce y no propone
-- recrearlos.
-- ═══════════════════════════════════════════════════════════════════════

-- La galería del paciente: "todas las fotos de esta persona".
CREATE INDEX IF NOT EXISTS "edu_clinical_photos_patient_idx"
  ON "edu_clinical_photos" ("institutionId", "patientId");

-- El COMPARADOR y las píldoras de etapa: por paciente, agrupadas por
-- etapa y en orden de toma. Es la consulta que decide qué foto es la A y
-- cuál la B, y sin este índice recorre todas las fotos del paciente para
-- quedarse con dos.
CREATE INDEX IF NOT EXISTS "edu_clinical_photos_etapa_idx"
  ON "edu_clinical_photos" ("patientId", "stage", "capturedAt");

-- Un path solo puede estar registrado UNA vez. La subida pasa por el
-- servidor en un solo viaje (no hay /confirm que reintentar), así que esto
-- no es idempotencia: es el candado de que dos filas no puedan apuntar al
-- mismo objeto y que borrar el binario de una no deje a la otra ciega.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_clinical_photos_path_key"
  ON "edu_clinical_photos" ("institutionId", "storagePath");


-- ═══════════════════════════════════════════════════════════════════════
-- 4. LLAVES FORÁNEAS DE LA TABLA NUEVA
--
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- envuelta en su bloque.
--
-- ⚠️ CASCADE vs SET NULL, y por qué son EXACTAMENTE las de edu_studies:
--   · CASCADE  → lo que no tiene sentido sin su padre (la foto sin su
--     instituto o sin su paciente) y la persona que la subió. El producto
--     NO borra nada de esto —una foto se da de BAJA— así que el CASCADE
--     está para que borrar un instituto entero (operación de
--     administración, no del panel) no se atore en una FK.
--   · SET NULL → el caso (una foto de tamizaje sobrevive al caso que se
--     cerró) y quién dio de baja (perder el enlace es aceptable; perder la
--     constancia de la baja no — por eso el motivo es texto en la fila).
-- ═══════════════════════════════════════════════════════════════════════

DO $edu$
BEGIN
  ALTER TABLE "edu_clinical_photos"
    ADD CONSTRAINT "edu_clinical_photos_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_clinical_photos"
    ADD CONSTRAINT "edu_clinical_photos_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_clinical_photos"
    ADD CONSTRAINT "edu_clinical_photos_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "edu_cases" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_clinical_photos"
    ADD CONSTRAINT "edu_clinical_photos_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "edu_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_clinical_photos"
    ADD CONSTRAINT "edu_clinical_photos_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 5. edu_studies — BORRADO SUAVE, FECHA DE TOMA Y ANOTACIONES
--
-- Hoy NO HAY BORRADO DE ESTUDIOS (fila 15 del informe ws2-t1, H-14 del
-- ws2-t8): una radiografía subida al paciente equivocado se queda ahí para
-- siempre, y `abortEduStudyUpload` se niega explícitamente a sacarla. Con
-- estas tres columnas la casilla de estudios puede retirarla dejando
-- constancia, sin destruir el objeto ni el rastro.
--
-- "takenAt" es la fecha de la TOMA, que no es la de la subida: hoy solo
-- existe "createdAt" y una placa de hace un año subida hoy se ordena como
-- si fuera de hoy. NULL = no se capturó; quien lea ordena por
-- COALESCE("takenAt", "createdAt").
--
-- ⛔ Ninguna columna existente se toca. Las cinco son nuevas y nullables.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "edu_studies"
  ADD COLUMN IF NOT EXISTS "deletedAt"    TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "deletedById"  TEXT,
  ADD COLUMN IF NOT EXISTS "deleteReason" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "takenAt"      TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "annotations"  JSONB;

DO $edu$
BEGIN
  ALTER TABLE "edu_studies"
    ADD CONSTRAINT "edu_studies_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 6. edu_odontogram_entries — LA BAJA LÓGICA (H-17) Y LA PRIMERA VEZ
--
-- 🔴 H-17: el odontograma es la ÚNICA pantalla del vertical que BORRA de
-- verdad. `src/lib/edu/odontograma.ts` hace `deleteMany` del hallazgo y de
-- la nota, y la fila desaparece: el alumno de endodoncia puede pasar la
-- goma sobre lo que marcó el de ortodoncia y el historial de "quién marcó
-- qué" deja de poder contestar que existió. Estas dos columnas son lo que
-- permite cambiar ese DELETE por una baja con autor.
--
-- 🔴 "firstRecordedAt" — CONFIRMADO EN EL CÓDIGO, no supuesto. El upsert
-- de `setEduOdontogramFinding` escribe
-- `update: { recordedById: ctx.eduUserId, recordedAt: now }`: remarcar un
-- hallazgo PISA la marca de tiempo. Es deliberado (si un docente
-- reconfirma lo del alumno, el expediente tiene que decir que lo
-- reconfirmó él) y deja sin respuesta "¿desde cuándo está marcado este
-- diente?", que es la pregunta clínica.
--
-- ⚠️ Hoy "createdAt" contesta eso de rebote, porque el upsert no lo toca.
-- Deja de contestarlo en cuanto exista la baja lógica: con el índice único
-- de cinco columnas intacto, remarcar un hallazgo dado de baja REVIVE la
-- misma fila (deletedAt = NULL) en vez de crear otra, y entonces
-- "createdAt" es la fecha de la fila y "firstRecordedAt" la del primer
-- marcaje clínico. Son dos cosas distintas y a partir de la baja lógica
-- divergen.
--
-- ⛔ El índice único "edu_odontogram_hallazgo_key" NO se toca: dejarlo
-- parcial (WHERE "deletedAt" IS NULL) exigiría DROP INDEX, y aquí no se
-- borra nada. La consecuencia está escrita arriba y la casilla de H-17
-- tiene que revivir la fila, no insertar una segunda.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "edu_odontogram_entries"
  ADD COLUMN IF NOT EXISTS "deletedAt"       TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "deletedById"     TEXT,
  ADD COLUMN IF NOT EXISTS "firstRecordedAt" TIMESTAMPTZ(3);

DO $edu$
BEGIN
  ALTER TABLE "edu_odontogram_entries"
    ADD CONSTRAINT "edu_odontogram_entries_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 7. edu_records — BORRADO SUAVE DE LA NOTA
--
-- H-23 del informe ws2-t8: una nota de expediente se puede dejar
-- completamente vacía y ya no se quita. Con estas dos columnas un BORRADOR
-- vacío se puede retirar dejando rastro.
--
-- 🔴 Y OJO CON EL LÍMITE, porque no es una columna sino la NOM: esto NO
-- abre la puerta a retirar una nota FIRMADA. Una firmada no se edita ni se
-- borra — se corrige con otra nota que la referencia ("correctsId"). Estas
-- columnas son para el borrador que nunca debió existir; el candado del
-- status lo pone la casilla del expediente, no el .sql.
--
-- No lleva "deleteReason" a propósito: retirar un borrador vacío no es un
-- acto clínico que haya que justificar por escrito, y un campo de motivo
-- obligatorio en el sitio equivocado solo produce "asdf".
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "edu_records"
  ADD COLUMN IF NOT EXISTS "deletedAt"   TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "deletedById" TEXT;

DO $edu$
BEGIN
  ALTER TABLE "edu_records"
    ADD CONSTRAINT "edu_records_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 8. edu_patients — LO QUE LE FALTA A LA FICHA
--
-- Las 23 columnas salen del informe ws2-t8 sección (e) ("lo que un
-- dentista necesita y NO existe en el modelo") y del diff del ws2-t1 §6.1.
-- TODAS son nullables o traen default, así que ninguna lectura ni
-- escritura que ya exista cambia de comportamiento.
--
-- ⛔ Ninguna columna existente se toca. En particular NO se toca
-- "searchIndex": que el CURP y el segundo teléfono entren al buscador es
-- una decisión de la casilla de pacientes (src/lib/edu/search.ts), y
-- meterla aquí dejaría el índice a medio escribir hasta que ese código
-- llegara.
--
-- ⚠️ Los datos FISCALES no están aquí y no es un olvido: viven en
-- "edu_patient_tax_profiles" (uno a uno), porque esta fila la leen la
-- agenda, el buscador y la ficha, y un RFC de más viaja a pantallas donde
-- nadie lo pidió.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "edu_patients"
  -- ── Domicilio ────────────────────────────────────────────────────────
  -- Cinco columnas y no un "address" de texto libre como el dental: el
  -- código postal y la ciudad son lo único que una escuela agrupa después
  -- ("¿de dónde vienen nuestros pacientes?"), y de una cadena no se sacan.
  ADD COLUMN IF NOT EXISTS "addressStreet"       VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "addressNeighborhood" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "addressCity"         VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "addressState"        VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "addressZip"          VARCHAR(10),

  -- ── Tutor / representante legal (H-08) ───────────────────────────────
  -- Un menor de edad no tiene hoy tutor en su ficha y nada comprueba la
  -- edad. Tres columnas planas y no una tabla de tutores como el dental
  -- (ped_guardians): en una escuela el que firma es uno y se llama por
  -- teléfono; una tabla aparte es una pantalla más que nadie va a llenar.
  ADD COLUMN IF NOT EXISTS "guardianName"     VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "guardianRelation" VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "guardianPhone"    VARCHAR(30),

  -- ── Seguro / convenio ────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS "insuranceProvider" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "insurancePolicy"   VARCHAR(60),

  -- ── Segundo teléfono ─────────────────────────────────────────────────
  -- "phone" es uno solo: el de recados, el de casa o el del trabajo no
  -- caben, y hoy acaban dentro de "notes" donde ningún recordatorio los ve.
  ADD COLUMN IF NOT EXISTS "phone2" VARCHAR(30),

  -- ── CURP (NOM-024) ───────────────────────────────────────────────────
  -- 18 caracteres exactos. Sin CHECK ni UNIQUE a propósito: un CURP mal
  -- tecleado no puede impedir registrar a un paciente que está en el
  -- sillón, y dos personas pueden compartir un CURP mal capturado hasta
  -- que alguien lo corrija. La validación de formato va en la pantalla.
  ADD COLUMN IF NOT EXISTS "curp" VARCHAR(18),

  -- ── NOM-004: los dos antecedentes que faltaban ───────────────────────
  -- Heredofamiliares (qué hubo en la familia) y personales NO patológicos
  -- (higiene, alimentación, vivienda). Son DISTINTOS de los patológicos
  -- que ya viven en "chronicConditions", y la NOM los pide por separado.
  ADD COLUMN IF NOT EXISTS "familyHistory"                  VARCHAR(2000),
  ADD COLUMN IF NOT EXISTS "personalNonPathologicalHistory" VARCHAR(2000),

  -- ── Hábitos ──────────────────────────────────────────────────────────
  -- Enum y no texto: ver la nota del enum "EduHabitLevel" arriba.
  ADD COLUMN IF NOT EXISTS "habitsTobacco"  "EduHabitLevel",
  ADD COLUMN IF NOT EXISTS "habitsAlcohol"  "EduHabitLevel",
  ADD COLUMN IF NOT EXISTS "habitsBruxism"  "EduHabitLevel",
  -- El detalle en palabras, al lado de los tres niveles. Mismo par que el
  -- dental (`habits[]` + `habitsDescription`).
  ADD COLUMN IF NOT EXISTS "habitsNotes"    VARCHAR(500),

  -- ── Embarazo / lactancia ─────────────────────────────────────────────
  -- NULLABLE con 'DESCONOCIDO' en el enum: ver la nota del enum arriba.
  -- Es la columna que permite ALERTAR antes de una radiografía; hoy eso
  -- vive a mano dentro de "notes" y nadie lo puede filtrar.
  ADD COLUMN IF NOT EXISTS "pregnancy" "EduPregnancy",

  -- ── Menor de edad ────────────────────────────────────────────────────
  -- Decide qué odontograma se pinta (dentición temporal 51-85 vs
  -- permanente 11-48). Mismo campo y mismo default que el dental, para
  -- poderlos comparar un día.
  ADD COLUMN IF NOT EXISTS "isChild" BOOLEAN NOT NULL DEFAULT false,

  -- ── Aviso de privacidad (LFPDPPP) ────────────────────────────────────
  -- CUÁNDO lo aceptó. NULL = no consta. Se guarda la fecha y no un
  -- booleano porque lo que hay que poder contestar es "¿cuándo?", y un
  -- `true` sin fecha no es constancia de nada.
  ADD COLUMN IF NOT EXISTS "privacyNoticeAcceptedAt" TIMESTAMPTZ(3),

  -- ── Preferencia de contacto ──────────────────────────────────────────
  -- NULL = nadie se lo preguntó. 'NINGUNO' = dijo que no quiere que le
  -- escriban, que es una respuesta y hay que respetarla.
  ADD COLUMN IF NOT EXISTS "contactPreference" "EduContactPreference",

  -- ── Quién tocó la ficha por última vez (H-12b) ───────────────────────
  -- "updatedAt" ya existe y dice CUÁNDO; esto dice QUIÉN. Hoy nadie sabe
  -- quién corrigió un teléfono.
  ADD COLUMN IF NOT EXISTS "updatedById" TEXT;

DO $edu$
BEGIN
  ALTER TABLE "edu_patients"
    ADD CONSTRAINT "edu_patients_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 9. BACKFILL DE "firstRecordedAt" — la única escritura de datos del archivo
--
-- Rellena la columna NUEVA con "createdAt" de la MISMA fila, que hoy es la
-- mejor respuesta que existe a "¿cuándo se marcó esto por primera vez?"
-- (el upsert no toca "createdAt", solo "recordedAt"). Sin esto, cada
-- hallazgo que ya está en la base nace con la columna en NULL y la
-- pantalla de H-17 tendría que pedir OTRO clic en Supabase.
--
-- IDEMPOTENTE por el WHERE: la segunda ejecución no encuentra ni una fila.
-- No pisa nada: escribe SOLO donde la columna está vacía, y la columna
-- acaba de nacer. Ninguna columna existente se lee para otra cosa que
-- copiarla, y ninguna se modifica.
-- ═══════════════════════════════════════════════════════════════════════

UPDATE "edu_odontogram_entries"
   SET "firstRecordedAt" = "createdAt"
 WHERE "firstRecordedAt" IS NULL;


-- ═══════════════════════════════════════════════════════════════════════
-- 10. EL BUCKET — DOS MIME MÁS PARA `edu-files`
--
-- 🔴 SIN ESTO, UNA FOTO DE iPHONE PUEDE REBOTAR. `edu-files` se creó en
-- sql/edu-ola-3.sql con una lista blanca de `allowed_mime_types` que NO
-- incluye HEIC/HEIF. La subida de fotos comprime con sharp a JPEG, así que
-- lo normal es que lo que llegue al bucket sea 'image/jpeg' + la miniatura
-- 'image/webp' (los dos ya permitidos). Pero la compresión es best-effort:
-- si la compilación de libvips de este entorno no trae libheif, sharp
-- falla y se sube el ORIGINAL con su MIME real — y ahí Storage lo rechaza.
--
-- ADITIVO Y NO DESTRUCTIVO: agrega los dos valores a la lista que ya
-- hubiera, sin reemplazarla. Es el mismo idioma que el backfill de
-- permisos de la Ola 14 (ARRAY(SELECT DISTINCT unnest(...))). Idempotente
-- por el WHERE: si ya están, no hace nada. Si "allowed_mime_types" es NULL
-- el bucket ya acepta todo y tampoco hace falta tocarlo.
--
-- ⚠️ Ojo, de paso y NO se arregla aquí: 'model/ply' tampoco está en esa
-- lista aunque la Ola 12 aceptó .ply. Es del vertical pero de otra
-- casilla; queda anotado en el reporte y no se toca sin que alguien lo
-- decida.
-- ═══════════════════════════════════════════════════════════════════════

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY(
         SELECT DISTINCT unnest(
           allowed_mime_types || ARRAY['image/heic', 'image/heif']::TEXT[]
         )
       )
 WHERE id = 'edu-files'
   AND allowed_mime_types IS NOT NULL
   AND NOT (allowed_mime_types @> ARRAY['image/heic', 'image/heif']::TEXT[]);


-- ═══════════════════════════════════════════════════════════════════════
-- 11. COMPROBACIONES (todo comentado; correr a mano si hace falta)
--
-- ── 11.a) La tabla nueva existe con sus 21 columnas ───────────────────
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'edu_clinical_photos'
-- ORDER BY ordinal_position;
--
-- ── 11.b) Los cinco enums existen con sus valores ─────────────────────
-- SELECT t.typname, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder)
-- FROM pg_type t
-- JOIN pg_enum e ON e.enumtypid = t.oid
-- WHERE t.typname IN ('EduPhotoType', 'EduPhotoStage', 'EduPregnancy',
--                     'EduContactPreference', 'EduHabitLevel')
-- GROUP BY t.typname;
--
-- ── 11.c) Las columnas nuevas de las cuatro tablas ────────────────────
-- Tienen que salir 33 filas (5 estudios + 3 odontograma +
-- 2 notas + 23 pacientes).
--
-- SELECT table_name, column_name, is_nullable
-- FROM information_schema.columns
-- WHERE (table_name, column_name) IN (
--   ('edu_studies','deletedAt'), ('edu_studies','deletedById'),
--   ('edu_studies','deleteReason'), ('edu_studies','takenAt'),
--   ('edu_studies','annotations'),
--   ('edu_odontogram_entries','deletedAt'),
--   ('edu_odontogram_entries','deletedById'),
--   ('edu_odontogram_entries','firstRecordedAt'),
--   ('edu_records','deletedAt'), ('edu_records','deletedById'),
--   ('edu_patients','addressStreet'), ('edu_patients','addressNeighborhood'),
--   ('edu_patients','addressCity'), ('edu_patients','addressState'),
--   ('edu_patients','addressZip'), ('edu_patients','guardianName'),
--   ('edu_patients','guardianRelation'), ('edu_patients','guardianPhone'),
--   ('edu_patients','insuranceProvider'), ('edu_patients','insurancePolicy'),
--   ('edu_patients','phone2'), ('edu_patients','curp'),
--   ('edu_patients','familyHistory'),
--   ('edu_patients','personalNonPathologicalHistory'),
--   ('edu_patients','habitsTobacco'), ('edu_patients','habitsAlcohol'),
--   ('edu_patients','habitsBruxism'), ('edu_patients','habitsNotes'),
--   ('edu_patients','pregnancy'), ('edu_patients','isChild'),
--   ('edu_patients','privacyNoticeAcceptedAt'),
--   ('edu_patients','contactPreference'), ('edu_patients','updatedById')
-- )
-- ORDER BY table_name, column_name;
--
-- ── 11.d) NINGUNA columna nueva quedó NOT NULL sin default ────────────
-- Es LA comprobación que protege al código ya desplegado. Cero filas.
--
-- SELECT table_name, column_name
-- FROM information_schema.columns
-- WHERE table_name IN ('edu_studies','edu_odontogram_entries',
--                      'edu_records','edu_patients')
--   AND column_name IN ('deletedAt','deletedById','deleteReason','takenAt',
--                       'annotations','firstRecordedAt','isChild','curp',
--                       'pregnancy','contactPreference','updatedById')
--   AND is_nullable = 'NO'
--   AND column_default IS NULL;
--
-- ── 11.e) El backfill del odontograma quedó completo ──────────────────
-- Cero filas.
-- SELECT count(*) FROM "edu_odontogram_entries" WHERE "firstRecordedAt" IS NULL;
--
-- ── 11.f) El bucket acepta HEIC/HEIF y sigue PRIVADO ──────────────────
-- SELECT id, public, file_size_limit, allowed_mime_types
-- FROM storage.buckets WHERE id = 'edu-files';
--
-- ── 11.g) Ninguna foto sin su instituto, ni fuera de su carpeta ───────
-- El path lo compone SIEMPRE el servidor y lleva el institutionId
-- adelante. Cero filas: una que salga es una fila escrita a mano.
--
-- SELECT "id", "storagePath" FROM "edu_clinical_photos"
-- WHERE "storagePath" NOT LIKE "institutionId" || '/fotos/' || "patientId" || '/%';
--
-- ── 11.h) Ninguna baja a medias ───────────────────────────────────────
-- Cero filas: dar de baja escribe fecha, autor y motivo JUNTOS.
--
-- SELECT "id" FROM "edu_clinical_photos"
-- WHERE "deletedAt" IS NOT NULL
--   AND ("deletedById" IS NULL OR "deleteReason" IS NULL);
--
-- ── 11.i) Lo que la cuota va a contar a partir de ahora ───────────────
-- SELECT i."name",
--        COALESCE(SUM(s."sizeBytes"), 0) AS bytes_estudios,
--        COALESCE((SELECT SUM(p."sizeBytes") FROM "edu_clinical_photos" p
--                   WHERE p."institutionId" = i."id"
--                     AND p."deletedAt" IS NULL), 0) AS bytes_fotos
-- FROM "edu_institutions" i
-- LEFT JOIN "edu_studies" s ON s."institutionId" = i."id"
-- GROUP BY i."id", i."name"
-- ORDER BY i."name";
-- ═══════════════════════════════════════════════════════════════════════
