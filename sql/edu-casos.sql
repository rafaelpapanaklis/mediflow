-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola de CASOS · ANTECEDENTES MÉDICOS.
--
-- Va DESPUÉS de sql/edu-ola-0.sql (edu_users) y sql/edu-ola-2.sql
-- (edu_patients). No depende de ningún enum ni de las olas posteriores.
-- Producto SEPARADO del dental, que está VIVO en producción: este archivo
-- NO toca ni una tabla, ni una columna, ni una fila del dental, de
-- barbería ni de inmuebles. En particular NO toca "patients", que es la
-- tabla del dental donde estos mismos campos ya existen.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   9 columnas · en "edu_patients" (antecedentes médicos + quién/cuándo)
--   1 llave foránea · "historyRecordedById" → edu_users (SET NULL)
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run. Es la ÚNICA fuente
-- de verdad del SQL del vertical; las mismas columnas están en
-- prisma/schema.prisma, así que un `prisma db push` no se las lleva.
--
-- 🔴 APLICARLO ANTES DEL DEPLOY (o junto con él): el cliente Prisma nuevo
-- pide estas columnas en CUALQUIER SELECT de edu_patients — sin ellas,
-- toda lectura de pacientes del vertical revienta con "column does not
-- exist" (mismo trato que la searchIndex de la Ola 1B).
--
-- Nota sobre $$: delimitador con nombre, $edu$, y NUNCA bloques DO
-- anidados — el parser SQL de Supabase rompe con $$ anidado.
--
-- Nota sobre los nombres: las columnas van en camelCase ENTRECOMILLADO
-- porque así las escribe Prisma; sin comillas Postgres las bajaría a
-- minúsculas y el cliente dejaría de encontrarlas.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 LA DECISIÓN DE ESTA OLA, Y DÓNDE ESTÁ ESCRITA
--
-- ARREGLO VACÍO ≠ "SIN ALERGIAS". Las tres listas nacen '{}' en TODAS las
-- filas existentes, y eso NO significa que a esos pacientes se les haya
-- preguntado: significa que NADIE los ha revisado. Lo que separa "sin
-- antecedentes registrados" de "se le preguntó y no refiere" es
-- "historyRecordedAt": NULL = nadie los capturó (la ficha lo AVISA en
-- ámbar), con fecha = alguien los revisó y quedó quién
-- ("historyRecordedById" + el nombre en la ficha). Por eso este archivo
-- NO trae backfill: poner una fecha de revisión a mil filas que nadie
-- revisó sería fabricar la constancia que este campo existe para dar.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Las columnas de antecedentes ────────────────────────────────────

-- Mismos campos y tipos que el "Patient" del dental (allergies,
-- chronicConditions, currentMedications, bloodType, emergencyContact*)
-- a propósito, para poderlos comparar un día — pero en SU tabla.
ALTER TABLE "edu_patients"
  ADD COLUMN IF NOT EXISTS "bloodType" TEXT;

ALTER TABLE "edu_patients"
  ADD COLUMN IF NOT EXISTS "allergies" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "edu_patients"
  ADD COLUMN IF NOT EXISTS "chronicConditions" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "edu_patients"
  ADD COLUMN IF NOT EXISTS "currentMedications" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "edu_patients"
  ADD COLUMN IF NOT EXISTS "emergencyContactName" TEXT;

ALTER TABLE "edu_patients"
  ADD COLUMN IF NOT EXISTS "emergencyContactPhone" TEXT;

ALTER TABLE "edu_patients"
  ADD COLUMN IF NOT EXISTS "emergencyContactRelation" TEXT;

-- Cuándo se capturaron/revisaron por última vez y quién. Se escriben
-- JUNTOS en cada guardado de antecedentes; nunca por separado.
ALTER TABLE "edu_patients"
  ADD COLUMN IF NOT EXISTS "historyRecordedAt" TIMESTAMP(3);

ALTER TABLE "edu_patients"
  ADD COLUMN IF NOT EXISTS "historyRecordedById" TEXT;


-- ── 2. La llave foránea ────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que va envuelta
-- en su bloque. SET NULL y no CASCADE: perder el NOMBRE de quien capturó
-- es aceptable si esa persona se da de baja; perder los ANTECEDENTES del
-- paciente no lo es.

DO $edu$
BEGIN
  ALTER TABLE "edu_patients"
    ADD CONSTRAINT "edu_patients_historyRecordedById_fkey"
    FOREIGN KEY ("historyRecordedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 3. Comprobación ────────────────────────────────────────────────────
-- Después de correr el archivo, esto tiene que devolver 9:
--
-- SELECT COUNT(*) FROM information_schema.columns
--  WHERE table_name = 'edu_patients'
--    AND column_name IN (
--      'bloodType', 'allergies', 'chronicConditions', 'currentMedications',
--      'emergencyContactName', 'emergencyContactPhone',
--      'emergencyContactRelation', 'historyRecordedAt', 'historyRecordedById'
--    );
--
-- Y esto tiene que devolver 1 (la llave foránea):
--
-- SELECT COUNT(*) FROM information_schema.table_constraints
--  WHERE table_name = 'edu_patients'
--    AND constraint_name = 'edu_patients_historyRecordedById_fkey';
