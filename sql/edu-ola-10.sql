-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola 10 · FACTURACIÓN CFDI.
--
-- Va DESPUÉS de sql/edu-ola-0.sql, sql/edu-ola-1.sql, sql/edu-ola-2.sql y
-- sql/edu-ola-5.sql (necesita "edu_institutions", "edu_users",
-- "edu_patients" y, sobre todo, "edu_charges" — que es SOBRE LO QUE SE
-- FACTURA). Producto SEPARADO del dental, que está VIVO en producción:
-- este archivo NO toca ni una tabla, ni una columna, ni una fila del
-- dental, de barbería ni de inmuebles. En particular NO toca
-- "cfdi_records", "cfdi_usage" ni "invoices", que son del dental.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   3 enums   · "EduFiscalEnv", "EduInvoiceStatus", "EduTaxMode"
--   3 tablas  · edu_fiscal_configs, edu_patient_tax_profiles, edu_invoices
--   9 índices · 4 únicos + 5 de consulta
--  11 llaves foráneas
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
-- 🔴 LAS CUATRO DECISIONES DE ESTA OLA, Y DÓNDE ESTÁN ESCRITAS
--
-- 1. UN COBRO NO SE FACTURA DOS VECES, y el candado está EN LA BASE, no
--    en un botón deshabilitado. Es el índice
--    "edu_invoices_activo_key" sobre ("institutionId","activeChargeId"):
--
--      · al empezar a facturar se INSERTA la fila con status 'STAMPING' y
--        "activeChargeId" = el cobro, ANTES de llamar a Facturapi;
--      · dos clics simultáneos son dos INSERT y el segundo choca contra
--        este índice (Postgres es el único árbitro sin condiciones de
--        carrera). El servidor lo traduce a un 409 legible;
--      · al CANCELAR, "activeChargeId" pasa a NULL. Postgres considera los
--        NULL DISTINTOS entre sí en un índice único, así que un cobro
--        puede acumular varias facturas canceladas y como mucho UNA viva.
--        Eso es lo que permite re-facturar un cobro cuyo CFDI se canceló
--        sin borrar historia.
--
--    ⚠️ Es un índice único NORMAL, no uno PARCIAL con WHERE. Un parcial
--    diría lo mismo pero Prisma no lo sabe expresar, y el schema y la base
--    quedarían distintos — que es como se llega a que `prisma migrate
--    diff` proponga borrarlo.
--
-- 2. NO HAY COLUMNA DE IMPORTES CALCULADA NI TRIGGER QUE LA RECALCULE. El
--    subtotal, el descuento, el total y los conceptos se COPIAN del cobro
--    al timbrar y no se vuelven a tocar. Si el tarifario sube en marzo, un
--    CFDI de enero sigue diciendo lo que dijo. Que la suma de los
--    conceptos cuadre con el cobro se comprueba en la aplicación ANTES de
--    gastar un timbre (src/lib/edu/facturacion-core.ts): un CHECK de
--    Postgres no puede sumar filas de otra tabla.
--
-- 3. NO HAY UNA COLUMNA "ambiente" GLOBAL DEL DESPLIEGUE. El dental decide
--    PRUEBAS/LIVE con la variable de entorno FACTURAPI_ENV, que es una
--    sola para todo. Aquí el ambiente es un dato del INSTITUTO
--    (edu_fiscal_configs."environment") y CADA factura guarda en cuál se
--    timbró (edu_invoices."environment"). Sin esas dos columnas, encender
--    el timbrado fiscal reetiquetaría como fiscales todos los
--    comprobantes de prueba anteriores — y la pantalla los enseñaría como
--    válidos.
--
-- 4. EL XML SE GUARDA Y EL PDF NO. El XML es el documento fiscal y pesa
--    unos kilobytes: va en la columna "xml" para que el histórico no
--    dependa de que Facturapi siga en pie. El PDF es una representación
--    que se puede volver a generar y pesa megabytes; se pide bajo demanda.
--
-- 🔴 NOTA SOBRE EL DINERO: en CENTAVOS (INTEGER), igual que la Ola 5.
-- Nunca NUMERIC ni DOUBLE PRECISION. Un CFDI que no cuadra al centavo con
-- el recibo es un problema fiscal, no un redondeo.
--
-- 🔴 NOTA SOBRE LOS TIPOS DE FECHA — no es un descuido que convivan dos:
--   · TIMESTAMP(3)   → sellos internos ("createdAt"/"updatedAt").
--   · TIMESTAMPTZ(3) → los INSTANTES que se ordenan y se comparan
--     ("issuedAt", "stampedAt", "cancelledAt"). Un comprobante fiscal se
--     ordena por cuándo se timbró, y la escuela puede estar en cualquier
--     zona del país.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Enums ───────────────────────────────────────────────────────────

-- PRUEBAS o EN VIVO. En 'TEST' Facturapi timbra con SUS certificados de
-- prueba: el documento tiene UUID, PDF y XML, y NO llega al SAT ni tiene
-- validez fiscal. En 'LIVE' se timbra ante el SAT con el CSD del
-- instituto.
DO $edu$
BEGIN
  CREATE TYPE "EduFiscalEnv" AS ENUM ('TEST', 'LIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- En qué va la factura.
--
-- 🔴 'STAMPING' no es decoración: es la RESERVA que sostiene el candado
-- contra la doble factura. Una fila que se queda ahí es una llamada que se
-- cortó a media red y de la que NO se sabe si el SAT timbró — se deja
-- así a propósito, y se resuelve mirando Facturapi.
DO $edu$
BEGIN
  CREATE TYPE "EduInvoiceStatus" AS ENUM (
    'STAMPING', 'VALID', 'CANCELLED', 'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- Cómo se timbra el IVA. 'EXENTO' es el default: los servicios de
-- medicina y odontología prestados por profesionales están exentos
-- (art. 15 LIVA). Es un ENUM y no un texto libre a propósito — en el
-- dental conviven "exempt" y "exento" para lo mismo, y un refactor que
-- mezcle los dos timbra con IVA algo que debía salir exento.
DO $edu$
BEGIN
  CREATE TYPE "EduTaxMode" AS ENUM ('EXENTO', 'IVA16');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 2. Tablas ──────────────────────────────────────────────────────────

-- LOS DATOS FISCALES DEL INSTITUTO. UNA fila por instituto (el índice
-- único de "institutionId" lo garantiza).
--
-- 🔴 Es la única fuente de "¿esto es de pruebas o es fiscal?". Ninguna
-- pantalla del vertical lee la variable de entorno del dental: leen esta
-- tabla, y por eso el aviso de la interfaz no se puede quedar viejo
-- respecto de la realidad.
--
-- "facturapiOrgId" es la organización del instituto DENTRO de la cuenta de
-- Facturapi de DaleControl (multi-RFC), igual que hace el dental con
-- Clinic."facturApiOrgId". "facturapiLiveKey" guarda CIFRADA la Live
-- Secret Key, que Facturapi solo devuelve UNA vez y no se puede volver a
-- leer.
--
-- ⚠️ "isEnabled" nace en false y "environment" en 'TEST'. Los dos son
-- decisiones que se toman a mano: una escuela que acaba de capturar su RFC
-- no debe poder emitir por accidente, y muchísimo menos ante el SAT.
CREATE TABLE IF NOT EXISTS "edu_fiscal_configs" (
  "id"                TEXT           NOT NULL,
  "institutionId"     TEXT           NOT NULL,
  -- Identidad fiscal del EMISOR, tal cual la Constancia de Situación
  -- Fiscal. Si algo no coincide, el SAT rechaza el timbrado.
  "rfc"               VARCHAR(13)    NOT NULL,
  "legalName"         VARCHAR(200)   NOT NULL,
  "taxRegime"         VARCHAR(6)     NOT NULL,
  "zipCode"           VARCHAR(5)     NOT NULL,
  "environment"       "EduFiscalEnv" NOT NULL DEFAULT 'TEST',
  "isEnabled"         BOOLEAN        NOT NULL DEFAULT false,
  "facturapiOrgId"    TEXT,
  -- Cifrada con el envelope de src/lib/crypto/envelope.ts. NUNCA sale de
  -- la base hacia el navegador.
  "facturapiLiveKey"  TEXT,
  -- Informativo. La verdad de si la organización puede timbrar en vivo la
  -- tiene Facturapi (is_production_ready / pending_steps) y se consulta al
  -- abrir la pantalla; una bandera local se queda vieja.
  "csdUploadedAt"     TIMESTAMP(3),
  -- Defaults con los que se PROPONE cada factura (se cambian una por una).
  "taxMode"           "EduTaxMode"   NOT NULL DEFAULT 'EXENTO',
  "defaultUsoCfdi"    VARCHAR(5)     NOT NULL DEFAULT 'D01',
  "defaultProductKey" VARCHAR(8)     NOT NULL DEFAULT '85121600',
  -- Prefijo del folio INTERNO ("F-0001"). No es el folio fiscal: ése es el
  -- UUID que devuelve el SAT.
  "folioPrefix"       VARCHAR(6)     NOT NULL DEFAULT 'F',
  "updatedByUserId"   TEXT,
  "createdAt"         TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_fiscal_configs_pkey" PRIMARY KEY ("id")
);

-- LOS DATOS FISCALES DEL PACIENTE. Tabla APARTE, uno a uno con
-- edu_patients.
--
-- 🔴 POR QUÉ NO SON COLUMNAS DE edu_patients, que era la otra opción:
--
--  1. La fila del paciente la leen la agenda, el buscador, la ficha, el
--     tamizaje y el modal de caja, muchas veces sin lista de columnas
--     explícita. Un RFC y una razón social ahí dentro viajan a pantallas
--     que nunca los pidieron —incluidas las de un ALUMNO— y ése es
--     exactamente el tipo de fuga que ya costó un incidente en el dental.
--  2. Son datos que la mayoría de los pacientes NO tienen: en una clínica
--     de escuela factura uno de cada diez. Cinco columnas nulas en la
--     tabla más consultada del vertical, para el 10 % de las filas.
--  3. Se llenan en otro momento (el mostrador, al pedir la factura) y por
--     otra gente. Separarlos deja auditar quién los tocó sin ensuciar el
--     "updatedAt" de la ficha clínica.
--
-- Lo que se pierde es un JOIN, y solo cuando se factura.
CREATE TABLE IF NOT EXISTS "edu_patient_tax_profiles" (
  "id"              TEXT         NOT NULL,
  "institutionId"   TEXT         NOT NULL,
  "patientId"       TEXT         NOT NULL,
  "rfc"             VARCHAR(13)  NOT NULL,
  "legalName"       VARCHAR(200) NOT NULL,
  "taxRegime"       VARCHAR(6)   NOT NULL,
  "zipCode"         VARCHAR(5)   NOT NULL,
  -- A dónde manda Facturapi el CFDI. Opcional: puede no tener correo.
  "email"           VARCHAR(160),
  "usoCfdi"         VARCHAR(5)   NOT NULL DEFAULT 'D01',
  "updatedByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_patient_tax_profiles_pkey" PRIMARY KEY ("id")
);

-- LA FACTURA DE UN COBRO.
--
-- 🔴 Todo lo importante de esta tabla está en el encabezado del archivo:
-- el candado de "activeChargeId", los importes congelados y el ambiente
-- por factura. Aquí van solo las notas de cada columna.
CREATE TABLE IF NOT EXISTS "edu_invoices" (
  "id"                TEXT               NOT NULL,
  "institutionId"     TEXT               NOT NULL,
  -- El cobro facturado. SIEMPRE presente: de aquí salen los importes.
  "chargeId"          TEXT               NOT NULL,
  -- 🔴 EL CANDADO. Igual a "chargeId" mientras la factura vive; NULL en
  -- cuanto se cancela o falla el timbrado.
  "activeChargeId"    TEXT,
  -- Se guarda ADEMÁS del cobro para listar "las facturas de este paciente"
  -- sin un JOIN, y porque el receptor puede no ser el paciente.
  "patientId"         TEXT               NOT NULL,
  -- Folio INTERNO del instituto ("F-0001"), no el fiscal.
  "folio"             VARCHAR(30)        NOT NULL,
  "status"            "EduInvoiceStatus" NOT NULL DEFAULT 'STAMPING',
  -- 🔴 EN QUÉ AMBIENTE SE TIMBRÓ ESTA FACTURA, congelado.
  "environment"       "EduFiscalEnv"     NOT NULL,

  -- El RECEPTOR, congelado al timbrar. Si mañana corrige su RFC, este
  -- CFDI sigue diciendo a nombre de quién se emitió.
  "receptorRfc"       VARCHAR(13)        NOT NULL,
  "receptorLegalName" VARCHAR(200)       NOT NULL,
  "receptorTaxRegime" VARCHAR(6)         NOT NULL,
  "receptorZip"       VARCHAR(5)         NOT NULL,
  "receptorEmail"     VARCHAR(160),

  -- Claves del SAT congeladas: uso del CFDI y forma de pago.
  "usoCfdi"           VARCHAR(5)         NOT NULL,
  "paymentForm"       VARCHAR(2)         NOT NULL,
  "taxMode"           "EduTaxMode"       NOT NULL,

  -- Los IMPORTES, copiados del COBRO. En CENTAVOS. No se recalculan.
  "subtotalCents"     INTEGER            NOT NULL,
  "discountCents"     INTEGER            NOT NULL DEFAULT 0,
  "totalCents"        INTEGER            NOT NULL,
  -- Las líneas EXACTAS que se mandaron a timbrar. Sirven para reimprimir
  -- el detalle sin depender de que el cobro siga como estaba.
  "conceptos"         JSONB              NOT NULL,

  -- El timbre.
  "facturapiId"       TEXT,
  -- Folio fiscal del SAT.
  "uuid"              VARCHAR(40),
  "stampedAt"         TIMESTAMPTZ(3),
  -- El XML COMPLETO. Ver la decisión 4 del encabezado.
  "xml"               TEXT,
  "xmlUrl"            TEXT,
  "pdfUrl"            TEXT,

  "issuedByUserId"    TEXT               NOT NULL,
  "issuedAt"          TIMESTAMPTZ(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- La cancelación. No borra NADA.
  "cancelledAt"       TIMESTAMPTZ(3),
  "cancelledByUserId" TEXT,
  -- Clave del catálogo c_MotivoCancelacion: '02', '03', '04'.
  "cancelMotive"      VARCHAR(2),
  "cancelReason"      VARCHAR(300),

  -- Lo que contestó Facturapi cuando falló. Se guarda para poder decir QUÉ
  -- pasó en vez de "error al timbrar".
  "errorMessage"      VARCHAR(500),

  "createdAt"         TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_invoices_pkey" PRIMARY KEY ("id")
);


-- ── 3. Índices ─────────────────────────────────────────────────────────
-- Los nombres son los que le dice el `map:` de Prisma: si algún día se
-- corre `prisma migrate diff` contra esta base, los reconoce y no propone
-- recrearlos.

-- Una configuración fiscal por instituto. No es un capricho: dos filas
-- serían dos ambientes distintos a la vez y la pantalla enseñaría uno
-- cualquiera de los dos.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_fiscal_configs_institutionId_key"
  ON "edu_fiscal_configs" ("institutionId");

-- Un perfil fiscal por paciente.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_patient_tax_profiles_patientId_key"
  ON "edu_patient_tax_profiles" ("patientId");

-- "¿a qué otros pacientes le hemos facturado con este RFC?" — la pregunta
-- que se hace quien busca un duplicado.
CREATE INDEX IF NOT EXISTS "edu_patient_tax_rfc_idx"
  ON "edu_patient_tax_profiles" ("institutionId", "rfc");

-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 EL CANDADO CONTRA LA DOBLE FACTURA. Si solo se copiara una línea de
-- este archivo, sería ésta.
--
-- Un cobro puede tener MUCHAS facturas canceladas ("activeChargeId" NULL,
-- y Postgres considera los NULL distintos entre sí) y COMO MUCHO UNA viva.
-- Dos clics simultáneos son dos INSERT y el segundo choca aquí.
-- ═══════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS "edu_invoices_activo_key"
  ON "edu_invoices" ("institutionId", "activeChargeId");

-- El mismo timbre no se registra dos veces (importa al recuperar a mano
-- una factura que se quedó a medias: se pega el UUID y esto impide
-- pegarlo dos veces).
CREATE UNIQUE INDEX IF NOT EXISTS "edu_invoices_uuid_key"
  ON "edu_invoices" ("institutionId", "uuid");

-- El folio interno no se repite dentro del instituto.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_invoices_folio_key"
  ON "edu_invoices" ("institutionId", "folio");

-- La lista, que ordena por fecha de emisión.
CREATE INDEX IF NOT EXISTS "edu_invoices_fecha_idx"
  ON "edu_invoices" ("institutionId", "issuedAt");

-- El filtro por estado de la pantalla.
CREATE INDEX IF NOT EXISTS "edu_invoices_status_idx"
  ON "edu_invoices" ("institutionId", "status");

-- "¿este cobro ya se facturó alguna vez?" (incluye las canceladas, que el
-- índice del candado no ve porque solo mira las vivas).
CREATE INDEX IF NOT EXISTS "edu_invoices_charge_idx"
  ON "edu_invoices" ("institutionId", "chargeId");

-- "las facturas de este paciente", desde su ficha.
CREATE INDEX IF NOT EXISTS "edu_invoices_patient_idx"
  ON "edu_invoices" ("institutionId", "patientId");


-- ── 4. Llaves foráneas ─────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- envuelta en su bloque.
--
-- ⚠️ CASCADE vs SET NULL, y por qué no son todas iguales:
--   · CASCADE  → lo que pertenece al instituto y lo que no tiene sentido
--     sin su padre (la configuración sin su instituto, el perfil fiscal
--     sin su paciente, la factura sin su cobro). El producto NO borra nada
--     de esto: una factura se CANCELA. El CASCADE está para que borrar un
--     instituto entero —operación de administración, no del panel— no se
--     atore en una FK.
--   · SET NULL → las referencias "hacia los lados": quién editó, quién
--     canceló. Perder la referencia es aceptable; perder la factura no.
--
-- 🔴 "issuedByUserId" va en CASCADE y NO en SET NULL porque es NOT NULL:
-- es el rastro de quién emitió el comprobante. En este producto un usuario
-- no se borra —se desactiva (isActive)— así que ese CASCADE no se dispara
-- nunca desde el panel.
--
-- ⚠️ "chargeId" en CASCADE tiene una consecuencia que conviene saber:
-- borrar un cobro por SQL se llevaría su factura. El panel NO borra
-- cobros (los CANCELA, ver la Ola 5), así que en la práctica no pasa; si
-- alguna vez se escribe un borrado de cobros, tiene que comprobar antes
-- que no tenga facturas — un CFDI timbrado sobrevive a todo lo demás.

DO $edu$
BEGIN
  ALTER TABLE "edu_fiscal_configs"
    ADD CONSTRAINT "edu_fiscal_configs_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_fiscal_configs"
    ADD CONSTRAINT "edu_fiscal_configs_updatedByUserId_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_patient_tax_profiles"
    ADD CONSTRAINT "edu_patient_tax_profiles_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_patient_tax_profiles"
    ADD CONSTRAINT "edu_patient_tax_profiles_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_patient_tax_profiles"
    ADD CONSTRAINT "edu_patient_tax_profiles_updatedByUserId_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_invoices"
    ADD CONSTRAINT "edu_invoices_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_invoices"
    ADD CONSTRAINT "edu_invoices_chargeId_fkey"
    FOREIGN KEY ("chargeId") REFERENCES "edu_charges" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_invoices"
    ADD CONSTRAINT "edu_invoices_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_invoices"
    ADD CONSTRAINT "edu_invoices_issuedByUserId_fkey"
    FOREIGN KEY ("issuedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_invoices"
    ADD CONSTRAINT "edu_invoices_cancelledByUserId_fkey"
    FOREIGN KEY ("cancelledByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- ⚠️ NO hay FK de "activeChargeId" a "edu_charges". Es a propósito: esa
-- columna no es una referencia, es un CANDADO. Su valor siempre es el
-- mismo "chargeId" (que sí tiene su FK) o NULL, y una segunda FK sobre lo
-- mismo solo añadiría una comprobación más en cada INSERT del camino
-- caliente del timbrado.


-- ═══════════════════════════════════════════════════════════════════════
-- 5. 🔴 BACKFILL DE PERMISOS — LÉELO ANTES DE DAR POR APLICADA LA OLA
--
-- Las cuatro keys nuevas son:
--   facturacion.view · facturacion.emit · facturacion.cancel ·
--   facturacion.config
--
-- El override REEMPLAZA al default del rol, NO se suma. Consecuencia: a
-- quien ya tenga un "permissionsOverride" con keys guardadas, estas cuatro
-- NO le llegan solas. No verá "Facturación" en el menú y desde fuera
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
-- ⚠️ SON DOS BLOQUES Y NO CUATRO: DOCENTE y ALUMNO no reciben NI UNA key
-- de esta ola. En el piso clínico se atiende; facturar es del mostrador.
--
-- 🔴 Y OJO CON EL DE CAJA: lleva "view" y "emit", y NO lleva "cancel" ni
-- "config". Copiarle el bloque de dirección le dejaría cancelar CFDI ante
-- el SAT —que no se deshace— y encender el timbrado fiscal de la escuela.
-- Ésa es exactamente la línea que la ola existe para sostener.
--
-- -- DIRECCION: las cuatro. Emite, cancela y decide si el instituto
-- -- timbra en pruebas o ante el SAT.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'facturacion.view', 'facturacion.emit',
--           'facturacion.cancel', 'facturacion.config'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'DIRECCION'
--   AND cardinality("permissionsOverride") > 0;
--
-- -- CAJA: ve y emite. NO cancela y NO configura.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'facturacion.view', 'facturacion.emit'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'CAJA'
--   AND cardinality("permissionsOverride") > 0;
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 6. LA CONFIGURACIÓN FISCAL INICIAL (opcional)
--
-- Todo lo de aquí abajo está COMENTADO a propósito: es el ejemplo, no
-- parte de la migración. Lo normal es capturarlo desde
-- /instituto/facturacion/datos-fiscales, que además CREA la organización
-- en Facturapi — cosa que este INSERT no puede hacer, porque es una
-- llamada por red.
--
-- ⚠️ Si insertas la fila a mano, queda SIN "facturapiOrgId" y no se podrá
-- timbrar hasta que alguien guarde desde la pantalla. Sirve para dejar los
-- datos capturados de antemano, no para saltarse la pantalla.
--
-- Sustituye 'ieo' por el slug del instituto que creaste con edu-ola-0.sql.
--
-- INSERT INTO "edu_fiscal_configs"
--   ("id", "institutionId", "rfc", "legalName", "taxRegime", "zipCode",
--    "environment", "isEnabled", "taxMode", "defaultUsoCfdi",
--    "defaultProductKey", "folioPrefix", "createdAt", "updatedAt")
-- SELECT
--   gen_random_uuid()::text,   -- Prisma escribe cuids; la columna es TEXT,
--                              -- así que cualquier id único sirve
--   i."id",
--   'IEO010101AAA',                       -- RFC del instituto
--   'INSTITUTO DE ESPECIALIDADES ODONTOLOGICAS',  -- razón social EXACTA
--   '603',                                -- 603 = Personas Morales con
--                                         -- Fines no Lucrativos, que es
--                                         -- lo habitual en una escuela
--   '44100',                              -- CP del domicilio fiscal
--   'TEST',                               -- 🔴 SIEMPRE 'TEST' aquí
--   false,                                -- 🔴 y apagada
--   'EXENTO', 'D01', '85121600', 'F',
--   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
-- FROM "edu_institutions" i
-- WHERE i."slug" = 'ieo'
-- ON CONFLICT DO NOTHING;
--
-- ── Comprobación del candado (lo que de verdad importa) ────────────────
-- Tiene que devolver CERO filas SIEMPRE. Si devuelve alguna, hay un cobro
-- con dos facturas vivas y el índice único no está aplicado.
--
-- SELECT "chargeId", count(*) AS vivas
-- FROM "edu_invoices"
-- WHERE "activeChargeId" IS NOT NULL
-- GROUP BY "chargeId"
-- HAVING count(*) > 1;
--
-- ── Comprobación del cuadre factura ↔ cobro ───────────────────────────
-- También tiene que devolver CERO. Los importes se copian del cobro al
-- timbrar, así que una diferencia aquí significa que alguien editó una de
-- las dos tablas por SQL.
--
-- SELECT f."folio", f."totalCents" AS factura, c."totalCents" AS cobro
-- FROM "edu_invoices" f
-- JOIN "edu_charges" c ON c."id" = f."chargeId"
-- WHERE f."status" = 'VALID'
--   AND f."totalCents" <> c."totalCents";
--
-- ── Las que se quedaron a medias ──────────────────────────────────────
-- Una fila aquí es una llamada a Facturapi que se cortó y de la que NO se
-- sabe si el SAT timbró. Su cobro sigue bloqueado a propósito. Se
-- resuelven desde la pantalla (botón «Resolver» del detalle), mirando
-- antes el panel de Facturapi.
--
-- SELECT "folio", "issuedAt", "errorMessage"
-- FROM "edu_invoices"
-- WHERE "status" = 'STAMPING'
-- ORDER BY "issuedAt";
--
-- ── Qué se facturó y en qué ambiente ──────────────────────────────────
-- 🔴 Si aparece 'TEST', esos comprobantes NO tienen validez fiscal por
-- mucho que traigan UUID, PDF y XML.
--
-- SELECT "environment", "status", count(*), sum("totalCents") / 100.0 AS pesos
-- FROM "edu_invoices"
-- GROUP BY "environment", "status"
-- ORDER BY "environment", "status";
-- ═══════════════════════════════════════════════════════════════════════
