-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola 14 · RECETAS.
--
-- Va DESPUÉS de sql/edu-ola-0.sql, sql/edu-ola-1.sql, sql/edu-ola-2.sql y
-- SOBRE TODO de sql/edu-ola-4.sql: el ALTER TYPE de abajo agrega un valor
-- al enum "EduApprovalStage", que crea la Ola 4 — sin ella este archivo
-- truena en la primera sentencia. Producto SEPARADO del dental, que está
-- VIVO en producción: este archivo NO toca ni una tabla, ni una columna,
-- ni una fila del dental, de barbería ni de inmuebles. En particular NO
-- toca "prescriptions", "prescription_items" ni "cums_items", que son del
-- dental.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   1 valor nuevo de enum · 'PRESCRIPTION' en "EduApprovalStage"
--   1 enum    · "EduPrescriptionStatus"
--   1 columna · edu_users."cedulaProfesional"
--   2 tablas  · edu_prescriptions, edu_prescription_items
--   4 índices · de consulta
--   8 llaves foráneas
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
-- Nota sobre el ALTER TYPE: desde Postgres 12 un ADD VALUE puede correr
-- dentro de la transacción implícita del editor, con UNA condición que
-- este archivo respeta — el valor nuevo NO se usa en ninguna sentencia
-- posterior del mismo script (las tablas nuevas usan el OTRO enum).
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 LAS CUATRO DECISIONES DE ESTA OLA, Y DÓNDE ESTÁN ESCRITAS
--
-- 1. UN ALUMNO NO TIENE CÉDULA PROFESIONAL, así que la receta NO la
--    expide él: la PROPONE (queda 'PENDIENTE', y una pendiente no se
--    imprime, no se manda y no se descarga) y el DOCENTE con cédula la
--    firma — ahí pasa a 'EXPEDIDA' con los DOS nombres y la cédula
--    congelados en la fila. El candado del papel no está en un botón
--    escondido: está en src/lib/edu/recetas.ts (getEduRecetaPdfData),
--    que solo entrega el PDF EXPEDIDA o ANULADA.
--
-- 2. LA AUTORIZACIÓN ES LA DE LA OLA 4, no un mecanismo nuevo. Mandar la
--    receta crea una fila de "edu_case_approvals" con la etapa
--    'PRESCRIPTION' apuntándole (targetType 'EduPrescription'), con su
--    contentHash; la decisión del docente mueve la receta EN LA MISMA
--    TRANSACCIÓN (autorizar → EXPEDIDA · pedir cambios → BORRADOR ·
--    rechazar → RECHAZADA). El índice único parcial de la Ola 4 (una
--    PENDING por fila apuntada) la cubre sin cambios.
--
-- 3. UNA EXPEDIDA NO SE EDITA NI SE BORRA JAMÁS: se ANULA con motivo
--    (voidReason, voidedBy*, voidedAt) y se hace otra. La fila queda y su
--    PDF sigue saliendo marcado "ANULADA" — el papel ya salió una vez con
--    una cédula encima y la constancia de retirarlo vale tanto como él.
--
-- 4. LA CÉDULA VIVE EN DOS SITIOS Y NO ES REDUNDANCIA:
--    edu_users."cedulaProfesional" es la del docente HOY (se captura al
--    expedir la primera receta y se corrige ahí mismo);
--    edu_prescriptions."issuedByCedula" es la que salió IMPRESA en cada
--    documento, congelada. Corregir la primera no reescribe la segunda.
--
-- 🔴 NOTA SOBRE LOS TIPOS DE FECHA — no es un descuido que convivan dos:
--   · TIMESTAMP(3)   → sellos internos ("createdAt"/"updatedAt").
--   · TIMESTAMPTZ(3) → los INSTANTES que se ordenan y se comparan
--     ("issuedAt", "voidedAt"). Una receta se ordena por cuándo se
--     expidió, y la escuela puede estar en cualquier zona del país.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. El valor nuevo del enum de la Ola 4 ─────────────────────────────

-- La etapa RECETA de las autorizaciones. No abre ninguna puerta del caso
-- (eso siguen siendo PLAN y DISCHARGE): lo que abre es la propia receta.
ALTER TYPE "EduApprovalStage" ADD VALUE IF NOT EXISTS 'PRESCRIPTION';


-- ── 2. El enum del estado de la receta ─────────────────────────────────

-- 🔴 'EXPEDIDA' congela el contenido para siempre; 'ANULADA' es la única
-- salida de una expedida. 'PENDIENTE' y 'RECHAZADA' no producen papel.
DO $edu$
BEGIN
  CREATE TYPE "EduPrescriptionStatus" AS ENUM (
    'BORRADOR', 'PENDIENTE', 'EXPEDIDA', 'RECHAZADA', 'ANULADA'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 3. La cédula del docente ───────────────────────────────────────────

-- Opcional: un ALUMNO no tiene — ésa es exactamente la razón de que la
-- receta pase por el gate. Se captura al expedir la primera receta.
ALTER TABLE "edu_users"
  ADD COLUMN IF NOT EXISTS "cedulaProfesional" VARCHAR(30);


-- ── 4. Tablas ──────────────────────────────────────────────────────────

-- LA RECETA. Propuesta por el alumno, expedida por el docente.
--
-- 🔴 Todas las personas van con el NOMBRE CONGELADO al lado de un id
-- opcional (SET NULL): un documento expedido tiene que seguir diciendo
-- quién lo propuso y quién respondió aunque esa persona se dé de baja.
CREATE TABLE IF NOT EXISTS "edu_prescriptions" (
  "id"                  TEXT                    NOT NULL,
  "institutionId"       TEXT                    NOT NULL,
  "caseId"              TEXT                    NOT NULL,
  -- Se guarda ADEMÁS del caso para listar "las recetas de este paciente"
  -- sin un JOIN — mismo criterio que edu_invoices."patientId".
  "patientId"           TEXT                    NOT NULL,
  "status"              "EduPrescriptionStatus" NOT NULL DEFAULT 'BORRADOR',

  -- Qué dice el papel: diagnóstico e indicaciones generales. Las de cada
  -- medicamento van en su renglón.
  "diagnosis"           TEXT,
  "indications"         TEXT,

  -- Quién la PROPUSO (el alumno), congelado.
  "proposedByUserId"    TEXT,
  "proposedByName"      VARCHAR(160)            NOT NULL,
  "proposedByMatricula" VARCHAR(30),

  -- Quién la EXPIDIÓ (el docente), su cédula y la evidencia de la firma
  -- — como en los consentimientos: hash del texto canónico, cuándo, IP y
  -- navegador. Se escriben TODOS juntos al firmar la autorización.
  "issuedByUserId"      TEXT,
  "issuedByName"        VARCHAR(160),
  "issuedByCedula"      VARCHAR(30),
  "issuedAt"            TIMESTAMPTZ(3),
  "issuedHash"          VARCHAR(64),
  "issuedIp"            VARCHAR(60),
  "issuedUserAgent"     VARCHAR(300),

  -- La anulación. NO borra nada: deja constancia con motivo.
  "voidedAt"            TIMESTAMPTZ(3),
  "voidedByUserId"      TEXT,
  "voidedByName"        VARCHAR(160),
  "voidReason"          VARCHAR(500),

  "createdAt"           TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_prescriptions_pkey" PRIMARY KEY ("id")
);

-- UN RENGLÓN de la receta: un medicamento con su posología completa.
--
-- ⚠️ Texto LIBRE a propósito, sin FK a un catálogo: el CUMS es una tabla
-- del dental con su propio ciclo de carga, y encadenar la escuela a él
-- acoplaría los dos productos por la columna más delicada. Lo que el
-- alumno escribe es lo que el docente LEE y firma — el gate es la
-- validación.
CREATE TABLE IF NOT EXISTS "edu_prescription_items" (
  "id"             TEXT         NOT NULL,
  "institutionId"  TEXT         NOT NULL,
  "prescriptionId" TEXT         NOT NULL,
  -- Posición en el documento. El orden ES contenido (entra al hash).
  "orden"          INTEGER      NOT NULL DEFAULT 0,
  "drug"           VARCHAR(200) NOT NULL,
  "presentation"   VARCHAR(160),
  "dose"           VARCHAR(120) NOT NULL,
  "route"          VARCHAR(80),
  "frequency"      VARCHAR(120),
  "duration"       VARCHAR(120),
  "quantity"       VARCHAR(60),
  "notes"          VARCHAR(500),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_prescription_items_pkey" PRIMARY KEY ("id")
);


-- ── 5. Índices ─────────────────────────────────────────────────────────
-- Los nombres son los que le dice el `map:` de Prisma: si algún día se
-- corre `prisma migrate diff` contra esta base, los reconoce y no propone
-- recrearlos.

-- La pestaña Recetas de la ficha: por paciente, más recientes primero.
CREATE INDEX IF NOT EXISTS "edu_prescriptions_patient_idx"
  ON "edu_prescriptions" ("institutionId", "patientId", "createdAt");

-- La lista del caso, y el loadTargets del gate al pintar la bandeja.
CREATE INDEX IF NOT EXISTS "edu_prescriptions_case_idx"
  ON "edu_prescriptions" ("institutionId", "caseId");

-- "¿Cuántas siguen pendientes?" — la pregunta de dirección.
CREATE INDEX IF NOT EXISTS "edu_prescriptions_status_idx"
  ON "edu_prescriptions" ("institutionId", "status");

-- De la receta a sus renglones.
CREATE INDEX IF NOT EXISTS "edu_prescription_items_receta_idx"
  ON "edu_prescription_items" ("institutionId", "prescriptionId");


-- ── 6. Llaves foráneas ─────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- envuelta en su bloque.
--
-- ⚠️ CASCADE vs SET NULL, y por qué no son todas iguales:
--   · CASCADE  → lo que no tiene sentido sin su padre (la receta sin su
--     instituto, su caso o su paciente; el renglón sin su receta). El
--     producto NO borra nada de esto — una receta se ANULA — así que el
--     CASCADE está para que borrar un instituto entero (operación de
--     administración, no del panel) no se atore en una FK.
--   · SET NULL → las personas: quién propuso, quién expidió, quién
--     anuló. Sus NOMBRES quedan congelados en la fila; perder el enlace
--     es aceptable, perder el documento no.

DO $edu$
BEGIN
  ALTER TABLE "edu_prescriptions"
    ADD CONSTRAINT "edu_prescriptions_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_prescriptions"
    ADD CONSTRAINT "edu_prescriptions_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "edu_cases" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_prescriptions"
    ADD CONSTRAINT "edu_prescriptions_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_prescriptions"
    ADD CONSTRAINT "edu_prescriptions_proposedByUserId_fkey"
    FOREIGN KEY ("proposedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_prescriptions"
    ADD CONSTRAINT "edu_prescriptions_issuedByUserId_fkey"
    FOREIGN KEY ("issuedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_prescriptions"
    ADD CONSTRAINT "edu_prescriptions_voidedByUserId_fkey"
    FOREIGN KEY ("voidedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_prescription_items"
    ADD CONSTRAINT "edu_prescription_items_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_prescription_items"
    ADD CONSTRAINT "edu_prescription_items_prescriptionId_fkey"
    FOREIGN KEY ("prescriptionId") REFERENCES "edu_prescriptions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 7. 🔴 BACKFILL DE PERMISOS — LÉELO ANTES DE DAR POR APLICADA LA OLA
--
-- Las cuatro keys nuevas son:
--   recetas.view · recetas.propose · recetas.issue · recetas.void
--
-- El override REEMPLAZA al default del rol, NO se suma. Consecuencia: a
-- quien ya tenga un "permissionsOverride" con keys guardadas, estas
-- cuatro NO le llegan solas. No verá la pestaña Recetas y desde fuera
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
-- Una receta es un documento clínico, no un cobro — es la misma línea que
-- le cierra el expediente, y aquí ni siquiera hay "view".
--
-- 🔴 Y OJO CON EL DE ALUMNO: lleva "view" y "propose", y NO lleva "issue"
-- ni "void". Copiarle el bloque del docente le dejaría EXPEDIRSE sus
-- propias recetas — sin cédula profesional — que es exactamente lo que
-- esta ola existe para que no pase.
--
-- -- DIRECCION: las cuatro. Propone (para desatorar un caso sin alumno),
-- -- expide con su cédula y anula.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'recetas.view', 'recetas.propose',
--           'recetas.issue', 'recetas.void'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'DIRECCION'
--   AND cardinality("permissionsOverride") > 0;
--
-- -- DOCENTE: las cuatro. La cédula es suya.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'recetas.view', 'recetas.propose',
--           'recetas.issue', 'recetas.void'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'DOCENTE'
--   AND cardinality("permissionsOverride") > 0;
--
-- -- ALUMNO: ve y propone. NO expide y NO anula.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'recetas.view', 'recetas.propose'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'ALUMNO'
--   AND cardinality("permissionsOverride") > 0;
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 8. COMPROBACIONES (todo comentado; correr a mano si hace falta)
--
-- ── El gate del papel (lo que de verdad importa) ───────────────────────
-- Tiene que devolver CERO filas SIEMPRE: una EXPEDIDA sin firmante, sin
-- cédula o sin hora de expedición es una fila tocada por SQL a mano — el
-- producto las escribe juntas en una transacción, y el PDF se niega a
-- salir sin ellas.
--
-- SELECT "id", "status", "issuedByName", "issuedByCedula", "issuedAt"
-- FROM "edu_prescriptions"
-- WHERE "status" = 'EXPEDIDA'
--   AND ("issuedByUserId" IS NULL OR "issuedByCedula" IS NULL
--        OR "issuedAt" IS NULL OR "issuedHash" IS NULL);
--
-- ── Receta ↔ autorización ─────────────────────────────────────────────
-- Cada PENDIENTE debe tener exactamente UNA autorización PENDING de la
-- etapa RECETA apuntándole. Cero filas = todo cuadra.
--
-- SELECT p."id", p."status", count(a."id") AS pendientes
-- FROM "edu_prescriptions" p
-- LEFT JOIN "edu_case_approvals" a
--   ON a."targetType" = 'EduPrescription'
--  AND a."targetId" = p."id"
--  AND a."status" = 'PENDING'
-- WHERE p."status" = 'PENDIENTE'
-- GROUP BY p."id", p."status"
-- HAVING count(a."id") <> 1;
--
-- ── Anuladas con su constancia completa ───────────────────────────────
-- Cero filas: anular escribe motivo, autor y hora juntos.
--
-- SELECT "id" FROM "edu_prescriptions"
-- WHERE "status" = 'ANULADA'
--   AND ("voidReason" IS NULL OR "voidedAt" IS NULL);
-- ═══════════════════════════════════════════════════════════════════════
