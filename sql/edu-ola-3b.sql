-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola 3B · IA DE APOYO Y CONSENTIMIENTOS.
--
-- Va DESPUÉS de sql/edu-ola-0.sql, sql/edu-ola-1.sql, sql/edu-ola-2.sql y
-- sql/edu-ola-3.sql (necesita "edu_institutions", "edu_patients",
-- "edu_cases" y "edu_studies"). Producto SEPARADO del dental, que está
-- VIVO en producción: este archivo NO toca ni una tabla, ni una columna,
-- ni una fila del dental, de barbería ni de inmuebles.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   0 enums    · esta ola no agrega ninguno (el estado del consentimiento
--                se DERIVA en la aplicación, ver más abajo)
--   2 tablas   · edu_study_analyses, edu_consents
--   6 índices  · 1 único (el token) + 4 de consulta + las 2 PK inline
--   5 llaves foráneas
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run. Es la ÚNICA fuente
-- de verdad del SQL del vertical; las mismas tablas están en
-- prisma/schema.prisma, así que un `prisma db push` no se las lleva.
--
-- ⚠️ NO hace falta crear ningún bucket: las firmas van al bucket privado
-- `edu-files` que ya creó sql/edu-ola-3.sql, en la carpeta
-- "<institutionId>/consentimientos/<consentId>/<hueco>.png".
--
-- Nota sobre $$: delimitador con nombre, $edu$, y NUNCA bloques DO
-- anidados — el parser SQL de Supabase rompe con $$ anidado.
--
-- Nota sobre los nombres: las columnas van en camelCase ENTRECOMILLADO
-- porque así las escribe Prisma; sin comillas Postgres las bajaría a
-- minúsculas y el cliente dejaría de encontrarlas.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 POR QUÉ NO HAY COLUMNA "status" EN "edu_consents"
--
-- El estado (pendiente / firmado / revocado / vencido) se DERIVA de
-- ("signedAt", "revokedAt", "expiresAt", ahora) en la aplicación
-- (src/lib/edu/consentimientos-core.ts). "Vencido" depende de la HORA: una
-- columna guardada estaría mintiendo desde el segundo siguiente a
-- escribirla, y habría que barrer la tabla con un cron para mantenerla al
-- día. Es la misma regla que "EduCase.closedAt" y que los sellos de la
-- nota clínica: lo que se deduce no se captura.
--
-- ⚠️ Si algún día hace falta filtrar por estado en SQL, se hace con el
-- predicado, no con una columna nueva:
--   pendientes → "revokedAt" IS NULL AND "signedAt" IS NULL AND "expiresAt" > now()
--   firmados   → "revokedAt" IS NULL AND "signedAt" IS NOT NULL
--   revocados  → "revokedAt" IS NOT NULL
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 POR QUÉ LOS NOMBRES DE LAS PERSONAS ESTÁN DUPLICADOS EN LA FILA
--
-- "studentName", "supervisorName", "createdByName", "revokedByName" y
-- "supervisorSignedByName" son TEXTO CONGELADO al lado de un id opcional.
-- No es desnormalización por descuido: un documento firmado tiene que
-- seguir diciendo QUIÉN lo firmó aunque esa persona se dé de baja, cambie
-- de apellido o se vaya a otro instituto. Con solo la llave foránea, una
-- baja borraría del documento al responsable del acto. Es la misma
-- decisión que "edu_charges"."feeScheduleLabel" de la Ola 5, y la misma
-- que el dental tomó en "consent_forms" (ahí, sin ni siquiera guardar el
-- id).
--
-- Consecuencia buscada: los ids van con ON DELETE SET NULL, no CASCADE.
-- Borrar a una persona NO puede llevarse por delante el consentimiento
-- firmado de un paciente.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Tablas ──────────────────────────────────────────────────────────

-- EL ANÁLISIS DE IA DE UNA IMAGEN DEL EXPEDIENTE.
--
-- 🔴 ES APOYO, NO DIAGNÓSTICO, y la tabla está hecha para que eso no se
-- pueda diluir: NO tiene ninguna relación con "edu_records". El resultado
-- no se escribe dentro de una nota clínica por ningún camino del producto;
-- vive aquí, aparte, con el nombre de quien lo pidió encima.
--
-- ⚠️ SE GUARDA LA HISTORIA, y aquí es donde se aparta del dental a
-- propósito. "xray_analyses" del dental tiene "fileId" ÚNICO y hace upsert:
-- re-analizar PISA el análisis anterior. En un consultorio está bien —hay
-- un doctor y le importa la última lectura—. En una escuela no: el docente
-- necesita ver EXACTAMENTE lo que vio su alumno cuando decidió, no una
-- versión posterior que lo reemplazó. Por eso "studyId" NO es único.
CREATE TABLE IF NOT EXISTS "edu_study_analyses" (
  "id"                TEXT             NOT NULL,
  "institutionId"     TEXT             NOT NULL,
  "studyId"           TEXT             NOT NULL,
  -- Lo que devolvió el modelo, ya NORMALIZADO por la aplicación (no el
  -- JSON crudo): la fila es lo que va a leer una pantalla dentro de un
  -- año, y un campo con otra forma la dejaría en blanco sin explicación.
  "summary"           TEXT             NOT NULL,
  "findings"          JSONB            NOT NULL,
  "recommendations"   JSONB            NOT NULL,
  -- Derivados, para poder filtrar sin abrir el JSON.
  "severity"          VARCHAR(20)      NOT NULL,
  "confidence"        DOUBLE PRECISION NOT NULL,
  -- Qué modelo lo escribió. Va en la FILA y no en una constante del
  -- código: dentro de un año hay que poder contestar con qué se generó
  -- esta lectura, y la constante ya será otra.
  "modelUsed"         VARCHAR(80)      NOT NULL,
  "tokensUsed"        INTEGER          NOT NULL DEFAULT 0,
  -- Costo estimado en MILLONÉSIMAS de dólar (entero, como los centavos de
  -- la Ola 5: en coma flotante no se puede sumar dinero). NULL = no se
  -- pudo calcular. Se guarda aunque hoy no se le cobre a nadie —el
  -- instituto no tiene cartera de IA todavía— justamente para poder
  -- contestar cuánto costó el día que esa decisión se tome.
  "costUsdMicros"     INTEGER,
  -- Quién lo pidió: id opcional (SET NULL) + nombre CONGELADO al lado.
  "requestedByUserId" TEXT,
  "requestedByName"   VARCHAR(160)     NOT NULL,
  "createdAt"         TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_study_analyses_pkey" PRIMARY KEY ("id")
);


-- LA CARTA DE CONSENTIMIENTO INFORMADO (NOM-004-SSA3-2012 numeral 10.1.1
-- y NOM-013-SSA2-2015 numeral 9.6.9).
--
-- 🔴 EL ALUMNO EXPLICA Y TRATA; EL DOCENTE ES EL RESPONSABLE. Los dos
-- quedan escritos y los dos contrafirman. Un consentimiento de clínica
-- universitaria con un solo profesional no dice quién responde.
CREATE TABLE IF NOT EXISTS "edu_consents" (
  "id"                       TEXT         NOT NULL,
  "institutionId"            TEXT         NOT NULL,
  "patientId"                TEXT         NOT NULL,
  -- El caso, si la carta cuelga de uno. La aplicación lo EXIGE al emitir
  -- (de ahí salen el alumno y el docente); la columna es NULL-able solo
  -- para que borrar un caso no se lleve por delante la carta firmada.
  "caseId"                   TEXT,

  -- Qué se consiente. "procedureKey" es la clave del catálogo compartido
  -- (src/lib/consent/templates.ts, módulo PURO que el vertical IMPORTA);
  -- NULL = el alumno redactó el texto.
  "procedureKey"             VARCHAR(60),
  "procedure"                VARCHAR(200) NOT NULL,
  -- El texto EXACTO que se firmó. Instantánea inmutable: cambiar la
  -- plantilla mañana NO reescribe lo que alguien firmó ayer.
  "content"                  TEXT         NOT NULL,
  -- SHA-256 del texto canónico. 🔴 Se normaliza NFC y CRLF antes de
  -- digerir: en español la "í" se guarda como UN carácter o como DOS según
  -- el sistema del teclado, y sin normalizar la misma carta copiada desde
  -- otro equipo da otro hash y la firma parece vencida sola. La receta
  -- lleva su VERSIÓN dentro del texto (ver consentimientos-core.ts).
  "contentHash"              VARCHAR(64),

  -- La liga pública. El token ES la credencial: no hay sesión detrás.
  "token"                    VARCHAR(64)  NOT NULL,
  -- Cuándo caduca la posibilidad de FIRMAR. Una carta ya firmada se sigue
  -- leyendo para siempre: es la copia del paciente.
  "expiresAt"                TIMESTAMP(3) NOT NULL,

  -- El ALUMNO que explica el procedimiento y lo va a realizar.
  "studentUserId"            TEXT,
  "studentName"              VARCHAR(160) NOT NULL,
  "studentMatricula"         VARCHAR(30),
  -- El DOCENTE responsable del acto.
  "supervisorUserId"         TEXT,
  "supervisorName"           VARCHAR(160),
  -- Quién generó el documento (cualquiera de los dos, o la dirección).
  "createdByUserId"          TEXT,
  "createdByName"            VARCHAR(160) NOT NULL,

  -- Firma del paciente o de su representante legal (NOM-004 10.1.1.3).
  -- "signerName" vacío = firmó el paciente por sí mismo.
  "signerName"               VARCHAR(160),
  "signerRelation"           VARCHAR(60),
  "signedAt"                 TIMESTAMP(3),
  -- PATH interno del bucket privado `edu-files`, jamás una URL: una URL
  -- firmada caduca y dejaría la columna con enlaces muertos.
  "signatureUrl"             VARCHAR(400),

  -- Evidencia de la firma electrónica (Código de Comercio arts. 89 y 89
  -- bis; CFPC 210-A). "viewedAt" es la que distingue un consentimiento
  -- INFORMADO de una firma a ciegas: acredita que el documento se ABRIÓ
  -- antes de firmarse.
  "viewedAt"                 TIMESTAMP(3),
  "signedIp"                 VARCHAR(64),
  "signedUserAgent"          VARCHAR(400),

  -- Testigos del acto, hasta dos (NOM-004 10.1.1.7).
  "witness1Name"             VARCHAR(160),
  "witness1SignatureUrl"     VARCHAR(400),
  "witness1SignedAt"         TIMESTAMP(3),
  "witness2Name"             VARCHAR(160),
  "witness2SignatureUrl"     VARCHAR(400),
  "witness2SignedAt"         TIMESTAMP(3),

  -- Contrafirma del ALUMNO que va a tratar.
  "studentSignedAt"          TIMESTAMP(3),
  "studentSignatureUrl"      VARCHAR(400),
  -- Contrafirma del DOCENTE responsable. "supervisorSignedByUserId"
  -- existe aparte de "supervisorUserId" por lo mismo que "edu_records"
  -- separa "authorUserId" de "signedByUserId": el docente titular puede
  -- haber rotado y firmar la dirección, y hay que poder contestar quién
  -- firmó de verdad sin perder quién era el responsable designado.
  "supervisorSignedAt"       TIMESTAMP(3),
  "supervisorSignatureUrl"   VARCHAR(400),
  "supervisorSignedByUserId" TEXT,
  "supervisorSignedByName"   VARCHAR(160),

  -- Revocación. NO borra nada: deja constancia. Es un derecho del
  -- paciente y la carta ya emitida sigue existiendo, marcada.
  "revokedAt"                TIMESTAMP(3),
  "revokedByUserId"          TEXT,
  "revokedByName"            VARCHAR(160),
  "revokedReason"            VARCHAR(500),

  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_consents_pkey" PRIMARY KEY ("id")
);


-- ── 2. Índices ─────────────────────────────────────────────────────────
-- Los nombres son los que le dice el `map:` de Prisma: si algún día se
-- corre `prisma migrate diff` contra esta base, los reconoce y no propone
-- recrearlos.

CREATE INDEX IF NOT EXISTS "edu_study_analyses_study_idx"
  ON "edu_study_analyses" ("institutionId", "studyId", "createdAt");

-- 🔴 EL TOKEN ES ÚNICO EN TODA LA TABLA, no por instituto. Es la
-- credencial de la liga pública y se busca SIN institutionId (no hay
-- sesión de la que sacarlo): dos escuelas con el mismo token harían que
-- una carta abriera la de la otra.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_consents_token_key"
  ON "edu_consents" ("token");

CREATE INDEX IF NOT EXISTS "edu_consents_patient_idx"
  ON "edu_consents" ("institutionId", "patientId", "createdAt");

CREATE INDEX IF NOT EXISTS "edu_consents_case_idx"
  ON "edu_consents" ("institutionId", "caseId");

CREATE INDEX IF NOT EXISTS "edu_consents_student_idx"
  ON "edu_consents" ("institutionId", "studentUserId");


-- ── 3. Llaves foráneas ─────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- envuelta en su bloque.
--
-- ⚠️ CASCADE vs SET NULL, y por qué no son todas iguales:
--   · CASCADE  → lo que pertenece al instituto y lo que no tiene sentido
--     sin su padre: el análisis sin su estudio, la carta sin su paciente.
--     El producto NO borra nada de esto; el CASCADE está para que borrar
--     un instituto entero —operación de administración, no del panel— no
--     se atore en una llave.
--   · SET NULL → el caso de una carta. Perder la referencia al caso es
--     aceptable; perder el consentimiento del paciente, no. El texto
--     congelado ("studentName", "supervisorName") sobrevive a ese NULL,
--     que es justamente para lo que está.
--
-- 🔴 Las columnas de PERSONA ("studentUserId", "supervisorUserId",
-- "createdByUserId", "revokedByUserId", "supervisorSignedByUserId",
-- "requestedByUserId") NO llevan llave foránea a "edu_users", y es a
-- propósito — el mismo criterio que "consent_forms" del dental. Una FK
-- obligaría a elegir entre CASCADE (borrar a una persona borraría cartas
-- firmadas por pacientes) y RESTRICT (nadie se podría dar de baja nunca).
-- El nombre CONGELADO al lado es lo que hace que el documento se siga
-- leyendo pase lo que pase, y el id sirve para las comparaciones de la
-- aplicación ("¿esta sesión es el alumno de la carta?"), que ya filtran
-- por institutionId.

DO $edu$
BEGIN
  ALTER TABLE "edu_study_analyses"
    ADD CONSTRAINT "edu_study_analyses_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_study_analyses"
    ADD CONSTRAINT "edu_study_analyses_studyId_fkey"
    FOREIGN KEY ("studyId") REFERENCES "edu_studies" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_consents"
    ADD CONSTRAINT "edu_consents_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_consents"
    ADD CONSTRAINT "edu_consents_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_consents"
    ADD CONSTRAINT "edu_consents_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "edu_cases" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 4. Documentación en la propia base ─────────────────────────────────
-- COMMENT ON reemplaza el comentario anterior: es idempotente por sí solo.
COMMENT ON TABLE "edu_study_analyses" IS
  'APOYO diagnóstico de IA sobre una imagen del expediente. NO es diagnóstico y NO se escribe dentro de ninguna nota clínica: no hay relación con edu_records por ningún lado. Se acumulan (studyId NO es único) porque el docente tiene que ver lo que su alumno vio cuando decidió, no la versión que lo reemplazó.';
COMMENT ON COLUMN "edu_study_analyses"."costUsdMicros" IS
  'Millonésimas de dólar, ENTERAS. Hoy no se le cobra a nadie (el instituto no tiene cartera de IA) y por eso mismo se guarda: para poder contestar cuánto costó el día que esa decisión se tome.';
COMMENT ON COLUMN "edu_study_analyses"."modelUsed" IS
  'Va en la fila y no en una constante del código: dentro de un año hay que poder contestar con qué modelo se generó esta lectura.';

COMMENT ON TABLE "edu_consents" IS
  'Carta de consentimiento informado (NOM-004 10.1.1, NOM-013 9.6.9). En una escuela hay DOS profesionales: el ALUMNO explica y trata, el DOCENTE responde. Los dos quedan escritos y los dos contrafirman. No hay columna status: el estado se DERIVA de (signedAt, revokedAt, expiresAt, ahora).';
COMMENT ON COLUMN "edu_consents"."token" IS
  'La credencial de la liga pública. Único en TODA la tabla, no por instituto: se busca sin institutionId porque no hay sesión de la que sacarlo.';
COMMENT ON COLUMN "edu_consents"."contentHash" IS
  'SHA-256 del texto canónico, normalizado NFC y CRLF antes de digerir. Sin esa normalización, la misma carta copiada desde otro sistema operativo da otro hash y la firma parece vencida sola. La versión de la receta va DENTRO del texto.';
COMMENT ON COLUMN "edu_consents"."viewedAt" IS
  'Cuándo se ABRIÓ la carta. Es lo que distingue un consentimiento informado de una firma a ciegas: acredita que el documento se leyó antes de firmarse.';
COMMENT ON COLUMN "edu_consents"."studentName" IS
  'CONGELADO al emitir, al lado de un id opcional. Un documento firmado tiene que seguir diciendo quién lo firmó aunque esa persona se dé de baja o cambie de apellido.';
COMMENT ON COLUMN "edu_consents"."supervisorSignedByUserId" IS
  'Quién contrafirmó DE VERDAD, que puede no ser el supervisor designado (rotó, y firma la dirección). Mismo par de columnas que authorUserId/signedByUserId en edu_records.';
COMMENT ON COLUMN "edu_consents"."revokedAt" IS
  'Revocar NO borra: deja constancia. La carta y su firma se quedan como están, marcadas. Y el estado REVOCADO gana sobre FIRMADO — pintar como firmado algo que el paciente retiró es cómo alguien acaba tratando a quien dijo que no.';


-- ═══════════════════════════════════════════════════════════════════════
-- 5. BACKFILL DEL OVERRIDE DE PERMISOS  ← LÉELO ANTES DE CERRAR EL ARCHIVO
--
-- 🔴 "permissionsOverride" REEMPLAZA al default del rol, no se suma. Es
-- decir: a quien YA tenga un override guardado, las CUATRO keys de esta
-- ola (estudios.analyze, consentimientos.view/create/revoke) NO le llegan
-- solas. Entrará al panel, no verá la pestaña "Consentimientos" en la
-- ficha del paciente ni el botón de analizar, y desde fuera parecerá que
-- la ola no se aplicó.
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
-- ⚠️ SON DOS BLOQUES Y NO CUATRO, y ahí está toda la ola:
--   · DIRECCION, DOCENTE y ALUMNO llevan las CUATRO;
--   · CAJA lleva UNA sola, "consentimientos.view".
-- Copiarle a caja el bloque de arriba le daría emitir y revocar
-- consentimientos y analizar radiografías — tres cosas que recepción no
-- hace.
--
-- -- DIRECCION + DOCENTE + ALUMNO: las cuatro.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'estudios.analyze',
--           'consentimientos.view', 'consentimientos.create', 'consentimientos.revoke'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" IN ('DIRECCION', 'DOCENTE', 'ALUMNO')
--   AND cardinality("permissionsOverride") > 0;
--
-- -- CAJA: SOLO ver. Recepción imprime la carta, se la da al paciente y la
-- -- recoge firmada. No la emite, no la revoca y no analiza placas. Y
-- -- aunque alguien le encendiera "estudios.analyze" por error, el ALCANCE
-- -- del expediente (visibility.ts, recurso "cases") le devuelve "none" y
-- -- no encontraría un estudio que analizar.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY['consentimientos.view']::TEXT[]
--       )
--     )
-- WHERE "role" = 'CAJA'
--   AND cardinality("permissionsOverride") > 0;
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 6. LA BANDERA DE IA — NO ES SQL, PERO SE APLICA AQUÍ MISMO
--
-- Las dos funciones de IA de esta ola (el dictado por voz y el análisis
-- radiográfico) nacen APAGADAS y NO se encienden con este archivo: se
-- encienden con una variable de entorno.
--
--   EDU_IA_ENABLED=1
--
-- 🔴 LÉELO ANTES DE PONERLA. Encenderla manda el gasto de IA del instituto
-- a la MISMA cuenta de API que usa el dental (OPENAI_API_KEY para Whisper,
-- ANTHROPIC_API_KEY para la visión), SIN cupo por instituto y SIN forma de
-- repartir la factura. El panel dental cobra esos tokens contra
-- "Clinic"."aiTokensLimit" de cada clínica; una escuela no tiene fila de
-- clínica, así que no hay a qué cartera cargarlos.
--
-- Mientras la bandera esté apagada, las dos pantallas se pintan y explican
-- por qué están apagadas, y los dos endpoints contestan 503 con ese mismo
-- texto. Nada revienta y nada gasta.
--
-- Lo que SÍ queda registrado desde el primer día, para cuando haya que
-- decidir: cada análisis guarda su modelo, sus tokens y su costo estimado
-- en "edu_study_analyses". Para saber cuánto lleva gastado un instituto:
--
-- SELECT i."name",
--        count(*)                                  AS analisis,
--        sum(a."tokensUsed")                       AS tokens,
--        round(sum(a."costUsdMicros") / 1000000.0, 2) AS usd
-- FROM "edu_study_analyses" a
-- JOIN "edu_institutions" i ON i."id" = a."institutionId"
-- GROUP BY i."name"
-- ORDER BY usd DESC NULLS LAST;
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 7. COMPROBACIÓN
--
-- Debe devolver 2 tablas, 5 índices (sin contar las PK) y 5 llaves.
--
-- SELECT 'tablas' AS que, count(*) AS n
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('edu_study_analyses', 'edu_consents')
-- UNION ALL
-- SELECT 'indices', count(*)
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename IN ('edu_study_analyses', 'edu_consents')
--   AND indexname NOT LIKE '%_pkey'
-- UNION ALL
-- SELECT 'llaves', count(*)
-- FROM information_schema.table_constraints
-- WHERE table_schema = 'public'
--   AND table_name IN ('edu_study_analyses', 'edu_consents')
--   AND constraint_type = 'FOREIGN KEY';
--
-- Y para probar el circuito completo sin tocar el navegador: emite una
-- carta desde /instituto/pacientes/<id>/consentimientos, copia la liga y
-- ábrela en una ventana de incógnito. Si sale 404, el sospechoso número
-- uno es el token (comprueba que la fila existe:
-- SELECT "token", "expiresAt" FROM "edu_consents" ORDER BY "createdAt" DESC LIMIT 1).
-- ═══════════════════════════════════════════════════════════════════════
