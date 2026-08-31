-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola 8 · LA CARTERA DE IA DEL INSTITUTO.
--
-- Va DESPUÉS de sql/edu-ola-0.sql, sql/edu-ola-1.sql, sql/edu-ola-2.sql y
-- sql/edu-ola-3.sql (necesita el enum "EduRole" y las tablas
-- "edu_institutions", "edu_users", "edu_cases" y "edu_studies"). Producto
-- SEPARADO del dental, que está VIVO en producción: este archivo NO toca
-- ni una tabla, ni una columna, ni una fila del dental, de barbería ni de
-- inmuebles.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   2 enums    · "EduAiFeature", "EduAiUnit"
--   3 tablas   · edu_ai_quotas, edu_ai_usage, edu_ai_prices
--   9 índices  · 2 únicos + 7 de consulta
--   6 llaves foráneas
--   2 filas de TARIFA (sección 7) — se insertan DE VERDAD, no comentadas
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
-- 🔴 QUÉ RESUELVE ESTA OLA
--
-- La Ola 3B dejó el dictado por voz y el análisis radiográfico APAGADOS
-- detrás de una variable de entorno, porque el instituto no tenía a qué
-- cargarle los tokens: el cobro del dental descuenta contra
-- "Clinic.aiTokensLimit" y un usuario de instituto no tiene fila de
-- clínica.
--
-- Aquí se le da su forma de pagar, y NO es la del dental. El instituto no
-- paga con Stripe: paga por CONTRATO ANUAL
-- ("edu_institutions"."contractStartsAt"/"contractEndsAt"), así que su IA
-- es un CUPO MENSUAL INCLUIDO en ese contrato, más lo que la escuela
-- decida permitir de más. Por eso aquí no hay "balance", ni "recarga", ni
-- "método de pago".
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 QUIÉN EDITA QUÉ — y por qué eso vive en el SERVIDOR, no en la pantalla
--
--   · "monthlyUsdCents" (lo que trae el contrato) NO se edita desde el
--     panel, con ningún permiso. Lo escribe DaleControl al firmar o
--     renovar — con la sección 8 de este archivo—, igual que
--     "contractEndsAt", que el panel también solo PINTA. La cuenta de API
--     que se consume es la de DaleControl: un formulario que dejara subir
--     ese número convertiría "lo que incluye tu contrato" en "lo que
--     alguien tecleó", y quien paga la factura no estaría en la
--     conversación. El endpoint PATCH lo RECHAZA con un mensaje, en vez de
--     ignorarlo en silencio.
--
--   · "allowOverage", "hardCapUsdCents", "isEnabled" y "contactNote" SÍ
--     los edita la dirección del instituto (permiso "ia.manage"). Es lo
--     que la ESCUELA decide, y ninguno de los cuatro puede AMPLIAR lo
--     incluido: solo autorizar excedente por encima, con un techo, a
--     sabiendas y con su nombre en la fila.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 LO QUE NO ESTÁ EN ESTE ARCHIVO, Y ES LA MITAD DE LA OLA
--
-- 1. NO HAY COLUMNA "consumido este mes". El consumo se CUENTA sumando
--    edu_ai_usage cada vez que alguien pregunta, exactamente como el
--    avance académico de la Ola 6 y por la misma razón: un contador
--    guardado se desincroniza el día que una escritura falle a la mitad, y
--    entonces o se le apaga la IA a una escuela que sí tenía cupo, o se le
--    regala el que ya gastó.
--
-- 2. NO HAY COLUMNA "estado del cupo". "Agotado" depende de la HORA (el
--    mes cambia): una columna guardada mentiría desde el segundo siguiente
--    a escribirla, igual que el estado del consentimiento de la Ola 3B.
--
-- 3. NO HAY NINGÚN PRECIO ESCRITO EN EL CÓDIGO. Los precios viven en
--    edu_ai_prices y la pantalla los LEE de ahí. Si no hay fila de tarifa
--    para el modelo que una función usa, esa función NO corre: cobrar cero
--    por algo que cuesta dinero es la forma de que el cupo mienta mientras
--    la factura del proveedor sube.
--
-- 4. NO HAY HISTORIAL DEL CUPO. "updatedByUserId"/"updatedByName" guardan
--    el ÚLTIMO cambio. Si algún día hace falta la historia, es una tabla
--    aparte y no una columna más.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 NOTA SOBRE LAS DOS UNIDADES DE DINERO — no es un descuido que convivan
--
--   · el PRESUPUESTO va en CENTAVOS de dólar enteros ("monthlyUsdCents",
--     "hardCapUsdCents"). Es lo que teclea una persona, y en INTEGER el
--     techo queda en 21 millones de dólares al mes en vez de 2 147 — que
--     es lo que daría un INTEGER de millonésimas.
--   · el MEDIDOR va en MILLONÉSIMAS de dólar ("costUsdMicros"), porque una
--     sola llamada cuesta fracciones de centavo y redondearla a centavos
--     la dejaría en cero. Es la misma unidad que ya usa
--     edu_study_analyses."costUsdMicros" desde la Ola 3B.
--
-- Ni NUMERIC ni DOUBLE PRECISION en ninguna de las dos: en coma flotante
-- 0,1 + 0,2 no da 0,3, y un reporte de gasto que no cuadra es un reporte
-- en el que nadie confía. Misma decisión que los centavos de la Ola 5 y
-- las calificaciones ×100 de la Ola 6.
--
-- 🔴 NOTA SOBRE LOS TIPOS DE FECHA — tampoco es un descuido:
--   · TIMESTAMP(3)   → sellos internos ("createdAt"/"updatedAt").
--   · "periodKey" es TEXTO ("2026-08"), no una fecha, y se calcula con la
--     ZONA DEL INSTITUTO al escribir la fila. Un dictado a las 23:30 del
--     31 de agosto en Tijuana son las 06:30 del 1 de septiembre en UTC:
--     agrupar por mes en SQL con la zona del servidor le comería a la
--     escuela cupo del mes que no era.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Enums ───────────────────────────────────────────────────────────

-- Las dos funciones de IA que consumen cupo.
DO $edu$
BEGIN
  CREATE TYPE "EduAiFeature" AS ENUM ('DICTADO', 'ANALISIS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- En qué se mide lo que consumió una llamada. Existe porque las dos
-- funciones NO se cobran igual: el análisis por TOKENS y el dictado por
-- SEGUNDOS de audio. Una tabla de tarifas que solo supiera de tokens no
-- podría ponerle precio al dictado, y el cupo de la escuela se lo estaría
-- comiendo gratis.
DO $edu$
BEGIN
  CREATE TYPE "EduAiUnit" AS ENUM ('TOKEN', 'SECOND');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 2. Tablas ──────────────────────────────────────────────────────────

-- EL CUPO DE IA DEL INSTITUTO. 1:1 — un instituto, un cupo.
--
-- 🔴 QUE ESTA FILA EXISTA ES EL INTERRUPTOR. Un instituto sin fila tiene
-- las dos funciones de IA apagadas, y la pantalla lo dice con todas sus
-- letras ("tu contrato todavía no incluye IA") en vez de enseñar un
-- micrófono muerto. Es el reemplazo de la variable EDU_IA_ENABLED de la
-- Ola 3B, que era global y no distinguía escuelas.
CREATE TABLE IF NOT EXISTS "edu_ai_quotas" (
  "id"              TEXT         NOT NULL,
  "institutionId"   TEXT         NOT NULL,
  -- Lo que el CONTRATO incluye cada mes, en centavos de dólar. NO se edita
  -- desde el panel (ver el encabezado).
  "monthlyUsdCents" INTEGER      NOT NULL DEFAULT 0,
  -- ¿La escuela autoriza seguir usando IA después de agotar lo incluido?
  -- Nace en false: lo seguro es parar, y quien decide gastar de más tiene
  -- que decirlo a propósito.
  "allowOverage"    BOOLEAN      NOT NULL DEFAULT false,
  -- El TOPE DURO cuando se permite excedente, en centavos. Obligatorio si
  -- "allowOverage" es true — lo exige la APLICACIÓN, no la base: un CHECK
  -- no podría dar el mensaje que dice POR QUÉ, y "permitido excederse sin
  -- tope" es exactamente la fuga que la Ola 3B se negó a abrir. Se ignora
  -- cuando "allowOverage" es false.
  "hardCapUsdCents" INTEGER,
  -- El apagador de la escuela. Nace encendido. Apagarlo NO borra el cupo.
  "isEnabled"       BOOLEAN      NOT NULL DEFAULT true,
  -- A quién pedirle más cupo, escrito por la escuela. Se pinta DENTRO del
  -- mensaje de cupo agotado: un alumno con el micrófono muerto y sin saber
  -- a quién preguntarle abre un ticket.
  "contactNote"     VARCHAR(300),
  -- QUIÉN tocó esto por última vez. Es el ÚLTIMO cambio, no la historia.
  "updatedByUserId" TEXT,
  "updatedByName"   VARCHAR(160),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_ai_quotas_pkey" PRIMARY KEY ("id")
);

-- UN RENGLÓN POR USO DE IA. Es el libro mayor del gasto: el consumo del
-- mes se CUENTA sumando estas filas, no se lee de ningún contador.
--
-- 🔴 SE ESCRIBE DESPUÉS DE GASTAR, NUNCA ANTES. El cupo se comprueba antes
-- de llamar al proveedor (y ahí es donde se dice que no), pero el renglón
-- se escribe con el costo REAL que devolvió la llamada. La consecuencia
-- hay que decirla: la ÚLTIMA llamada de un mes puede rebasar el techo por
-- lo que cueste esa llamada, porque nadie sabe cuánto va a costar hasta
-- que termina. El techo frena las llamadas que EMPIEZAN, no aborta una en
-- vuelo, y el rebase está acotado por el costo de UNA operación.
CREATE TABLE IF NOT EXISTS "edu_ai_usage" (
  "id"            TEXT           NOT NULL,
  "institutionId" TEXT           NOT NULL,
  "feature"       "EduAiFeature" NOT NULL,
  -- QUIÉN lo pidió. El id es opcional y con SET NULL —dar de baja a una
  -- persona no puede borrar el gasto que hizo— y el NOMBRE y el ROL van
  -- congelados: el desglose "por alumno y por docente" tiene que seguir
  -- diciendo lo que esa persona era cuando gastó.
  "userId"        TEXT,
  "userName"      VARCHAR(160)   NOT NULL,
  "userRole"      "EduRole"      NOT NULL,
  -- A QUÉ se aplicó. Los dos opcionales y solo uno se llena: el análisis
  -- cuelga de un estudio y el dictado de un caso (y de ninguno si la nota
  -- todavía no tiene caso, que es lo normal en el tamizaje).
  "studyId"       TEXT,
  "caseId"        TEXT,
  -- Cómo se llama eso, CONGELADO. Se guarda el texto además del id para
  -- poder leer el detalle sin JOIN y sin depender de que la fila de
  -- destino siga existiendo.
  "targetLabel"   VARCHAR(200),
  -- QUÉ se consumió. "model" es el modelo real que atendió la llamada:
  -- dentro de un año hay que poder contestar con qué se generó el gasto.
  "model"         VARCHAR(80)    NOT NULL,
  "unit"          "EduAiUnit"    NOT NULL,
  -- En el análisis son TOKENS (la entrada incluye lo escrito y lo leído de
  -- caché); en el dictado, "inputUnits" son los SEGUNDOS de audio y
  -- "outputUnits" es 0.
  "inputUnits"    INTEGER        NOT NULL DEFAULT 0,
  "outputUnits"   INTEGER        NOT NULL DEFAULT 0,
  -- Lo que costó, en MILLONÉSIMAS de dólar, con la tarifa VIGENTE en el
  -- momento de la llamada. Queda congelado: cambiar mañana el precio del
  -- modelo no puede reescribir lo que se gastó ayer, igual que el precio
  -- congelado de un cobro en la Ola 5.
  "costUsdMicros" INTEGER        NOT NULL DEFAULT 0,
  -- true = el proveedor no dijo cuánto había consumido y se cobró el TOPE
  -- de la operación. Se marca en vez de cobrar cero: regalar la llamada
  -- dejaría el cupo mintiendo, y cobrar de más en el único caso en que no
  -- sabemos es el error que no cuesta dinero. La pantalla lo señala.
  "isEstimated"   BOOLEAN        NOT NULL DEFAULT false,
  -- El mes al que se IMPUTA el gasto, calculado con la zona horaria del
  -- instituto al escribir la fila.
  --
  -- ⚠️ NO es un contador guardado —lo que la Ola 6 prohíbe— sino una
  -- ETIQUETA inmutable sobre una fila inmutable: el total se sigue
  -- contando sumando filas.
  "periodKey"     VARCHAR(7)     NOT NULL,
  "createdAt"     TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_ai_usage_pkey" PRIMARY KEY ("id")
);

-- LA TARIFA DE UN MODELO. Es la tabla que existe para que NO haya un solo
-- precio escrito en el código.
--
-- 🔴 SIN FILA NO HAY FUNCIÓN. Si el modelo que una función usa no tiene
-- tarifa aquí, esa función se apaga con su motivo. La alternativa —correr
-- y registrar costo cero— haría que el cupo de la escuela nunca bajara
-- mientras la factura del proveedor sí sube, que es el error caro.
--
-- ⚠️ ES LA ÚNICA TABLA DEL VERTICAL SIN "institutionId", y no es un
-- olvido: no es dato de un inquilino sino la TARIFA DEL PROVEEDOR, y el
-- proveedor cobra lo mismo llame quien llame — la cuenta de API es una
-- sola. Lo que sí varía por escuela es el CUPO, que es donde vive esa
-- variación. Ponerle un institutionId habría creado una segunda cosa que
-- mantener sincronizada y la pregunta "¿y si dos escuelas tienen precios
-- distintos para el mismo modelo?", que no tiene respuesta buena.
--
-- ⚠️ Cambiar un precio afecta a lo que se cobre A PARTIR de ese momento.
-- Lo ya gastado vive congelado en edu_ai_usage."costUsdMicros" y no se
-- recalcula nunca: subir la tarifa mañana no puede agotar el cupo de un
-- mes que ya se cerró.
CREATE TABLE IF NOT EXISTS "edu_ai_prices" (
  "id"                     TEXT           NOT NULL,
  "feature"                "EduAiFeature" NOT NULL,
  -- El identificador EXACTO del modelo, tal como se le manda al proveedor.
  "model"                  VARCHAR(80)    NOT NULL,
  "unit"                   "EduAiUnit"    NOT NULL,
  -- Precio en MILLONÉSIMAS de dólar por MILLÓN de unidades de entrada y de
  -- salida. La unidad la dice "unit".
  --
  -- Por qué "por millón" y no "por unidad": un token de entrada de
  -- claude-opus-5 cuesta 5 millonésimas y uno de salida 25 —en enteros por
  -- unidad se podría escribir—, pero un modelo más barato (0,25 USD por
  -- millón de tokens = 0,25 millonésimas por token) se redondearía a CERO.
  -- Con el factor de un millón, la tarifa pública del proveedor se copia
  -- tal cual: "5 USD por millón" son 5000000.
  "inUsdMicrosPerMillion"  INTEGER        NOT NULL DEFAULT 0,
  "outUsdMicrosPerMillion" INTEGER        NOT NULL DEFAULT 0,
  -- De dónde salió el número, para que quien lo revise dentro de un año
  -- sepa contra qué compararlo.
  "source"                 VARCHAR(200),
  "isActive"               BOOLEAN        NOT NULL DEFAULT true,
  "createdAt"              TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_ai_prices_pkey" PRIMARY KEY ("id")
);


-- ── 3. Índices ─────────────────────────────────────────────────────────

-- 1:1 con el instituto. Dos filas de cupo para la misma escuela serían dos
-- respuestas a "¿cuánto te queda?".
CREATE UNIQUE INDEX IF NOT EXISTS "edu_ai_quotas_institutionId_key"
  ON "edu_ai_quotas" ("institutionId");

-- El índice del CUPO: sumar el gasto del mes de un instituto. Es la
-- consulta que corre ANTES de cada llamada de IA, así que es la que más se
-- ejecuta de toda la ola.
CREATE INDEX IF NOT EXISTS "edu_ai_usage_periodo_idx"
  ON "edu_ai_usage" ("institutionId", "periodKey");

-- Los del DESGLOSE del panel: quién y en qué función se lo gastó.
CREATE INDEX IF NOT EXISTS "edu_ai_usage_persona_idx"
  ON "edu_ai_usage" ("institutionId", "periodKey", "userId");

CREATE INDEX IF NOT EXISTS "edu_ai_usage_funcion_idx"
  ON "edu_ai_usage" ("institutionId", "periodKey", "feature");

-- El del DETALLE, que se lee del más nuevo al más viejo.
CREATE INDEX IF NOT EXISTS "edu_ai_usage_reciente_idx"
  ON "edu_ai_usage" ("institutionId", "createdAt");

-- Para poder contestar "¿cuánto se ha gastado en ESTE estudio / caso?".
CREATE INDEX IF NOT EXISTS "edu_ai_usage_study_idx"
  ON "edu_ai_usage" ("institutionId", "studyId");

CREATE INDEX IF NOT EXISTS "edu_ai_usage_case_idx"
  ON "edu_ai_usage" ("institutionId", "caseId");

-- Un modelo tiene UNA tarifa por función. Dos filas serían dos precios
-- para la misma llamada, y quien las leyera tendría que desempatar.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_ai_prices_modelo_key"
  ON "edu_ai_prices" ("feature", "model");

CREATE INDEX IF NOT EXISTS "edu_ai_prices_funcion_idx"
  ON "edu_ai_prices" ("feature", "isActive");


-- ── 4. Llaves foráneas ─────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- envuelta en su bloque.
--
-- ⚠️ CASCADE vs SET NULL, y por qué no son todas iguales:
--   · CASCADE  → lo que pertenece al instituto (el cupo y cada renglón de
--     gasto). El producto NO borra nada de esto; el CASCADE está para que
--     borrar un instituto entero —operación de administración, no del
--     panel— no se atore.
--   · SET NULL → las referencias "hacia los lados": quién lo pidió, el
--     estudio o el caso al que se imputó, y quién tocó el cupo. Perder la
--     referencia es aceptable; perder el RENGLÓN DE GASTO, no. El texto
--     congelado ("userName", "targetLabel") sobrevive a esos NULL, que es
--     justamente para lo que está.
--
-- 🔴 Ninguna llave del gasto va en CASCADE hacia el usuario. Dar de baja a
-- un alumno que se graduó no puede borrar lo que consumió: el mes ya se
-- facturó, y un total que cambia al dar de baja a alguien es un total que
-- no se puede conciliar contra nada.

DO $edu$
BEGIN
  ALTER TABLE "edu_ai_quotas"
    ADD CONSTRAINT "edu_ai_quotas_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_ai_usage"
    ADD CONSTRAINT "edu_ai_usage_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_ai_usage"
    ADD CONSTRAINT "edu_ai_usage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_ai_usage"
    ADD CONSTRAINT "edu_ai_usage_studyId_fkey"
    FOREIGN KEY ("studyId") REFERENCES "edu_studies" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_ai_usage"
    ADD CONSTRAINT "edu_ai_usage_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "edu_cases" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_ai_quotas"
    ADD CONSTRAINT "edu_ai_quotas_updatedByUserId_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 5. Documentación en la propia base ─────────────────────────────────
-- COMMENT ON reemplaza el comentario anterior: es idempotente por sí solo.
COMMENT ON TABLE "edu_ai_quotas" IS
  'CUPO MENSUAL de IA del instituto, incluido en su CONTRATO (no hay Stripe ni recarga). Que esta fila EXISTA es el interruptor: sin ella, el dictado y el análisis están apagados y la pantalla dice por qué.';
COMMENT ON COLUMN "edu_ai_quotas"."monthlyUsdCents" IS
  'Lo que incluye el contrato, en centavos de dólar. NO se edita desde el panel con ningún permiso: la cuenta de API que se consume es la de DaleControl, y un formulario convertiría "lo que incluye tu contrato" en "lo que alguien tecleó". El PATCH del endpoint lo rechaza con un mensaje.';
COMMENT ON COLUMN "edu_ai_quotas"."hardCapUsdCents" IS
  'TOPE TOTAL del mes cuando allowOverage es true. Obligatorio en ese caso y tiene que ser MAYOR que monthlyUsdCents; lo valida la aplicación (un CHECK no podría explicar por qué). "Permitido excederse, sin tope" es la fuga que la Ola 3B se negó a abrir.';
COMMENT ON TABLE "edu_ai_usage" IS
  'LIBRO MAYOR del gasto de IA: un renglón por uso. El consumo del mes se CUENTA sumando estas filas — no hay ningún contador guardado que se pueda desincronizar, igual que el avance académico de la Ola 6.';
COMMENT ON COLUMN "edu_ai_usage"."periodKey" IS
  'El mes al que se imputa ("2026-08"), calculado con la ZONA DEL INSTITUTO al escribir la fila. No es un contador: es una etiqueta inmutable sobre una fila inmutable. Un dictado a las 23:30 del 31 de agosto en Tijuana son las 06:30 del 1 de septiembre en UTC.';
COMMENT ON COLUMN "edu_ai_usage"."costUsdMicros" IS
  'Millonésimas de dólar, con la tarifa VIGENTE al llamar. Queda congelado: cambiar el precio del modelo mañana no reescribe lo que se gastó ayer.';
COMMENT ON COLUMN "edu_ai_usage"."isEstimated" IS
  'El proveedor no dijo cuánto consumió y se cobró el TOPE de la operación. Se marca en vez de cobrar cero: regalar la llamada dejaría el cupo mintiendo, y cobrar de más en el único caso en que no sabemos es el error que no cuesta dinero.';
COMMENT ON TABLE "edu_ai_prices" IS
  'TARIFA del proveedor por modelo. Existe para que NO haya un solo precio escrito en el código: sin fila, la función se apaga en vez de correr sin poder descontarse del cupo. ÚNICA tabla del vertical sin institutionId — el proveedor cobra lo mismo llame quien llame.';
COMMENT ON COLUMN "edu_ai_prices"."inUsdMicrosPerMillion" IS
  'Millonésimas de dólar por MILLÓN de unidades de entrada. El factor de un millón permite copiar la tarifa pública tal cual ("5 USD por millón" = 5000000) sin que un modelo barato se redondee a cero.';


-- ═══════════════════════════════════════════════════════════════════════
-- 6. BACKFILL DEL OVERRIDE DE PERMISOS  ← LÉELO ANTES DE SEGUIR
--
-- 🔴 "permissionsOverride" REEMPLAZA al default del rol, no se suma. Es
-- decir: a quien YA tenga un override guardado, las DOS keys de esta ola
-- (ia.view, ia.manage) NO le llegan solas. Entrará al panel, no verá
-- "Consumo de IA" en el menú, y desde fuera parecerá que la ola no se
-- aplicó.
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
-- nadie más. Ni el docente ni el alumno ni CAJA reciben ninguna.
--
-- 🔴 Y ojo con CAJA, que es la que parece que debería llevarlas y no las
-- lleva: caja sí ve DINERO (es la única con "caja.view" además de
-- dirección), pero el dinero de caja es el que la escuela COBRA a sus
-- pacientes. El cupo de IA es un renglón del contrato con DaleControl: no
-- entra al corte, no se cobra en el mostrador y no cuadra con nada de lo
-- que caja concilia.
--
-- -- DIRECCION: las dos. Administra el contrato del instituto, así que
-- -- decide si se gasta de más del cupo que ese contrato incluye.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY['ia.view', 'ia.manage']::TEXT[]
--       )
--     )
-- WHERE "role" = 'DIRECCION'
--   AND cardinality("permissionsOverride") > 0;
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 7. LAS TARIFAS  ← ESTO SÍ SE EJECUTA, NO ESTÁ COMENTADO
--
-- Y es a propósito: sin tarifa, las dos funciones se apagan solas con el
-- motivo "falta configurar la tarifa de este modelo". No es dato de una
-- escuela —es lo que cobra el proveedor— así que forma parte de la
-- migración, igual que las tablas.
--
-- ⚠️ SI CAMBIAS EL MODELO EN EL CÓDIGO, TIENES QUE VENIR AQUÍ. Las claves
-- son EXACTAS: "whisper-1" es el que manda src/lib/integrations/whisper.ts
-- y "claude-opus-5" el de EDU_ANALISIS_MODEL en src/lib/edu/ia.ts. Un
-- modelo sin fila apaga su función en vez de cobrar mal — que es
-- exactamente cómo se quiere que falle.
--
-- ON CONFLICT DO NOTHING: correr el archivo dos veces no duplica ni pisa
-- una tarifa que alguien ya haya ajustado a mano.
--
-- ⚠️ PARA ACTUALIZAR UN PRECIO cuando el proveedor lo cambie, NO edites
-- estas líneas: corre un UPDATE (sección 9). Lo ya gastado queda congelado
-- en edu_ai_usage y no se recalcula.

-- DICTADO · Whisper cobra 0,006 USD por MINUTO de audio.
--   0,006 USD/min ÷ 60 = 0,0001 USD/segundo = 100 millonésimas/segundo
--   ×1 000 000 = 100000000 millonésimas por millón de segundos.
-- La salida va en 0: una transcripción no tiene tokens de salida que
-- facturar.
INSERT INTO "edu_ai_prices"
  ("id", "feature", "model", "unit",
   "inUsdMicrosPerMillion", "outUsdMicrosPerMillion", "source", "isActive")
VALUES
  ('eduaiprice_whisper1', 'DICTADO', 'whisper-1', 'SECOND',
   100000000, 0, 'Tarifa publica de OpenAI: 0.006 USD por minuto (ago-2026)', true)
ON CONFLICT ("feature", "model") DO NOTHING;

-- ANÁLISIS · claude-opus-5: 5 USD por millón de tokens de ENTRADA y 25 USD
-- por millón de tokens de SALIDA.
INSERT INTO "edu_ai_prices"
  ("id", "feature", "model", "unit",
   "inUsdMicrosPerMillion", "outUsdMicrosPerMillion", "source", "isActive")
VALUES
  ('eduaiprice_opus5', 'ANALISIS', 'claude-opus-5', 'TOKEN',
   5000000, 25000000, 'Tarifa publica de Anthropic (ago-2026)', true)
ON CONFLICT ("feature", "model") DO NOTHING;

-- Comprobación: las dos tarifas tienen que estar activas.
-- SELECT "feature", "model", "unit",
--        "inUsdMicrosPerMillion" / 1000000.0  AS usd_por_millon_entrada,
--        "outUsdMicrosPerMillion" / 1000000.0 AS usd_por_millon_salida
-- FROM "edu_ai_prices"
-- WHERE "isActive" = true
-- ORDER BY "feature";
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 8. EL CUPO INICIAL DEL INSTITUTO  ← COMENTADO: es dato de UNA escuela
--
-- Esto NO forma parte de la migración porque el número sale del CONTRATO
-- de cada instituto, y no hay un valor por defecto honesto: una escuela de
-- 20 alumnos y una de 300 no consumen lo mismo.
--
-- 🔴 Y ES EL ÚNICO SITIO DONDE SE ESCRIBE "monthlyUsdCents". El panel no
-- lo edita con ningún permiso (ver el encabezado de este archivo): se pone
-- aquí al firmar el contrato, y se cambia aquí al renovarlo.
--
-- Sustituye 'ieo' por el slug del instituto que creaste con edu-ola-0.sql.
--
-- ── Cuánto poner ───────────────────────────────────────────────────────
-- Con las tarifas de la sección 7, para hacerse una idea:
--   · un ANÁLISIS radiográfico ronda 0,05 USD (unos 20 por dólar);
--   · un MINUTO de dictado cuesta 0,006 USD (unos 165 por dólar).
-- Una escuela de 120 alumnos que analice 10 placas y dicte 60 minutos al
-- mes cada uno consume ~60 USD de análisis + ~43 USD de dictado ≈ 103 USD.
-- El primer mes conviene arrancar SIN excedente y mirar la pantalla de
-- Consumo de IA: es más fácil subir el cupo que explicar una factura.
--
-- INSERT INTO "edu_ai_quotas"
--   ("id", "institutionId", "monthlyUsdCents", "allowOverage",
--    "hardCapUsdCents", "isEnabled", "contactNote")
-- SELECT
--   'eduaiquota_' || i."id",
--   i."id",
--   5000,                  -- 50.00 USD al mes INCLUIDOS en el contrato
--   false,                 -- sin excedente: al agotarse, la IA se apaga
--   NULL,                  -- sin tope porque no hay excedente autorizado
--   true,
--   'Coordinación académica, ext. 214'
-- FROM "edu_institutions" i
-- WHERE i."slug" = 'ieo'
-- ON CONFLICT ("institutionId") DO NOTHING;
--
-- Comprobación de que quedó:
-- SELECT i."name",
--        q."monthlyUsdCents" / 100.0 AS incluido_usd,
--        q."allowOverage",
--        q."hardCapUsdCents" / 100.0 AS tope_usd,
--        q."isEnabled"
-- FROM "edu_ai_quotas" q
-- JOIN "edu_institutions" i ON i."id" = q."institutionId";
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 9. CONSULTAS ÚTILES  (todas comentadas: son herramientas, no migración)
--
-- ── Cuánto lleva gastado cada instituto ESTE MES ───────────────────────
-- El "periodKey" se calcula con la zona del instituto al escribir la fila,
-- así que agrupar por él NO necesita saber de zonas horarias aquí.
--
-- SELECT i."name",
--        u."periodKey",
--        COUNT(*)                        AS usos,
--        SUM(u."costUsdMicros") / 1000000.0 AS gastado_usd,
--        q."monthlyUsdCents" / 100.0     AS incluido_usd
-- FROM "edu_ai_usage" u
-- JOIN "edu_institutions" i ON i."id" = u."institutionId"
-- LEFT JOIN "edu_ai_quotas" q ON q."institutionId" = u."institutionId"
-- GROUP BY i."name", u."periodKey", q."monthlyUsdCents"
-- ORDER BY u."periodKey" DESC, gastado_usd DESC;
--
-- ── Quién se lo está gastando (el desglose del panel) ──────────────────
-- SELECT u."userName", u."userRole",
--        COUNT(*)                           AS usos,
--        SUM(u."costUsdMicros") / 1000000.0 AS gastado_usd
-- FROM "edu_ai_usage" u
-- WHERE u."institutionId" = 'PON_AQUI_EL_ID'
--   AND u."periodKey" = '2026-08'
-- GROUP BY u."userName", u."userRole"
-- ORDER BY gastado_usd DESC;
--
-- ── Quién está a punto de quedarse sin cupo ────────────────────────────
-- Es la consulta con la que se llama a una escuela ANTES de que se le
-- apague el micrófono, en vez de después.
--
-- SELECT i."name",
--        q."monthlyUsdCents" / 100.0 AS incluido_usd,
--        COALESCE(SUM(u."costUsdMicros"), 0) / 1000000.0 AS gastado_usd,
--        ROUND(
--          100.0 * COALESCE(SUM(u."costUsdMicros"), 0)
--          / NULLIF(q."monthlyUsdCents" * 10000, 0)
--        ) AS por_ciento
-- FROM "edu_ai_quotas" q
-- JOIN "edu_institutions" i ON i."id" = q."institutionId"
-- LEFT JOIN "edu_ai_usage" u
--        ON u."institutionId" = q."institutionId"
--       AND u."periodKey" = to_char(CURRENT_DATE, 'YYYY-MM')
-- WHERE q."isEnabled" = true
-- GROUP BY i."name", q."monthlyUsdCents"
-- HAVING COALESCE(SUM(u."costUsdMicros"), 0) > q."monthlyUsdCents" * 10000 * 0.8
-- ORDER BY por_ciento DESC;
--
-- ── Cambiar una tarifa cuando el proveedor la cambie ───────────────────
-- 🔴 Esto NO recalcula nada de lo ya gastado, y es lo correcto: el costo
-- vive congelado en cada renglón. Solo afecta a las llamadas siguientes.
--
-- UPDATE "edu_ai_prices"
-- SET "inUsdMicrosPerMillion"  = 5000000,
--     "outUsdMicrosPerMillion" = 25000000,
--     "source"    = 'Tarifa publica de Anthropic (revisada AAAA-MM)',
--     "updatedAt" = CURRENT_TIMESTAMP
-- WHERE "feature" = 'ANALISIS' AND "model" = 'claude-opus-5';
--
-- ── Usos con costo ESTIMADO (el proveedor no dijo cuánto consumió) ─────
-- Deberían ser cero o casi. Si salen muchos, algo cambió en la respuesta
-- del proveedor y se está cobrando el tope de más.
--
-- SELECT "periodKey", "feature", COUNT(*)
-- FROM "edu_ai_usage"
-- WHERE "isEstimated" = true
-- GROUP BY "periodKey", "feature"
-- ORDER BY "periodKey" DESC;
-- ═══════════════════════════════════════════════════════════════════════
