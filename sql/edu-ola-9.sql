-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola 9 · WHATSAPP Y RECORDATORIOS.
--
-- Va DESPUÉS de sql/edu-ola-0.sql, sql/edu-ola-2.sql, sql/edu-ola-3b.sql y
-- sql/edu-ola-5.sql (necesita "edu_institutions", "edu_users",
-- "edu_patients", "edu_appointments", "edu_consents" y "edu_charges").
-- Producto SEPARADO del dental, que está VIVO en producción: este archivo
-- NO toca ni una tabla, ni una columna, ni una fila del dental, de
-- barbería ni de inmuebles.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   2 enums    · "EduWhatsappKind", "EduWhatsappStatus"
--   2 tablas   · edu_whatsapp_configs, edu_whatsapp_messages
--   7 índices  · 3 únicos + 4 de consulta
--   8 llaves foráneas
--   0 columnas nuevas en tablas de olas anteriores
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
-- 🔴 CADA INSTITUTO CONECTA SU PROPIA WHATSAPP. NO HAY UNA COMPARTIDA.
--
-- No es una decisión de arquitectura, es cómo funciona Meta: cada plantilla
-- que sale se le COBRA a la tarjeta de la WABA desde la que salió, y no se
-- puede mandar "en nombre de" otra cuenta. Un número de DaleControl
-- compartido por veinte escuelas significaría que DaleControl paga los
-- recordatorios de las veinte, y que el paciente de la Escuela A recibe un
-- mensaje de un remitente que no reconoce.
--
-- Consecuencia directa, y la que más se va a ver en pantalla: si la WABA
-- del instituto no tiene método de pago válido, Meta rechaza el envío con
-- el código 131042. Eso NO es un fallo del panel y el panel no lo puede
-- arreglar — se detecta, se marca en "billingOk" y se dice con esas
-- palabras: SIN MÉTODO DE PAGO.
--
-- 🔴 LO QUE NO ESTÁ EN ESTE ARCHIVO, Y ES LA MITAD DE LA OLA
--
-- 1. NO HAY COLUMNA DE "VENTANA DE 24 h" NI TABLA DE MENSAJES ENTRANTES.
--    Meta deja mandar texto libre durante las 24 h siguientes al último
--    mensaje DEL PACIENTE; saberlo exige INGERIR los entrantes (webhook +
--    bandeja) y este vertical no los ingiere: no hay Inbox del instituto ni
--    nadie que conteste. La respuesta honesta es la conservadora — la
--    ventana se considera SIEMPRE cerrada y TODO sale por plantilla
--    aprobada, o no sale.
--
-- 2. NO HAY TABLA DE COLA APARTE. El barrido
--    (/api/instituto/cron/recordatorios) RECLAMA la constancia y MANDA en
--    el mismo tick. La fila de edu_whatsapp_messages ES la cola, el
--    registro y el acuse: tres tablas para lo mismo son tres sitios donde
--    la verdad puede discrepar.
--
-- 3. NO HAY ACUSES DE ENTREGA. "SENT" significa "Meta lo aceptó", no "el
--    teléfono lo recibió", y la pantalla lo dice con esas palabras. Sin
--    webhook no se puede saber lo segundo, y decirlo igual sería el fallo
--    mudo que esta ola existe para no repetir.
--
-- 4. NO HAY SEGUNDA ANTICIPACIÓN. Una sola columna
--    ("reminderHoursBefore"), no dos como el dental: cada plantilla que
--    sale se le cobra al instituto, y "24 h y además 2 h" duplica su
--    factura sin que nadie lo haya pedido.
--
-- 🔴 NOTA SOBRE LOS TIPOS DE FECHA — no es un descuido que convivan dos:
--   · TIMESTAMP(3)   → sellos internos ("createdAt"/"updatedAt") y las
--     marcas de la configuración, que son de auditoría.
--   · TIMESTAMPTZ(3) → cuándo TENÍA que salir un aviso y cuándo salió
--     ("scheduledFor"/"sentAt"). Son INSTANTES: el barrido los compara con
--     `now()` cada quince minutos y la escuela puede estar en cualquier
--     zona del país.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Enums ───────────────────────────────────────────────────────────
-- CREATE TYPE no acepta IF NOT EXISTS, así que cada uno va en su bloque.

-- Qué clase de mensaje es. NO es texto libre: cada tipo tiene su plantilla
-- aprobada, su interruptor y su permiso.
--
-- ⚠️ RECORDATORIO lo manda SOLO el cron. Los otros dos los manda una
-- persona desde la ficha del paciente, y cada uno con el permiso de SU
-- documento: la carta con "consentimientos.view" (la tienen los cuatro
-- roles) y el recibo con "caja.view" más el alcance del dinero, que para
-- docente y alumno no devuelve ni una fila.
DO $edu$
BEGIN
  CREATE TYPE "EduWhatsappKind" AS ENUM (
    'RECORDATORIO', 'CONSENTIMIENTO', 'RECIBO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- En qué acabó un envío.
--
-- 🔴 PENDING EXISTE PORQUE LA FILA SE ESCRIBE ANTES DE LLAMAR A META. Si se
-- escribiera después, un proceso que muere a mitad de la llamada dejaría un
-- mensaje entregado y ninguna constancia — y al siguiente tick se mandaría
-- otra vez. Escribir primero convierte ese caso en una fila PENDING, que es
-- incómoda pero VERDADERA.
--
-- BLOCKED no es un fallo de Meta: es una decisión nuestra tomada ANTES de
-- gastar la llamada (sin plantilla aprobada, sin teléfono de 10 dígitos,
-- sin conexión). CANCELLED es el aviso que se retiró porque la cita se
-- movió o se cerró.
DO $edu$
BEGIN
  CREATE TYPE "EduWhatsappStatus" AS ENUM (
    'PENDING', 'SENT', 'FAILED', 'CANCELLED', 'BLOCKED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 2. Tablas ──────────────────────────────────────────────────────────

-- LA CONEXIÓN de UN instituto con la Cloud API de Meta. Una fila por
-- instituto ("institutionId" es único).
--
-- 🔴 "accessToken" se guarda CIFRADO con el envelope de la aplicación
-- (prefijo "v1:", AES-256-GCM, ver src/lib/crypto/envelope.ts). Un token de
-- WhatsApp en claro es la cuenta de Meta entera del instituto: quien lea
-- esa fila puede mandar mensajes en su nombre y gastarle la tarjeta. La
-- columna es TEXT porque el cifrado la alarga; no la mires esperando ver un
-- "EAAG…".
--
-- 🔴 Los tres interruptores nacen en FALSE. Un producto que empieza a
-- mandarle WhatsApp a pacientes reales el día que se aplica este archivo
-- —sin que nadie lo haya pedido y con cargo a la tarjeta de la escuela— no
-- es una función, es un accidente.
CREATE TABLE IF NOT EXISTS "edu_whatsapp_configs" (
  "id"                TEXT         NOT NULL,
  "institutionId"     TEXT         NOT NULL,

  -- Credenciales de la WABA del instituto.
  "phoneNumberId"     TEXT,
  "businessAccountId" TEXT,
  "accessToken"       TEXT,
  -- El número tal como se lee ("+52 55 1234 5678"). Solo para pintarlo:
  -- nunca se manda con él, se manda con "phoneNumberId".
  "displayPhone"      VARCHAR(40),
  -- "manual" es lo único que existe hoy. "embedded" y "coexistence" quedan
  -- escritas porque son los dos caminos que Meta ofrece y el día que se
  -- implementen esta columna ya distingue las filas viejas.
  "connMethod"        VARCHAR(20),

  -- ¿Hay conexión utilizable? Se apaga SOLA ante un 190 / HTTP 401 (token
  -- revocado). Sin eso, el barrido seguiría intentando con un token muerto
  -- en cada tick y la escuela creería que sus mensajes salen.
  "connected"         BOOLEAN      NOT NULL DEFAULT false,
  "connectedAt"       TIMESTAMP(3),
  -- Lo último que dijo Meta, para poder pintarlo tal cual. El CÓDIGO es el
  -- único dato estable de esa respuesta: el texto cambia de redacción y de
  -- idioma, el número no.
  "lastErrorCode"     INTEGER,
  "lastErrorMsg"      VARCHAR(500),
  "lastErrorAt"       TIMESTAMP(3),

  -- 🔴 ¿La WABA tiene método de pago válido? Se pone en true con el primer
  -- envío de plantilla que Meta ACEPTA —es la única señal fiable que hay,
  -- Meta no expone un endpoint que lo pregunte— y vuelve a false ante el
  -- 131042.
  "billingOk"         BOOLEAN      NOT NULL DEFAULT false,
  "billingCheckedAt"  TIMESTAMP(3),

  -- Plantillas aprobadas por TIPO de mensaje:
  -- { "RECORDATORIO": { "name": "edu_recordatorio_cita", "lang": "es_MX",
  --   "status": "APPROVED" }, … }. La clave es un "EduWhatsappKind".
  -- Se lee con eduParseWaTemplates (src/lib/edu/whatsapp-core.ts), que
  -- DESCARTA lo que venga mal formado: mandarle a Meta un nombre inválido
  -- gasta un intento y devuelve un código que no explica nada.
  "templates"         JSONB,

  -- Qué avisos están encendidos.
  "remindersEnabled"    BOOLEAN    NOT NULL DEFAULT false,
  -- CUÁNTAS HORAS ANTES sale el recordatorio. Entre 1 y 168 (lo valida la
  -- aplicación: un CHECK aquí obligaría a un ALTER para cambiarlo).
  "reminderHoursBefore" INTEGER    NOT NULL DEFAULT 24,
  "consentEnabled"      BOOLEAN    NOT NULL DEFAULT false,
  "receiptEnabled"      BOOLEAN    NOT NULL DEFAULT false,

  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_whatsapp_configs_pkey" PRIMARY KEY ("id")
);

-- UN ENVÍO: lo que se mandó, a quién, y qué contestó Meta.
--
-- 🔴 UN RECORDATORIO QUE SE CREA ENVIADO Y NO SALIÓ ES PEOR QUE NINGUNO.
-- Por eso la fila se escribe ANTES de llamar a Meta (status PENDING), se
-- sella con el wamid si Meta acepta, y guarda el CÓDIGO del error si no.
--
-- 🔴 LOS DATOS DE DESTINO VAN CONGELADOS ("toName", "toPhone", "body") y
-- por eso esta tabla NO declara relaciones en Prisma con el paciente, la
-- cita, la carta ni el cobro. Lo que la constancia tiene que contestar
-- dentro de un año es "¿qué se le mandó a quién?", y un JOIN devolvería el
-- nombre de HOY — o ninguno, si al paciente se le dio de baja. Las llaves
-- foráneas SÍ existen (más abajo) y van todas en SET NULL: borrar un
-- paciente no puede borrar la constancia de que se le avisó.
CREATE TABLE IF NOT EXISTS "edu_whatsapp_messages" (
  "id"            TEXT                NOT NULL,
  "institutionId" TEXT                NOT NULL,
  "kind"          "EduWhatsappKind"   NOT NULL,
  "status"        "EduWhatsappStatus" NOT NULL DEFAULT 'PENDING',

  -- A quién, CONGELADO.
  "patientId"     TEXT,
  "toName"        VARCHAR(160)        NOT NULL,
  -- Normalizado a 10 dígitos nacionales. Meta lo recibe con el 52 delante
  -- (lo pone la aplicación al enviar).
  "toPhone"       VARCHAR(20)         NOT NULL,

  -- De qué es este aviso. Solo uno de los tres viene lleno.
  "appointmentId" TEXT,
  "consentId"     TEXT,
  "chargeId"      TEXT,

  -- El texto que la persona LEE, con la plantilla ya pintada. No es el
  -- texto libre que se habría mandado dentro de la ventana de 24 h: guardar
  -- ése sería enseñarle al instituto algo que nadie recibió.
  "body"          TEXT                NOT NULL,
  "templateName"  VARCHAR(80),
  "templateLang"  VARCHAR(12),

  -- 🔴 LA LLAVE DE IDEMPOTENCIA DEL RECORDATORIO, Y LLEVA DENTRO LA HORA DE
  -- LA CITA: "<citaId>:<horasAntes>:<startsAt ISO>". Si la cita se mueve, la
  -- llave CAMBIA, así que el recordatorio de la hora nueva no lo bloquea la
  -- fila de la hora vieja. En el dental la llave no lleva la hora y ése es
  -- justamente el bug conocido: la fila vieja tapa el aviso correcto y no es
  -- que llegue tarde, es que no llega nunca.
  -- NULL en los documentos: reenviar una carta a mano es legítimo.
  "dedupeKey"     VARCHAR(200),

  -- Cuándo TENÍA que salir y cuándo salió de verdad.
  "scheduledFor"  TIMESTAMPTZ(3),
  "sentAt"        TIMESTAMPTZ(3),

  -- Lo que contestó Meta.
  "wamid"         VARCHAR(120),
  "errorCode"     INTEGER,
  "errorMsg"      VARCHAR(500),
  -- Un fallo se reintenta unas pocas veces (una tarjeta que se arregla, un
  -- 500 de Meta) y luego se deja en paz: reintentar una plantilla rechazada
  -- cada quince minutos es pegarle a Meta toda la vida.
  "attempts"      INTEGER             NOT NULL DEFAULT 0,

  -- Quién lo mandó. NULL = el CRON (un cron no tiene usuario).
  "sentByUserId"  TEXT,
  "sentByName"    VARCHAR(160),

  "createdAt"     TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_whatsapp_messages_pkey" PRIMARY KEY ("id")
);


-- ── 3. Índices ─────────────────────────────────────────────────────────
-- Los nombres son los que genera (o los que le dice el `map:` de) Prisma:
-- si algún día se corre `prisma migrate diff` contra esta base, los
-- reconoce y no propone recrearlos.

-- Una sola configuración por instituto.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_whatsapp_configs_institutionId_key"
  ON "edu_whatsapp_configs" ("institutionId");

-- 🔴 Un número de WhatsApp no puede estar en dos institutos. Serían dos
-- escuelas mandando desde el mismo remitente, y el día que este vertical
-- ingiera mensajes entrantes no habría forma de decidir de quién es la
-- conversación. El único deja pasar varios NULL (Postgres los trata como
-- distintos), que es justo lo que hace falta: casi todos los institutos
-- empiezan sin conectar.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_whatsapp_configs_phoneNumberId_key"
  ON "edu_whatsapp_configs" ("phoneNumberId");

-- 🔴 EL SEGURO CONTRA DOS BARRIDOS SIMULTÁNEOS. Si el cron se solapa
-- consigo mismo (un tick que tarda más de quince minutos), el segundo choca
-- aquí con un P2002 y se va SIN mandar nada. Sin este único, el paciente
-- recibiría el mismo recordatorio dos veces — y las dos se las cobran al
-- instituto.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_whatsapp_messages_dedupe_key"
  ON "edu_whatsapp_messages" ("institutionId", "dedupeKey");

-- El registro de la pantalla de configuración: lo último, primero.
CREATE INDEX IF NOT EXISTS "edu_whatsapp_messages_fecha_idx"
  ON "edu_whatsapp_messages" ("institutionId", "createdAt");

-- La pestaña WhatsApp de la ficha de UN paciente.
CREATE INDEX IF NOT EXISTS "edu_whatsapp_messages_patient_idx"
  ON "edu_whatsapp_messages" ("institutionId", "patientId", "createdAt");

-- "¿Hay ya un recordatorio de esta cita?" — la consulta que hace el barrido
-- por cada tanda de citas, y la que usa la cancelación al reagendar.
CREATE INDEX IF NOT EXISTS "edu_whatsapp_messages_appt_idx"
  ON "edu_whatsapp_messages" ("institutionId", "appointmentId");

-- La cola: lo que quedó PENDING o FAILED y ya venció. Lo recorre el barrido
-- en cada tick para caducar lo que no puede salir a tiempo.
CREATE INDEX IF NOT EXISTS "edu_whatsapp_messages_cola_idx"
  ON "edu_whatsapp_messages" ("institutionId", "status", "scheduledFor");


-- ── 4. Llaves foráneas ─────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- envuelta en su bloque.
--
-- ⚠️ CASCADE vs SET NULL, y por qué no son todas iguales:
--   · CASCADE  → solo el instituto. Borrar un instituto entero —operación
--     de administración, no del panel— no se puede atorar en su
--     configuración de WhatsApp ni en su registro de envíos.
--   · SET NULL → TODO lo demás: el paciente, la cita, la carta, el cobro y
--     quien mandó. La constancia de un aviso tiene que sobrevivir a que se
--     borre aquello de lo que hablaba; para eso están congelados el nombre,
--     el teléfono y el texto en la propia fila.
--
-- 🔴 No hay ninguna FK en CASCADE hacia edu_patients, y es a propósito: si
-- la hubiera, borrar un paciente se llevaría por delante la prueba de que
-- se le avisó de su cita — que es exactamente el papel que alguien va a
-- pedir el día que haya un problema.

DO $edu$
BEGIN
  ALTER TABLE "edu_whatsapp_configs"
    ADD CONSTRAINT "edu_whatsapp_configs_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_whatsapp_messages"
    ADD CONSTRAINT "edu_whatsapp_messages_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_whatsapp_messages"
    ADD CONSTRAINT "edu_whatsapp_messages_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_whatsapp_messages"
    ADD CONSTRAINT "edu_whatsapp_messages_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "edu_appointments" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_whatsapp_messages"
    ADD CONSTRAINT "edu_whatsapp_messages_consentId_fkey"
    FOREIGN KEY ("consentId") REFERENCES "edu_consents" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_whatsapp_messages"
    ADD CONSTRAINT "edu_whatsapp_messages_chargeId_fkey"
    FOREIGN KEY ("chargeId") REFERENCES "edu_charges" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_whatsapp_messages"
    ADD CONSTRAINT "edu_whatsapp_messages_sentByUserId_fkey"
    FOREIGN KEY ("sentByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 5. Comprobación ────────────────────────────────────────────────────
-- Tiene que devolver 2 tablas y 2 tipos.

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('edu_whatsapp_configs', 'edu_whatsapp_messages')
ORDER BY table_name;

SELECT typname
FROM pg_type
WHERE typname IN ('EduWhatsappKind', 'EduWhatsappStatus')
ORDER BY typname;


-- ═══════════════════════════════════════════════════════════════════════
-- 6. BACKFILL DEL OVERRIDE DE PERMISOS  ⚠️ COMENTADO — LÉELO ANTES
--
-- 🔴 permissionsOverride REEMPLAZA al default del rol, no se suma. Así que
-- las dos keys nuevas de esta ola NO le llegan solas a quien ya tenga un
-- override guardado: esa persona abrirá el panel, no verá "WhatsApp" en el
-- menú, y desde fuera parecerá que la ola no se aplicó.
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
-- ⚠️ ES UN SOLO BLOQUE Y NO CUATRO: las dos keys son de DIRECCION y de
-- nadie más. No hay bloque para CAJA, ni para DOCENTE, ni para ALUMNO — y
-- eso NO les quita nada: mandarle un documento a un paciente no se abre con
-- estas keys, se abre con el permiso del documento ("consentimientos.view"
-- para la carta, "caja.view" para el recibo). Caja seguirá mandando recibos
-- y el alumno seguirá mandando cartas sin tocar una sola casilla de aquí.
--
-- 🔴 Y por qué solo dirección: "whatsapp.manage" entrega el token que manda
-- en nombre de la escuela y enciende avisos que Meta le cobra a SU tarjeta.
-- Es un gasto recurrente, no una preferencia de pantalla.
--
-- -- DIRECCION: las dos. Conecta la cuenta del instituto, registra las
-- -- plantillas y decide qué avisos salen y cuántas horas antes.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY['whatsapp.view', 'whatsapp.manage']::TEXT[]
--       )
--     )
-- WHERE "role" = 'DIRECCION'
--   AND cardinality("permissionsOverride") > 0;
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 7. CÓMO DEJARLO FUNCIONANDO (y cómo comprobarlo)
--
-- Todo lo de aquí abajo está COMENTADO a propósito: es el manual, no parte
-- de la migración.
--
-- ── a) El cron ─────────────────────────────────────────────────────────
-- La ruta ya existe: GET /api/instituto/cron/recordatorios (Bearer
-- CRON_SECRET). Falta DARLA DE ALTA en vercel.json, que está fuera de este
-- vertical y no se toca desde aquí. El bloque exacto está en el reporte de
-- ORQUESTA.md y es:
--
--   {
--     "path": "/api/instituto/cron/recordatorios",
--     "schedule": "*/15 * * * *"
--   }
--
-- Mientras tanto, el botón "Correr el barrido ahora" de /instituto/whatsapp
-- hace exactamente lo mismo para UN instituto.
--
-- ── b) Las plantillas, en Meta ─────────────────────────────────────────
-- 🔴 SIN PLANTILLA APROBADA, EL AVISO NO SALE Y NI SIQUIERA SE INTENTA.
-- Hay que darlas de alta en el Administrador de WhatsApp del INSTITUTO
-- (categoría UTILITY, idioma es_MX), con estos textos EXACTOS — los valores
-- viajan por POSICIÓN, así que una plantilla con otro número de variables
-- entrega el mensaje con los datos cambiados de sitio:
--
--   edu_recordatorio_cita
--     Hola {{1}}, le recordamos su cita en {{2}} el {{3}} a las {{4}}.
--     Si no puede asistir, avísenos respondiendo a este mensaje. Gracias.
--     ({{1}} paciente · {{2}} instituto · {{3}} fecha · {{4}} hora)
--
--   edu_consentimiento_firma
--     Hola {{1}}, {{2}} le comparte la carta de consentimiento informado de
--     {{3}} para que la lea y la firme desde su teléfono: {{4}} Si tiene
--     dudas, pregúntenos antes de firmar.
--     ({{1}} paciente · {{2}} instituto · {{3}} procedimiento · {{4}} liga)
--
--   edu_recibo_cobro
--     Hola {{1}}, aquí está su recibo de {{2}}: folio {{3}}, total {{4}}.
--     Saldo pendiente: {{5}}. Guárdelo como comprobante y avísenos si algo
--     no cuadra.
--     ({{1}} paciente · {{2}} instituto · {{3}} folio · {{4}} total ·
--      {{5}} saldo)
--
-- Después se registran sus nombres en /instituto/whatsapp y se aprieta
-- "Revisar en Meta", que es lo que trae el estado de verdad.
--
-- ── c) Comprobar la conexión de cada instituto ─────────────────────────
-- SELECT i."name",
--        c."connected",
--        c."billingOk",
--        c."remindersEnabled",
--        c."reminderHoursBefore",
--        c."templates",
--        c."lastErrorCode",
--        c."lastErrorMsg"
-- FROM "edu_whatsapp_configs" c
-- JOIN "edu_institutions" i ON i."id" = c."institutionId"
-- ORDER BY i."name";
--
-- 🔴 Si "lastErrorCode" es 131042 y "billingOk" es false, NO es un problema
-- del panel: la cuenta de WhatsApp de ese instituto no tiene método de pago
-- válido y Meta está rechazando los envíos. Se arregla en el Administrador
-- comercial de Meta. En cuanto haya tarjeta, el primer envío aceptado pone
-- "billingOk" en true solo.
--
-- ── d) Qué se ha mandado, y qué NO salió ───────────────────────────────
-- SELECT m."createdAt", i."name", m."kind", m."status",
--        m."toName", m."toPhone", m."errorCode", m."errorMsg"
-- FROM "edu_whatsapp_messages" m
-- JOIN "edu_institutions" i ON i."id" = m."institutionId"
-- WHERE m."status" <> 'SENT'
-- ORDER BY m."createdAt" DESC
-- LIMIT 100;
--
-- ⚠️ "SENT" significa que META LO ACEPTÓ, no que el teléfono lo recibió:
-- este vertical no ingiere los acuses de entrega. La pantalla lo dice con
-- esas palabras ("Entregado a WhatsApp").
--
-- ── e) Comprobar que reagendar cancela el recordatorio viejo ───────────
-- Es la regla que sostiene la ola. Después de mover una cita que ya tenía
-- aviso en cola, esto tiene que devolver la fila vieja en CANCELLED y —si
-- el barrido ya corrió para la hora nueva— una fila nueva con OTRA
-- "dedupeKey" (la llave lleva el "startsAt" dentro):
--
-- SELECT m."status", m."dedupeKey", m."scheduledFor", m."errorMsg"
-- FROM "edu_whatsapp_messages" m
-- WHERE m."appointmentId" = '<id de la cita>'
--   AND m."kind" = 'RECORDATORIO'
-- ORDER BY m."createdAt";
--
-- 🔴 Lo que NUNCA debe aparecer: dos filas PENDING con "dedupeKey"
-- distintas para la misma cita. Significaría que la cancelación al
-- reagendar no corrió, y el paciente recibiría la hora vieja y la nueva.
-- ═══════════════════════════════════════════════════════════════════════
