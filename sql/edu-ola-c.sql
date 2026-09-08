-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — OLA C · LA BASE.
--
-- 🔴 UN SOLO ARCHIVO PARA TODA LA OLA C. Cada .sql es un clic de Rafael en
-- Supabase, así que aquí va TODO lo que la ola necesita de base de datos:
-- el ARCO y la fusión de duplicados del paciente, la BITÁCORA (NOM-024),
-- el cuestionario de salud VERSIONADO, el plan de tratamiento, los
-- presupuestos, la salida de una receta RECHAZADA, el motivo de una nota
-- retirada, el libro de movimientos del odontograma, la sede del turno de
-- caja, el autor de un cambio de precio, los bloqueos de agenda, la
-- categoría de procedimiento con llave, el requisito versionado por
-- cohorte y el historial del cupo de IA.
--
-- Las PANTALLAS que se apoyan en todo esto llegan DESPUÉS, en la Ola C·2.
--
-- Va DESPUÉS de sql/edu-ola-0.sql … sql/edu-ola-b.sql. Necesita
-- "edu_institutions", "edu_users", "edu_patients", "edu_cases",
-- "edu_appointments", "edu_records", "edu_odontogram_entries",
-- "edu_prescriptions", "edu_charges", "edu_cash_sessions", "edu_campuses",
-- "edu_chairs", "edu_procedures", "edu_fee_schedules",
-- "edu_fee_schedule_items", "edu_requirements", "edu_cohorts" y
-- "edu_ai_quotas". El resto de las olas no importa: nada de aquí las toca.
--
-- Producto SEPARADO del dental, que está VIVO en producción: este archivo
-- NO toca ni una tabla, ni una columna, ni una fila del dental, de
-- barbería ni de inmuebles. En particular NO toca "patients", "quotes",
-- "quote_items", "treatment_plans", "treatment_sessions",
-- "health_questionnaires" ni "audit_logs", que son del dental y tienen sus
-- propias filas.
--
-- ⛔ SOLO AÑADE. Cero DROP, cero RENAME, cero ALTER de tipo, cero borrado
-- de datos. Ninguna columna que ya exista cambia de nombre, de tipo ni de
-- nulabilidad. Todo lo nuevo es NULLABLE o trae DEFAULT, así que el código
-- que ya está desplegado sigue compilando y corriendo sin tocarlo.
--
-- (La ÚNICA excepción está al FINAL del archivo, COMENTADA y sin aplicar:
-- el índice único PARCIAL del odontograma, que exige un DROP INDEX. No se
-- ejecuta nada de eso sin una decisión escrita de Rafael. Ver §14.)
--
-- IDEMPOTENTE: CREATE TABLE IF NOT EXISTS · ADD COLUMN IF NOT EXISTS ·
-- CREATE INDEX IF NOT EXISTS · ALTER TYPE … ADD VALUE IF NOT EXISTS · los
-- enums y las llaves foráneas envueltos en DO $edu$ … EXCEPTION WHEN
-- duplicate_object. Correrlo dos veces no falla y no cambia nada la
-- segunda vez.
--
-- Contenido:
--   4 enums    · "EduTreatmentPlanStatus", "EduQuoteStatus",
--                "EduAgendaBlockKind", "EduOdontogramEventAction"
--   1 valor    · "ARCHIVADA" en el enum "EduPrescriptionStatus" que ya existe
--  11 tablas   · edu_audit_logs · edu_health_questionnaires ·
--                edu_treatment_plans · edu_treatment_sessions ·
--                edu_quotes · edu_quote_items · edu_agenda_blocks ·
--                edu_odontogram_events · edu_procedure_categories ·
--                edu_requirement_versions · edu_ai_quota_changes
--  37 columnas · en 12 tablas que ya existen:
--                edu_patients 8 (ARCO + fusión) · edu_records 1
--                (deleteReason) · edu_prescriptions 4 (archivado) ·
--                edu_cash_sessions 2 (campusId + desglose) ·
--                edu_procedures 3 · edu_fee_schedules 2 ·
--                edu_fee_schedule_items 6 · edu_requirements 1 ·
--                edu_users 5 (lo que pidió ws2-t1 en su punto 6.1) ·
--                edu_rubric_criteria 1 · edu_ai_prices 2 ·
--                edu_requirements +2 (lo que pidió ws2-t3 en su 6a)
--  32 índices  · 27 de las 11 tablas nuevas, uno en edu_cash_sessions,
--                otro en edu_procedures, y los TRES únicos PARCIALES que
--                pidió ws2-t3 (§12.9 — leer el aviso: imponen una regla
--                sobre los datos que ya están)
--  56 FK       · las de las 11 tablas nuevas, más las 13 de las columnas
--                nuevas de arriba
--   0 backfill · NINGUNO hace falta. 28 de las 29 columnas nuevas de
--                tablas que ya existen son NULLABLE, y ese NULL significa
--                exactamente lo que la fila significaba antes de esta ola
--                ("sin sede" = el turno del instituto, "sin categoría con
--                llave" = la de texto libre de siempre). La 29ª
--                ("permissionsOverridePrevious") es NOT NULL con
--                DEFAULT '{}', que es su propio backfill: un array vacío
--                es justo lo que le toca a toda fila que ya exista. Igual
--                "edu_rubric_criteria"."isActive", NOT NULL DEFAULT true.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run. Es la ÚNICA fuente
-- de verdad del SQL del vertical; las mismas tablas y columnas están en
-- prisma/schema.prisma, así que un `prisma db push` no se las lleva.
--
-- 🔴 APLICARLO ANTES DEL DEPLOY DE LA OLA C. Si Prisma lee una columna que
-- todavía no existe, TODA lectura de esa tabla revienta — y de
-- edu_patients cuelga la sesión entera.
--
-- Nota sobre $$: delimitador con nombre, $edu$, y NUNCA bloques DO
-- anidados — el parser SQL de Supabase rompe con $$ anidado.
--
-- Nota sobre los nombres: las columnas van en camelCase ENTRECOMILLADO
-- porque así las escribe Prisma; sin comillas Postgres las bajaría a
-- minúsculas y el cliente dejaría de encontrarlas.
--
-- 🔴 NOTA SOBRE LOS TIPOS DE FECHA — no es un descuido que convivan dos,
-- es la misma regla de la Ola B:
--   · TIMESTAMP(3)   → sellos internos ("createdAt"/"updatedAt").
--   · TIMESTAMPTZ(3) → los INSTANTES que se ordenan, se comparan y se
--     imprimen ("createdAt" de la bitácora, "recordedAt", "startsAt",
--     "validUntil", "acceptedAt", "deletedAt", "anonymizedAt"…). Una
--     escuela puede tener un campus en Tijuana y otro en Mérida.
--
-- 🔴 NOTA SOBRE EL DINERO: centavos ENTEROS, como toda la Ola 5 del
-- vertical (edu_charges, edu_fee_schedule_items, edu_cash_sessions). El
-- dental usa NUMERIC(10,2) en "quotes"; aquí NO se copia eso. Mezclar dos
-- representaciones de dinero en el mismo producto es cómo se llega a un
-- presupuesto que no cuadra con el cobro que generó. La ÚNICA columna
-- NUMERIC de este archivo es "discountPct", que es un porcentaje y no
-- dinero.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 LAS SIETE DECISIONES DE ESTA OLA, Y DÓNDE ESTÁN ESCRITAS
--
-- 1. UN PACIENTE NO SE BORRA NUNCA, Y ESO NO CAMBIA CON EL ARCO. La
--    NOM-004 obliga a conservar el expediente CINCO AÑOS desde el último
--    acto médico, y una solicitud de cancelación de datos no derrota a esa
--    obligación. Lo que esta ola añade es la ANONIMIZACIÓN: sustituir el
--    PII (nombre, teléfono, correo, domicilio, CURP, tutor, seguro) por
--    marcadores y CONSERVAR lo clínico. Por eso son "deletedAt" (baja
--    lógica) y "anonymizedAt" (sustitución del PII) y no un DELETE.
--
-- 2. LA FUSIÓN MUEVE, NO BORRA. El duplicado (el PERDEDOR) apunta al
--    GANADOR con "mergedIntoId", queda en INACTIVE, y sus ocho colecciones
--    —citas, casos, notas, estudios, fotos, consentimientos, recetas y
--    cobros— se REASIGNAN al ganador en UNA transacción. La fila del
--    perdedor se queda como constancia de que ese folio existió.
--
-- 3. LA BITÁCORA REGISTRA TAMBIÉN LAS LECTURAS. La NOM-024 §6.3.5 pide
--    poder contestar quién ABRIÓ un expediente, no solo quién lo escribió.
--    El dental ya lo hace; edu_audit_logs es lo que le permite al
--    instituto hacerlo igual. Y tiene UN SOLO ESCRITOR (eduAudit, en
--    src/lib/edu/auditoria.ts): doce sitios escribiéndola a mano es cómo
--    se llega a que el decimotercero no la escriba.
--
-- 4. EL CUESTIONARIO ES UNA FILA POR VERSIÓN, NUNCA UN UPDATE. Hoy los
--    antecedentes se escriben encima de la propia fila del paciente, así
--    que "¿qué contestó ANTES de la extracción?" no tiene respuesta. Y el
--    merge a la ficha es ADITIVO y va en la MISMA transacción: un
--    cuestionario que llega a medias no puede vaciarle las alergias a
--    nadie.
--
-- 5. VENCIDO NO SE GUARDA. El estado de un presupuesto vencido se DERIVA
--    de "validUntil" contra el reloj. Un estado que hay que ir a escribir
--    con un cron es un estado que se queda mal el día que el cron no
--    corre. Por eso el enum "EduQuoteStatus" NO tiene VENCIDO.
--
-- 6. EL RASTRO DEL ODONTOGRAMA ES UNA TABLA DE MOVIMIENTOS, NO UN DROP
--    INDEX. El índice único del hallazgo es de cinco columnas y NO es
--    parcial, así que remarcar REVIVE la misma fila y pisa quién la había
--    quitado (N-3). Hacerlo parcial exige DROP INDEX sobre una base viva;
--    edu_odontogram_events lo resuelve SIN borrar nada. La otra salida
--    queda escrita y COMENTADA en la §14, para que Rafael decida.
--
-- 7. LAS COLUMNAS NUEVAS DE TABLAS VIVAS SON NULLABLE (O TRAEN DEFAULT),
--    Y ESO ES EL BACKFILL. Un turno de caja sin "campusId" es "el turno
--    del instituto", que es exactamente lo que son todos los que ya
--    existen; un procedimiento sin "categoryId" sigue agrupándose por su
--    texto libre de siempre. La única NOT NULL es
--    "permissionsOverridePrevious", con DEFAULT '{}' — y un array vacío es
--    justo lo que le toca a toda fila que ya exista. Aplicar esta ola no
--    cambia el comportamiento de ni una fila que ya esté en la base.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 1. LOS ENUMS NUEVOS
--
-- Cuatro. Cada uno en su bloque DO con EXCEPTION WHEN duplicate_object:
-- CREATE TYPE no acepta IF NOT EXISTS en Postgres.
-- ═══════════════════════════════════════════════════════════════════════

-- En qué va un plan de tratamiento. NO se deriva del avance: un plan con
-- todas sus sesiones hechas sigue ACTIVO hasta que alguien lo cierra,
-- porque cerrar es un acto con autor y fecha. ABANDONADO es lo que le pasa
-- al paciente que dejó de venir, y distinguirlo de COMPLETADO es media
-- estadística de una escuela.
DO $edu$
BEGIN
  CREATE TYPE "EduTreatmentPlanStatus" AS ENUM (
    'ACTIVO', 'PAUSADO', 'COMPLETADO', 'ABANDONADO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- En qué va un presupuesto. SIN "VENCIDO" a propósito — ver la decisión 5
-- del encabezado: se deriva de "validUntil" contra el reloj.
DO $edu$
BEGIN
  CREATE TYPE "EduQuoteStatus" AS ENUM (
    'BORRADOR', 'PRESENTADO', 'ACEPTADO', 'RECHAZADO', 'CANCELADO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- Por qué está cerrada la agenda. Es lo que se PINTA en la rejilla y lo
-- que se le dice a quien intenta agendar ahí.
DO $edu$
BEGIN
  CREATE TYPE "EduAgendaBlockKind" AS ENUM (
    'FESTIVO', 'PUENTE', 'MANTENIMIENTO', 'OTRO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- Qué se hizo con el hallazgo del odontograma.
DO $edu$
BEGIN
  CREATE TYPE "EduOdontogramEventAction" AS ENUM (
    'MARCA', 'QUITA', 'REVIVE', 'EDITA'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. UN VALOR MÁS EN UN ENUM QUE YA EXISTE — "ARCHIVADA"
--
-- H-24: una receta que el docente RECHAZÓ se quedaba en la lista del
-- alumno PARA SIEMPRE. `EDU_PRESCRIPTION_TRANSITIONS.RECHAZADA` era `[]`
-- (src/lib/edu/types.ts) y el propio código lo documentaba como pendiente:
-- no había ninguna salida.
--
-- ARCHIVADA la saca de la vista de trabajo SIN borrarla: la propuesta
-- existió, el docente dijo que no y por qué, y las dos cosas se siguen
-- pudiendo leer. Las cuatro columnas del archivado van en la §11.
--
-- 🔴 ESTO NO BORRA NI RENOMBRA NADA. `ALTER TYPE … ADD VALUE` solo AÑADE
-- una etiqueta al final del enum; los cinco valores que ya existen se
-- quedan con su mismo nombre y su mismo orden, y ninguna fila cambia.
--
-- 🔴 `IF NOT EXISTS` lo hace idempotente (Postgres 12+; Supabase corre 15).
-- Y el valor NO se usa en este mismo archivo a propósito: Postgres no deja
-- usar una etiqueta nueva en la misma transacción que la crea.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TYPE "EduPrescriptionStatus" ADD VALUE IF NOT EXISTS 'ARCHIVADA';


-- ═══════════════════════════════════════════════════════════════════════
-- 3. LA BITÁCORA — edu_audit_logs (NOM-024)
--
-- Espejo funcional del `audit_logs` del dental, en SU PROPIA TABLA: los
-- dos productos no comparten ni una fila. Contesta cuatro preguntas y no
-- más, y por eso tiene cuatro índices:
--   · "¿qué pasó en esta escuela?"           (institutionId, createdAt)
--   · "¿quién abrió ESTE expediente?"        (institutionId, patientId, …)
--   · "¿qué hizo ESTA persona?"              (institutionId, actorUserId, …)
--   · "¿qué le pasó a ESTA fila?"            (institutionId, entity, entityId)
--
-- 🔴 "actorUserId" es OPCIONAL con SET NULL y el NOMBRE va congelado al
-- lado, igual que en edu_ai_usages y en edu_consents: dar de baja a
-- alguien no puede borrar el rastro de lo que hizo. Y "actorRole" guarda
-- el rol QUE TENÍA en ese momento — ascender a alguien mañana no puede
-- reescribir con qué sombrero hizo algo ayer.
--
-- 🔴 "before"/"after" son JSONB y no texto: lo que se lee después es un
-- diff campo a campo, no un párrafo. Los dos en NULL = fue una LECTURA.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "edu_audit_logs" (
  "id"            TEXT           NOT NULL,
  "institutionId" TEXT           NOT NULL,

  "actorUserId"   TEXT,
  "actorName"     VARCHAR(160)   NOT NULL,
  "actorRole"     VARCHAR(20)    NOT NULL,

  "action"        VARCHAR(40)    NOT NULL,
  "entity"        VARCHAR(40)    NOT NULL,
  -- Opcional: una lectura de LISTA no tiene una fila concreta.
  "entityId"      TEXT,

  -- El PACIENTE al que toca, denormalizado a propósito y con su propio
  -- índice: "el historial de este expediente" es la consulta que la NOM
  -- obliga a poder contestar, y sacarla de "entityId" exigiría saber de
  -- qué tabla es cada fila.
  "patientId"     TEXT,

  "before"        JSONB,
  "after"         JSONB,

  "ip"            VARCHAR(60),
  "userAgent"     VARCHAR(300),

  "createdAt"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "edu_audit_logs_institucion_idx"
  ON "edu_audit_logs" ("institutionId", "createdAt");

CREATE INDEX IF NOT EXISTS "edu_audit_logs_paciente_idx"
  ON "edu_audit_logs" ("institutionId", "patientId", "createdAt");

CREATE INDEX IF NOT EXISTS "edu_audit_logs_actor_idx"
  ON "edu_audit_logs" ("institutionId", "actorUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "edu_audit_logs_entidad_idx"
  ON "edu_audit_logs" ("institutionId", "entity", "entityId");

DO $edu$
BEGIN
  ALTER TABLE "edu_audit_logs"
    ADD CONSTRAINT "edu_audit_logs_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_audit_logs"
    ADD CONSTRAINT "edu_audit_logs_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_audit_logs"
    ADD CONSTRAINT "edu_audit_logs_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 4. EL CUESTIONARIO DE SALUD VERSIONADO — edu_health_questionnaires
--
-- Fila 7 del informe ws2-t1: el dental guarda una VERSIÓN NUEVA cada vez,
-- calcula las banderas de riesgo en el servidor y hace merge aditivo a la
-- ficha; instituto escribe encima de la propia fila del paciente, sin
-- versionado, sin historial y sin banderas.
--
-- 🔴 CADA GUARDADO ES UNA FILA NUEVA, NUNCA UN UPDATE. La pregunta clínica
-- no es "¿qué contestó?", es "¿qué contestó ANTES de la extracción?". Un
-- UPDATE la deja sin respuesta para siempre.
--
-- 🔴 "answers" es JSONB y no una columna por pregunta: el cuestionario de
-- una escuela de ortodoncia no es el de una de prótesis, y una columna por
-- pregunta convertiría cada cambio de formulario en una migración.
--
-- 🔴 "riskFlags" lo calcula el SERVIDOR sobre esas respuestas, en cada
-- versión. Una bandera que manda el cliente es una bandera que el cliente
-- puede no mandar.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "edu_health_questionnaires" (
  "id"             TEXT           NOT NULL,
  "institutionId"  TEXT           NOT NULL,
  "patientId"      TEXT           NOT NULL,

  -- 1, 2, 3… POR PACIENTE. Lo calcula el servidor dentro de la misma
  -- transacción que inserta; el cliente no lo manda.
  "version"        INTEGER        NOT NULL,

  "answers"        JSONB          NOT NULL,
  "riskFlags"      JSONB          NOT NULL,
  "notes"          VARCHAR(2000),

  "recordedById"   TEXT,
  "recordedByName" VARCHAR(160)   NOT NULL,
  "recordedAt"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "createdAt"      TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_health_questionnaires_pkey" PRIMARY KEY ("id")
);

-- Dos versiones 3 del mismo paciente serían dos respuestas a "¿qué decía
-- la 3?". Y este índice único es también el candado del doble clic: la
-- transacción que inserta calcula MAX(version)+1 y aquí choca si dos
-- guardados corren a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_health_questionnaires_version_key"
  ON "edu_health_questionnaires" ("patientId", "version");

CREATE INDEX IF NOT EXISTS "edu_health_questionnaires_paciente_idx"
  ON "edu_health_questionnaires" ("institutionId", "patientId", "recordedAt");

DO $edu$
BEGIN
  ALTER TABLE "edu_health_questionnaires"
    ADD CONSTRAINT "edu_health_questionnaires_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_health_questionnaires"
    ADD CONSTRAINT "edu_health_questionnaires_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_health_questionnaires"
    ADD CONSTRAINT "edu_health_questionnaires_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 5. EL PLAN DE TRATAMIENTO — edu_treatment_plans + edu_treatment_sessions
--
-- Fila 25 del informe ws2-t1: `EduCase` cubre "qué caso y de quién", pero
-- no hay un plan por paciente con sesiones y avance. Estas dos tablas son
-- eso, y nada más.
--
-- 🔴 EL PLAN CUELGA DEL PACIENTE Y, OPCIONALMENTE, DEL CASO. El caso es
-- "esta especialidad con este alumno"; el plan es el recorrido clínico. Un
-- plan sin caso existe (la valoración inicial propone un plan antes de que
-- haya alumno asignado); un caso sin plan también.
--
-- 🔴 EL AVANCE NO SE GUARDA EN NINGUNA COLUMNA: se CUENTA sumando las
-- filas de edu_treatment_sessions con "completedAt" no nulo, igual que la
-- cuota de almacenamiento y el cupo de IA. Un contador guardado se
-- desincroniza el día que una escritura falle a la mitad.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "edu_treatment_plans" (
  "id"                  TEXT                     NOT NULL,
  "institutionId"       TEXT                     NOT NULL,
  "patientId"           TEXT                     NOT NULL,
  "caseId"              TEXT,

  "name"                VARCHAR(160)             NOT NULL,
  "description"         VARCHAR(2000),

  -- La ESTIMACIÓN con la que se abre. El avance real lo cuentan las
  -- sesiones.
  "totalSessions"       INTEGER                  NOT NULL DEFAULT 1,
  "sessionIntervalDays" INTEGER                  NOT NULL DEFAULT 30,

  -- Centavos enteros, como todo el dinero del vertical.
  "totalCents"          INTEGER                  NOT NULL DEFAULT 0,

  "status"              "EduTreatmentPlanStatus" NOT NULL DEFAULT 'ACTIVO',

  "startsAt"            TIMESTAMPTZ(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- La fecha ESPERADA de cierre y la del cierre REAL. Dos columnas porque
  -- son dos preguntas distintas.
  "expectedEndAt"       TIMESTAMPTZ(3),
  "closedAt"            TIMESTAMPTZ(3),
  "nextExpectedAt"      TIMESTAMPTZ(3),

  "createdById"         TEXT,
  "createdByName"       VARCHAR(160)             NOT NULL,
  "closedById"          TEXT,
  "closeReason"         VARCHAR(500),

  "createdAt"           TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_treatment_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "edu_treatment_plans_paciente_idx"
  ON "edu_treatment_plans" ("institutionId", "patientId", "status");

CREATE INDEX IF NOT EXISTS "edu_treatment_plans_caso_idx"
  ON "edu_treatment_plans" ("institutionId", "caseId");

-- El SEGUIMIENTO: "qué planes activos tienen su próxima sesión vencida".
-- Sin este índice, esa consulta recorre todos los planes de la escuela.
CREATE INDEX IF NOT EXISTS "edu_treatment_plans_seguimiento_idx"
  ON "edu_treatment_plans" ("institutionId", "status", "nextExpectedAt");

DO $edu$
BEGIN
  ALTER TABLE "edu_treatment_plans"
    ADD CONSTRAINT "edu_treatment_plans_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_treatment_plans"
    ADD CONSTRAINT "edu_treatment_plans_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_treatment_plans"
    ADD CONSTRAINT "edu_treatment_plans_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "edu_cases" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_treatment_plans"
    ADD CONSTRAINT "edu_treatment_plans_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_treatment_plans"
    ADD CONSTRAINT "edu_treatment_plans_closedById_fkey"
    FOREIGN KEY ("closedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- UNA SESIÓN del plan. "completedAt" null = todavía no se hizo.
CREATE TABLE IF NOT EXISTS "edu_treatment_sessions" (
  "id"            TEXT           NOT NULL,
  "institutionId" TEXT           NOT NULL,
  "planId"        TEXT           NOT NULL,

  "sessionNumber" INTEGER        NOT NULL,
  "notes"         VARCHAR(2000),

  -- La CITA en la que se hizo, si hubo. SET NULL: cancelar una cita no
  -- puede borrar la sesión que la documenta.
  "appointmentId" TEXT,

  "completedAt"   TIMESTAMPTZ(3),
  "completedById" TEXT,

  "createdAt"     TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_treatment_sessions_pkey" PRIMARY KEY ("id")
);

-- Dos "sesión 3" del mismo plan serían dos respuestas a "¿qué se hizo en
-- la tercera?".
CREATE UNIQUE INDEX IF NOT EXISTS "edu_treatment_sessions_numero_key"
  ON "edu_treatment_sessions" ("planId", "sessionNumber");

CREATE INDEX IF NOT EXISTS "edu_treatment_sessions_plan_idx"
  ON "edu_treatment_sessions" ("institutionId", "planId");

DO $edu$
BEGIN
  ALTER TABLE "edu_treatment_sessions"
    ADD CONSTRAINT "edu_treatment_sessions_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_treatment_sessions"
    ADD CONSTRAINT "edu_treatment_sessions_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "edu_treatment_plans" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_treatment_sessions"
    ADD CONSTRAINT "edu_treatment_sessions_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "edu_appointments" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_treatment_sessions"
    ADD CONSTRAINT "edu_treatment_sessions_completedById_fkey"
    FOREIGN KEY ("completedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 6. LOS PRESUPUESTOS — edu_quotes + edu_quote_items
--
-- Fila 26 del informe ws2-t1: NO existe `EduQuote`. Lo más parecido es la
-- etapa de autorización PLAN, que es un gate de firma sin partidas ni
-- importe.
--
-- 🔴 ES DINERO, y por eso lo lee el alcance del DINERO (recurso "charges"
-- de src/lib/edu/visibility.ts): caja y dirección. El alumno que propone
-- el tratamiento NO ve el presupuesto, igual que no ve el cobro ni el
-- saldo. Eso no lo decide esta tabla: lo decide el alcance.
--
-- 🔴 LOS IMPORTES SE CONGELAN. Cada partida guarda su "name" y su
-- "unitPriceCents" COPIADOS del tarifario, no un JOIN: un presupuesto
-- presentado que cambia de total cuando la dirección sube un precio no es
-- un presupuesto.
--
-- 🔴 "chargeId" y "treatmentPlanId" SON LA LLAVE DE IDEMPOTENCIA de la
-- conversión aguas abajo. Que la columna esté llena es lo que impide que
-- dos clics sean dos cobros — el mismo patrón que "idempotencyKey" de
-- edu_charges.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "edu_quotes" (
  "id"                TEXT             NOT NULL,
  "institutionId"     TEXT             NOT NULL,
  "patientId"         TEXT             NOT NULL,
  "caseId"            TEXT,

  "folio"             VARCHAR(30)      NOT NULL,
  "title"             VARCHAR(160)     NOT NULL,

  "status"            "EduQuoteStatus" NOT NULL DEFAULT 'BORRADOR',

  -- Hasta cuándo vale. NULL = sin vencimiento.
  "validUntil"        TIMESTAMPTZ(3),

  -- Centavos enteros. "discountPct" es el porcentaje que se tecleó y
  -- "discountCents" lo que ese porcentaje valió: se guardan los DOS
  -- porque el porcentaje es lo que se explica y los centavos lo que se
  -- cobra. Es la ÚNICA columna NUMERIC del archivo, y no es dinero.
  "subtotalCents"     INTEGER          NOT NULL DEFAULT 0,
  "discountPct"       NUMERIC(5,2),
  "discountCents"     INTEGER          NOT NULL DEFAULT 0,
  "totalCents"        INTEGER          NOT NULL DEFAULT 0,

  "notes"             VARCHAR(2000),

  -- El TOKEN público de aceptación. Solo existe desde que se presenta, y
  -- es único en toda la base: es una URL que sale del instituto.
  "acceptToken"       VARCHAR(64),

  "presentedAt"       TIMESTAMPTZ(3),
  "acceptedAt"        TIMESTAMPTZ(3),
  "rejectedAt"        TIMESTAMPTZ(3),
  -- Quién aceptó y la evidencia — mismo trío que edu_consents y
  -- edu_prescriptions: hash del texto canónico, IP y navegador.
  "acceptedByName"    VARCHAR(160),
  "acceptedHash"      VARCHAR(64),
  "acceptedIp"        VARCHAR(60),
  "acceptedUserAgent" VARCHAR(300),

  "chargeId"          TEXT,
  "treatmentPlanId"   TEXT,

  "cancelledAt"       TIMESTAMPTZ(3),
  "cancelReason"      VARCHAR(500),

  "createdById"       TEXT,
  "createdByName"     VARCHAR(160)     NOT NULL,

  "createdAt"         TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_quotes_pkey" PRIMARY KEY ("id")
);

-- El folio es del INSTITUTO y único dentro de él, como el del paciente y
-- como el de la factura.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_quotes_folio_key"
  ON "edu_quotes" ("institutionId", "folio");

-- El token es único en TODA la base y no por instituto: es lo que llega
-- por URL, sin sesión y sin saber de qué escuela viene. Dos institutos con
-- el mismo token sería una carta de aceptación que abre la del otro.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_quotes_token_key"
  ON "edu_quotes" ("acceptToken");

CREATE INDEX IF NOT EXISTS "edu_quotes_paciente_idx"
  ON "edu_quotes" ("institutionId", "patientId", "status");

-- "los presentados que están por vencer", que es la lista que trabaja
-- caja. Sin este índice recorre todos los presupuestos de la escuela.
CREATE INDEX IF NOT EXISTS "edu_quotes_vigencia_idx"
  ON "edu_quotes" ("institutionId", "status", "validUntil");

DO $edu$
BEGIN
  ALTER TABLE "edu_quotes"
    ADD CONSTRAINT "edu_quotes_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_quotes"
    ADD CONSTRAINT "edu_quotes_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_quotes"
    ADD CONSTRAINT "edu_quotes_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "edu_cases" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_quotes"
    ADD CONSTRAINT "edu_quotes_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_quotes"
    ADD CONSTRAINT "edu_quotes_chargeId_fkey"
    FOREIGN KEY ("chargeId") REFERENCES "edu_charges" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_quotes"
    ADD CONSTRAINT "edu_quotes_treatmentPlanId_fkey"
    FOREIGN KEY ("treatmentPlanId") REFERENCES "edu_treatment_plans" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- UNA PARTIDA. El nombre y el precio van COPIADOS del tarifario a
-- propósito (ver el encabezado de arriba).
CREATE TABLE IF NOT EXISTS "edu_quote_items" (
  "id"             TEXT         NOT NULL,
  "institutionId"  TEXT         NOT NULL,
  "quoteId"        TEXT         NOT NULL,
  -- SET NULL: desactivar un procedimiento no puede vaciar un presupuesto
  -- ya presentado.
  "procedureId"    TEXT,

  "name"           VARCHAR(160) NOT NULL,
  -- Dientes FDI en CSV ("11,12,21"), como en el dental. Opcional.
  "toothFdi"       VARCHAR(60),

  "quantity"       INTEGER      NOT NULL DEFAULT 1,
  "unitPriceCents" INTEGER      NOT NULL,
  "discountCents"  INTEGER      NOT NULL DEFAULT 0,
  "lineTotalCents" INTEGER      NOT NULL,

  -- Fase 1..n para agrupar en el PDF y para partir el plan en etapas.
  "phase"          INTEGER,
  "notes"          VARCHAR(500),
  "sortOrder"      INTEGER      NOT NULL DEFAULT 0,

  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_quote_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "edu_quote_items_presupuesto_idx"
  ON "edu_quote_items" ("institutionId", "quoteId", "sortOrder");

DO $edu$
BEGIN
  ALTER TABLE "edu_quote_items"
    ADD CONSTRAINT "edu_quote_items_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_quote_items"
    ADD CONSTRAINT "edu_quote_items_quoteId_fkey"
    FOREIGN KEY ("quoteId") REFERENCES "edu_quotes" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_quote_items"
    ADD CONSTRAINT "edu_quote_items_procedureId_fkey"
    FOREIGN KEY ("procedureId") REFERENCES "edu_procedures" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 7. LOS BLOQUEOS DE AGENDA — edu_agenda_blocks (H-19)
--
-- «No existe el BLOQUEO: no hay forma de cerrar un puente ni de sacar un
-- sillón por mantenimiento. No hay ningún modelo de cierre/festivo en el
-- schema. El sillón 7 se descompone el martes: o cambias el horario
-- semanal (y afecta TODOS los martes), o das de baja el sillón (que no
-- cancela nada). La agenda ofrece huecos que no existen.» Es el hueco que
-- el informe llama "el más caro de la lista".
--
-- 🔴 EL ALCANCE LO DA LO QUE ESTÉ EN NULL, y es toda la tabla en una línea:
--   · sin sede y sin sillón → el INSTITUTO entero (un festivo nacional);
--   · con sede y sin sillón → esa SEDE (el puente del campus norte);
--   · con sillón            → ese SILLÓN (el 7 en mantenimiento).
--
-- ⚠️ NO CANCELA LAS CITAS QUE YA ESTÁN. Bloquear es cerrar el hueco para
-- lo que venga; lo que ya estaba agendado se reagenda a mano, con su aviso
-- al paciente. Un bloqueo que cancela citas en cascada es una pantalla que
-- borra la tarde de alguien sin que nadie lo decida.
--
-- ⚠️ Y NO SE BORRA: se retira con "deletedAt", como todo lo de la Ola B.
-- Un bloqueo que existió explica por qué esa tarde no hubo nadie.
--
-- 🔴 "startsAt"/"endsAt" son INSTANTES (TIMESTAMPTZ) y no horas de pared
-- como edu_chair_schedules: un bloqueo se compara contra las CITAS, que
-- son instantes. La conversión desde lo que teclea la pantalla usa la zona
-- de la SEDE (src/lib/edu/campus.ts).
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "edu_agenda_blocks" (
  "id"            TEXT                 NOT NULL,
  "institutionId" TEXT                 NOT NULL,
  -- NULL = todas las sedes.
  "campusId"      TEXT,
  -- NULL = todos los sillones (de esa sede, o del instituto).
  "chairId"       TEXT,

  "kind"          "EduAgendaBlockKind" NOT NULL DEFAULT 'OTRO',
  -- Obligatorio: un hueco cerrado sin motivo es una llamada de teléfono.
  "reason"        VARCHAR(200)         NOT NULL,

  "startsAt"      TIMESTAMPTZ(3)       NOT NULL,
  "endsAt"        TIMESTAMPTZ(3)       NOT NULL,

  "createdById"   TEXT,
  "createdByName" VARCHAR(160)         NOT NULL,

  "deletedAt"     TIMESTAMPTZ(3),
  "deletedById"   TEXT,

  "createdAt"     TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_agenda_blocks_pkey" PRIMARY KEY ("id")
);

-- La consulta de la rejilla: "los bloqueos que solapan ESTE día".
CREATE INDEX IF NOT EXISTS "edu_agenda_blocks_rango_idx"
  ON "edu_agenda_blocks" ("institutionId", "startsAt", "endsAt");

CREATE INDEX IF NOT EXISTS "edu_agenda_blocks_sede_idx"
  ON "edu_agenda_blocks" ("institutionId", "campusId", "startsAt");

CREATE INDEX IF NOT EXISTS "edu_agenda_blocks_sillon_idx"
  ON "edu_agenda_blocks" ("institutionId", "chairId", "startsAt");

DO $edu$
BEGIN
  ALTER TABLE "edu_agenda_blocks"
    ADD CONSTRAINT "edu_agenda_blocks_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_agenda_blocks"
    ADD CONSTRAINT "edu_agenda_blocks_campusId_fkey"
    FOREIGN KEY ("campusId") REFERENCES "edu_campuses" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_agenda_blocks"
    ADD CONSTRAINT "edu_agenda_blocks_chairId_fkey"
    FOREIGN KEY ("chairId") REFERENCES "edu_chairs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_agenda_blocks"
    ADD CONSTRAINT "edu_agenda_blocks_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_agenda_blocks"
    ADD CONSTRAINT "edu_agenda_blocks_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 8. EL LIBRO DE MOVIMIENTOS DEL ODONTOGRAMA — edu_odontogram_events (N-3)
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 POR QUÉ EXISTE ESTA TABLA, Y POR QUÉ NO ES UNA COLUMNA MÁS
--
-- La Ola B cambió el DELETE del odontograma por una baja lógica (H-17), y
-- la auditoría de la ficha encontró que se deshace sola:
--
--   ortodoncia marca caries en 16-O → endodoncia la quita ("deletedAt",
--   "deletedById") → ortodoncia la vuelve a marcar → el upsert cae en
--   `update` y escribe "deletedById" = NULL SOBRE LA MISMA FILA.
--
-- En base queda un hallazgo vivo firmado por ortodoncia y NINGUNA huella
-- de que endodoncia lo borró. Y no es un descuido del código: el índice
-- único "edu_odontogram_hallazgo_key" es de CINCO columnas y NO es
-- parcial, así que una fila dada de baja SIGUE OCUPANDO su clave e
-- insertar una segunda choca. El código REVIVE la fila porque es lo único
-- que la base le deja hacer.
--
-- Había dos salidas:
--   (a) hacer PARCIAL ese índice (WHERE "deletedAt" IS NULL) para poder
--       insertar una segunda fila. Eso es DROP INDEX + CREATE INDEX sobre
--       una base viva, y en esta ola no se borra nada sin que Rafael lo
--       decida. Queda escrita y COMENTADA en la §14.
--   (b) esta tabla: un libro de MOVIMIENTOS, una fila POR ACTO, puramente
--       aditivo, que sobrevive a que la fila del hallazgo se reviva mil
--       veces. El `update` del upsert pisa "deletedById", pero no puede
--       tocar lo que ya se escribió aquí.
--
-- Se eligió (b), y (a) queda para que Rafael decida.
-- ═══════════════════════════════════════════════════════════════════════
--
-- ⚠️ "entryId" es OPCIONAL con SET NULL y las tres columnas del hallazgo
-- van COPIADAS: el movimiento tiene que poder leerse aunque la fila del
-- hallazgo desaparezca algún día. Un libro de movimientos que depende de
-- que exista lo que registra no es un libro de movimientos.

CREATE TABLE IF NOT EXISTS "edu_odontogram_events" (
  "id"            TEXT                       NOT NULL,
  "institutionId" TEXT                       NOT NULL,
  "patientId"     TEXT                       NOT NULL,
  "entryId"       TEXT,

  -- Copia del hallazgo, para que el renglón sea autosuficiente.
  "tooth"         INTEGER                    NOT NULL,
  "surface"       VARCHAR(4)                 NOT NULL DEFAULT '',
  "condition"     VARCHAR(40)                NOT NULL,

  "action"        "EduOdontogramEventAction" NOT NULL,

  "notes"         VARCHAR(1000),
  "reason"        VARCHAR(500),

  "actorUserId"   TEXT,
  "actorName"     VARCHAR(160)               NOT NULL,

  "createdAt"     TIMESTAMPTZ(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_odontogram_events_pkey" PRIMARY KEY ("id")
);

-- "el historial del odontograma de este paciente", más recientes primero.
CREATE INDEX IF NOT EXISTS "edu_odontogram_events_paciente_idx"
  ON "edu_odontogram_events" ("institutionId", "patientId", "createdAt");

-- "qué le ha pasado a ESTE hallazgo": es la pregunta de N-3, y se contesta
-- por las cinco columnas del hallazgo y no por "entryId", porque el
-- movimiento tiene que sobrevivir a que la fila se vaya.
CREATE INDEX IF NOT EXISTS "edu_odontogram_events_hallazgo_idx"
  ON "edu_odontogram_events" ("institutionId", "patientId", "tooth", "surface", "condition");

DO $edu$
BEGIN
  ALTER TABLE "edu_odontogram_events"
    ADD CONSTRAINT "edu_odontogram_events_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_odontogram_events"
    ADD CONSTRAINT "edu_odontogram_events_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_odontogram_events"
    ADD CONSTRAINT "edu_odontogram_events_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "edu_odontogram_entries" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_odontogram_events"
    ADD CONSTRAINT "edu_odontogram_events_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 9. LA CATEGORÍA DE PROCEDIMIENTO COMO ENTIDAD — edu_procedure_categories
--    (H-90)
--
-- «Un requisito por CATEGORÍA es texto libre sin llave. Renombrar la
-- categoría en el catálogo pone el avance a cero EN SILENCIO para toda la
-- especialidad. Y un dedazo al capturarlo cuenta 0 desde el primer día,
-- sin que la pantalla distinga "0 porque nadie lo ha hecho" de "0 porque
-- la categoría no existe".»
--
-- 🔴 NO SUSTITUYE al texto libre. "edu_procedures"."category" y
-- "edu_requirements"."category" se quedan EXACTAMENTE como están: no se
-- renombran, no se borran, no se migran. Lo que esta tabla añade es la
-- LLAVE, en dos columnas nuevas ("categoryId") que conviven con ellas.
-- Migrar el texto a la llave es una decisión de producto y de datos, no de
-- este archivo: cada escuela agrupa distinto y nadie puede adivinar cuáles
-- de sus cadenas son la misma categoría.
--
-- ⚠️ NO SE BORRA: se desactiva, como los sillones, las especialidades y
-- las sedes. Y los dos "categoryId" van con SET NULL, no con CASCADE:
-- desactivar una categoría no puede llevarse por delante un procedimiento
-- del tarifario.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "edu_procedure_categories" (
  "id"              TEXT         NOT NULL,
  "institutionId"   TEXT         NOT NULL,

  "name"            VARCHAR(60)  NOT NULL,
  -- La clave corta y estable ("endodoncia"). Es lo que NO cambia cuando
  -- la dirección renombra la categoría.
  "key"             VARCHAR(40)  NOT NULL,

  "isActive"        BOOLEAN      NOT NULL DEFAULT true,
  "orderIndex"      INTEGER      NOT NULL DEFAULT 0,

  "updatedByUserId" TEXT,
  "updatedByName"   VARCHAR(160),

  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_procedure_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "edu_procedure_categories_key"
  ON "edu_procedure_categories" ("institutionId", "key");

CREATE INDEX IF NOT EXISTS "edu_procedure_categories_orden_idx"
  ON "edu_procedure_categories" ("institutionId", "isActive", "orderIndex");

DO $edu$
BEGIN
  ALTER TABLE "edu_procedure_categories"
    ADD CONSTRAINT "edu_procedure_categories_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_procedure_categories"
    ADD CONSTRAINT "edu_procedure_categories_updatedByUserId_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 10. EL REQUISITO VERSIONADO POR COHORTE — edu_requirement_versions
--     (H-89)
--
-- «Subir el mínimo de un requisito a mitad de generación reescribe el
-- pasado de todo el mundo, sin versión y sin rastro. De 8 a 12 en marzo y
-- TODA la escuela —incluida la que se gradúa en junio— pasa de "Cumplido 8
-- de 8" a "Te faltan 4 de 12". El alumno lo ve esa tarde, sin explicación
-- y sin fecha.»
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 POR QUÉ UNA TABLA APARTE Y NO COLUMNAS EN edu_requirements
--
-- El arreglo natural sería "version" + "cohortId" DENTRO de
-- edu_requirements… pero esa tabla tiene
-- UNIQUE ("institutionId", "programId", "name") y dos versiones del mismo
-- requisito chocan contra él. Cambiar ese índice es DROP INDEX, y en esta
-- ola no se borra nada. (La alternativa con DROP queda escrita y
-- COMENTADA en la §14, junto con la del odontograma.)
--
-- Así que la fila de edu_requirements se queda como LA VIGENTE —que es lo
-- que todo el código de evaluación ya lee, sin cambiar una línea— y cada
-- cambio escribe aquí una versión con su cohorte, su fecha de vigencia y
-- su autor. El avance de un alumno se mide contra la versión que aplicaba
-- a SU generación.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "edu_requirement_versions" (
  "id"            TEXT           NOT NULL,
  "institutionId" TEXT           NOT NULL,
  "requirementId" TEXT           NOT NULL,

  "version"       INTEGER        NOT NULL,

  -- La GENERACIÓN a la que aplica. NULL = a todas las que no tengan una
  -- propia (la regla general).
  "cohortId"      TEXT,

  -- La foto de lo que decía el requisito en esta versión. Se copia entera
  -- a propósito: leer la versión no puede depender de que la fila viva no
  -- haya cambiado desde entonces.
  "requiredCount" INTEGER        NOT NULL,
  "semesterFrom"  INTEGER,
  "semesterTo"    INTEGER,
  "onlyCompleted" BOOLEAN        NOT NULL DEFAULT true,
  "notes"         VARCHAR(300),

  "effectiveFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "createdById"   TEXT,
  "createdByName" VARCHAR(160)   NOT NULL,

  "createdAt"     TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_requirement_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "edu_requirement_versions_version_key"
  ON "edu_requirement_versions" ("requirementId", "version");

CREATE INDEX IF NOT EXISTS "edu_requirement_versions_vigencia_idx"
  ON "edu_requirement_versions" ("institutionId", "requirementId", "effectiveFrom");

CREATE INDEX IF NOT EXISTS "edu_requirement_versions_cohorte_idx"
  ON "edu_requirement_versions" ("institutionId", "cohortId");

DO $edu$
BEGIN
  ALTER TABLE "edu_requirement_versions"
    ADD CONSTRAINT "edu_requirement_versions_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_requirement_versions"
    ADD CONSTRAINT "edu_requirement_versions_requirementId_fkey"
    FOREIGN KEY ("requirementId") REFERENCES "edu_requirements" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_requirement_versions"
    ADD CONSTRAINT "edu_requirement_versions_cohortId_fkey"
    FOREIGN KEY ("cohortId") REFERENCES "edu_cohorts" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_requirement_versions"
    ADD CONSTRAINT "edu_requirement_versions_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 11. EL HISTORIAL DEL CUPO DE IA — edu_ai_quota_changes
--
-- El propio edu_ai_quotas lo dejó escrito en el esquema: «guarda el ÚLTIMO
-- cambio, no la historia: si algún día hace falta la historia del cupo, es
-- una tabla aparte y no una columna más». Ésta es esa tabla.
--
-- Encender el excedente y subir el tope duro son decisiones que cuestan
-- dinero real de la escuela, y "quién lo subió y cuándo" no se contesta
-- con dos columnas que se pisan en cada guardado.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "edu_ai_quota_changes" (
  "id"            TEXT           NOT NULL,
  "institutionId" TEXT           NOT NULL,

  -- La foto ANTES y DESPUÉS, campo a campo. JSONB y no columnas: el día
  -- que el cupo gane un campo, esta tabla no cambia. "before" NULL = fue
  -- el alta de la fila de cupo.
  "before"        JSONB,
  "after"         JSONB          NOT NULL,

  "changedById"   TEXT,
  "changedByName" VARCHAR(160)   NOT NULL,

  "createdAt"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_ai_quota_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "edu_ai_quota_changes_institucion_idx"
  ON "edu_ai_quota_changes" ("institutionId", "createdAt");

DO $edu$
BEGIN
  ALTER TABLE "edu_ai_quota_changes"
    ADD CONSTRAINT "edu_ai_quota_changes_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_ai_quota_changes"
    ADD CONSTRAINT "edu_ai_quota_changes_changedById_fkey"
    FOREIGN KEY ("changedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 12. LAS COLUMNAS NUEVAS DE LAS TABLAS QUE YA EXISTEN
--
-- Ocho tablas, 24 columnas, TODAS nullables o con default. Ese NULL ES el
-- backfill: significa exactamente lo que la fila significaba antes de esta
-- ola. Aplicarla no cambia el comportamiento de ni una fila que ya esté en
-- la base.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 12.1 · edu_patients — ARCO (LFPDPPP) Y LA FUSIÓN DE DUPLICADOS ─────
--
-- Fila 31 del informe ws2-t1: instituto SÍ da de baja por estado
-- (INACTIVE/DISCHARGED) y el código explica que un paciente no se borra.
-- Lo que NO existe es la ANONIMIZACIÓN del PII: a una solicitud ARCO hoy
-- no se le puede responder.
--
-- 🔴 UN PACIENTE NO SE BORRA NUNCA, Y ESO NO CAMBIA. La NOM-004 obliga a
-- conservar el expediente CINCO AÑOS desde el último acto médico, y una
-- solicitud de cancelación no derrota a esa obligación. Lo que sí se puede
-- hacer es ANONIMIZAR: sustituir el PII (nombre, teléfono, correo,
-- domicilio, CURP, tutor, seguro) por marcadores y CONSERVAR lo clínico.
-- QUÉ campos se sustituyen está escrito en UN sitio y solo en uno:
-- EDU_ARCO_PII_FIELDS, en src/lib/edu/arco-core.ts.
--
-- 🔴 "deletedAt" es una baja LÓGICA: la fila sigue, sus citas siguen, sus
-- cobros siguen. Las consultas la esconden; la base la conserva.
--
-- 🔴 H-05 · LA FUSIÓN. "mergedIntoId" apunta del PERDEDOR al GANADOR. El
-- perdedor queda además en INACTIVE y NO se borra: sus ocho colecciones
-- (citas, casos, notas, estudios, fotos, consentimientos, recetas y
-- cobros) se REASIGNAN al ganador en UNA transacción, y la fila se queda
-- como constancia de que ese folio existió.
ALTER TABLE "edu_patients" ADD COLUMN IF NOT EXISTS "deletedAt"      TIMESTAMPTZ(3);
ALTER TABLE "edu_patients" ADD COLUMN IF NOT EXISTS "deletedById"    TEXT;
ALTER TABLE "edu_patients" ADD COLUMN IF NOT EXISTS "deleteReason"   VARCHAR(500);
ALTER TABLE "edu_patients" ADD COLUMN IF NOT EXISTS "anonymizedAt"   TIMESTAMPTZ(3);
ALTER TABLE "edu_patients" ADD COLUMN IF NOT EXISTS "anonymizedById" TEXT;
ALTER TABLE "edu_patients" ADD COLUMN IF NOT EXISTS "mergedIntoId"   TEXT;
ALTER TABLE "edu_patients" ADD COLUMN IF NOT EXISTS "mergedAt"       TIMESTAMPTZ(3);
ALTER TABLE "edu_patients" ADD COLUMN IF NOT EXISTS "mergedById"     TEXT;

DO $edu$
BEGIN
  ALTER TABLE "edu_patients"
    ADD CONSTRAINT "edu_patients_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_patients"
    ADD CONSTRAINT "edu_patients_anonymizedById_fkey"
    FOREIGN KEY ("anonymizedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_patients"
    ADD CONSTRAINT "edu_patients_mergedById_fkey"
    FOREIGN KEY ("mergedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- La FK a sí misma. SET NULL: si algún día el ganador desapareciera, el
-- perdedor se queda sin puntero pero NO se borra.
DO $edu$
BEGIN
  ALTER TABLE "edu_patients"
    ADD CONSTRAINT "edu_patients_mergedIntoId_fkey"
    FOREIGN KEY ("mergedIntoId") REFERENCES "edu_patients" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 12.2 · edu_records — EL MOTIVO DE UNA NOTA RETIRADA ────────────────
--
-- La Ola B dejó "deleteReason" fuera POR ESCRITO («retirar un borrador
-- vacío no es un acto clínico que haya que justificar, y un campo de
-- motivo obligatorio en el sitio equivocado solo produce "asdf"»), y la
-- auditoría de la ficha pidió lo contrario: la columna existe para el caso
-- que NO es el borrador vacío —la nota escrita en el paciente
-- equivocado—, donde lo único que contesta la pregunta de dentro de un año
-- es el texto.
--
-- 🔴 SIGUE SIENDO OPCIONAL, y eso no es indecisión: obligarlo en el
-- borrador vacío es como se producen quinientos "asdf". Quién lo exige y
-- cuándo lo decide el endpoint, no la base.
--
-- ⚠️ Y NO abre la puerta a retirar una nota FIRMADA. Una firmada no se
-- edita ni se borra: se corrige con otra que la referencia ("correctsId").
-- El candado del status lo pone la casilla del expediente.
ALTER TABLE "edu_records" ADD COLUMN IF NOT EXISTS "deleteReason" VARCHAR(500);


-- ── 12.3 · edu_prescriptions — LA SALIDA DE UNA RECHAZADA (H-24) ───────
--
-- Las mismas cuatro columnas que la anulación —fecha, quién, su nombre
-- congelado y el motivo—, y NO se reutilizan las de la anulación: se ANULA
-- lo expedido y se ARCHIVA lo rechazado, y dos actos distintos compartiendo
-- columna es cómo se pierde cuál de los dos ocurrió.
ALTER TABLE "edu_prescriptions" ADD COLUMN IF NOT EXISTS "archivedAt"       TIMESTAMPTZ(3);
ALTER TABLE "edu_prescriptions" ADD COLUMN IF NOT EXISTS "archivedByUserId" TEXT;
ALTER TABLE "edu_prescriptions" ADD COLUMN IF NOT EXISTS "archivedByName"   VARCHAR(160);
ALTER TABLE "edu_prescriptions" ADD COLUMN IF NOT EXISTS "archiveReason"    VARCHAR(500);

DO $edu$
BEGIN
  ALTER TABLE "edu_prescriptions"
    ADD CONSTRAINT "edu_prescriptions_archivedByUserId_fkey"
    FOREIGN KEY ("archivedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 12.4 · edu_cash_sessions — LA SEDE Y EL DESGLOSE (H-09, H-53) ──────
--
-- H-09: hoy el turno es del INSTITUTO. `getEduOpenCashSession` busca UNO
-- abierto por "institutionId", así que el campus Sur no puede abrir el
-- suyo mientras Norte tenga el suyo, cobra con el "cashSessionId" de
-- Norte, y al cerrar el sistema le exige a Norte el efectivo de las DOS
-- sedes. El corte dice «faltaron $8,400» todos los días.
--
-- 🔴 NULLABLE, Y ESE NULL ES EL BACKFILL. Un turno sin sede es "el turno
-- del instituto", que es exactamente lo que son todos los que ya existen.
-- La LÓGICA que abre un turno POR SEDE la pone la casilla de caja
-- (src/lib/edu/caja.ts); aquí solo va la columna.
--
-- H-53: el desglose por método se CALCULA para el turno abierto y SE
-- PIERDE al cerrar. JSONB y no ocho columnas: EduPaymentMethod es un enum
-- que crece, y una columna por método convertiría cada método nuevo en una
-- migración. La FORMA de este JSON y su validación viven en
-- src/lib/edu/caja-cierre-core.ts, no en la base. Se escribe UNA vez, en
-- la transacción que cierra el turno: es la foto congelada del corte.
ALTER TABLE "edu_cash_sessions" ADD COLUMN IF NOT EXISTS "campusId"        TEXT;
ALTER TABLE "edu_cash_sessions" ADD COLUMN IF NOT EXISTS "methodBreakdown" JSONB;

-- "el turno abierto de ESTA sede", que es la consulta que hoy no se puede
-- hacer y por la que H-09 existe.
CREATE INDEX IF NOT EXISTS "edu_cash_sessions_sede_idx"
  ON "edu_cash_sessions" ("institutionId", "campusId", "closedAt");

-- RESTRICT y no CASCADE: una sede con turnos de caja no se va ni por
-- accidente, igual que una con sillones.
DO $edu$
BEGIN
  ALTER TABLE "edu_cash_sessions"
    ADD CONSTRAINT "edu_cash_sessions_campusId_fkey"
    FOREIGN KEY ("campusId") REFERENCES "edu_campuses" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 12.5 · EL TARIFARIO — AUTOR Y FECHA DEL PRECIO (H-76) ──────────────
--
-- «Nadie sabe quién cambió un precio ni cuándo. Los tres modelos del
-- tarifario no guardan autor, mientras el cobro sí guarda quién cobró y la
-- factura quién la emitió. En febrero la resina costaba $800 y hoy $1,200:
-- no se puede contestar quién lo subió.»
--
-- Son los TRES modelos, no solo el del precio: renombrar una lista y
-- desactivar un procedimiento también son decisiones de dinero.
--
-- 🔴 "priceSetAt" va APARTE de "updatedAt" a propósito: "updatedAt" lo
-- mueve cualquier escritura sobre la fila, y lo que hay que poder
-- contestar es cuándo cambió EL PRECIO.
--
-- ⚠️ Esto NO arregla la otra mitad de H-76 (vaciar el campo del precio
-- hace un DELETE físico de la fila, tarifas.ts:1271-1275). Eso es lógica
-- de src/lib/edu/tarifas.ts, que es de otra casilla de esta ola; aquí van
-- las columnas que ese arreglo necesita.
ALTER TABLE "edu_procedures"          ADD COLUMN IF NOT EXISTS "categoryId"      TEXT;
ALTER TABLE "edu_procedures"          ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;
ALTER TABLE "edu_procedures"          ADD COLUMN IF NOT EXISTS "updatedByName"   VARCHAR(160);

ALTER TABLE "edu_fee_schedules"       ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;
ALTER TABLE "edu_fee_schedules"       ADD COLUMN IF NOT EXISTS "updatedByName"   VARCHAR(160);

ALTER TABLE "edu_fee_schedule_items"  ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "edu_fee_schedule_items"  ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;
ALTER TABLE "edu_fee_schedule_items"  ADD COLUMN IF NOT EXISTS "updatedByName"   VARCHAR(160);
ALTER TABLE "edu_fee_schedule_items"  ADD COLUMN IF NOT EXISTS "priceSetAt"      TIMESTAMPTZ(3);

-- LA BAJA LÓGICA DEL PRECIO (lo pidió ws2-t2 en su punto 6). Es la otra
-- mitad de H-76: vaciar el campo del precio hace hoy un DELETE FÍSICO de
-- la fila (`setEduProcedurePrices`, en tarifas.ts).
--
-- ⚠️ CONSECUENCIA QUE HAY QUE DECIR, y es la misma trampa del odontograma:
-- el índice único (feeScheduleId, procedureId) NO es parcial, así que una
-- fila dada de baja SIGUE OCUPANDO su clave. Volver a poner ese precio
-- tiene que REVIVIR esa misma fila (upsert), no insertar otra.
ALTER TABLE "edu_fee_schedule_items"  ADD COLUMN IF NOT EXISTS "deletedAt"       TIMESTAMPTZ(3);
ALTER TABLE "edu_fee_schedule_items"  ADD COLUMN IF NOT EXISTS "deletedById"     TEXT;

-- El tarifario agrupado por la categoría CON LLAVE (H-90).
CREATE INDEX IF NOT EXISTS "edu_procedures_categoria_ref_idx"
  ON "edu_procedures" ("institutionId", "categoryId");

DO $edu$
BEGIN
  ALTER TABLE "edu_procedures"
    ADD CONSTRAINT "edu_procedures_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "edu_procedure_categories" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_procedures"
    ADD CONSTRAINT "edu_procedures_updatedByUserId_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_fee_schedules"
    ADD CONSTRAINT "edu_fee_schedules_updatedByUserId_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_fee_schedule_items"
    ADD CONSTRAINT "edu_fee_schedule_items_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_fee_schedule_items"
    ADD CONSTRAINT "edu_fee_schedule_items_updatedByUserId_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_fee_schedule_items"
    ADD CONSTRAINT "edu_fee_schedule_items_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 12.6 · edu_requirements — LA CATEGORÍA CON LLAVE (H-90) ────────────
--
-- "category" (texto libre) se queda intacta al lado. Renombrar la
-- categoría deja de poner el avance a cero en silencio en cuanto el
-- requisito la compare por id.
ALTER TABLE "edu_requirements" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;

DO $edu$
BEGIN
  ALTER TABLE "edu_requirements"
    ADD CONSTRAINT "edu_requirements_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "edu_procedure_categories" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 12.7 · edu_users — LO QUE PIDIÓ ws2-t1 (Ola C·1) EN SU PUNTO 6.1 ──
--
-- Cinco columnas, copiadas de su reporte, con UNA sola traducción: él las
-- escribió en snake_case ("updated_by_id") y aquí van en camelCase
-- ENTRECOMILLADO, que es como las escribe Prisma. Una columna
-- "updated_by_id" en esta base sería una columna que el cliente NO
-- encuentra.
--
-- Su sexta petición —«si t4 tiene sitio para UNA cosa, que sea ésta»— era
-- la tabla de bitácora del vertical (H-162), y ya está: es la §3,
-- edu_audit_logs. La suya la escribió como `edu_audit_log` con
-- `changes jsonb`; aquí son "before"/"after" separados porque un diff de
-- dos columnas se lee como tabla («Campo · Antes · Después») sin
-- desempaquetar un JSON en la pantalla, que es como lo hace el dental.
--
-- H-04 · QUIÉN tocó la cuenta y CUÁNDO. "updatedAt" ya contesta el
-- «cuándo» del último cambio, pero no hay «quién»: hoy no se puede
-- contestar quién le cambió el correo a una persona. Y "updatedByAt" va
-- APARTE de "updatedAt" a propósito: a "updatedAt" lo mueve cualquier
-- escritura (un lastLogin, por ejemplo).
ALTER TABLE "edu_users" ADD COLUMN IF NOT EXISTS "updatedById" TEXT;
ALTER TABLE "edu_users" ADD COLUMN IF NOT EXISTS "updatedByAt" TIMESTAMPTZ(3);

-- H-04 · EL OVERRIDE QUE SE DESCARTÓ al cambiar de rol. Cambiar de rol
-- BORRA el override, y tiene que borrarlo (el override REEMPLAZA al
-- default del rol). Lo que no puede pasar es que desaparezca sin rastro.
-- NOT NULL con DEFAULT '{}': un array vacío es exactamente lo que
-- significa hoy para todas las filas que ya existen.
ALTER TABLE "edu_users"
  ADD COLUMN IF NOT EXISTS "permissionsOverridePrevious" TEXT[] NOT NULL DEFAULT '{}';

-- H-114 · EL ROL ANTERIOR y cuándo cambió. Un alumno que se gradúa y
-- entra de docente es la misma persona con dos historias.
ALTER TABLE "edu_users" ADD COLUMN IF NOT EXISTS "rolePrevious"  "EduRole";
ALTER TABLE "edu_users" ADD COLUMN IF NOT EXISTS "roleChangedAt" TIMESTAMPTZ(3);

-- La FK apunta a la MISMA tabla: quien tocó la cuenta es otra cuenta.
-- SET NULL — dar de baja a quien hizo el cambio no puede borrar la
-- constancia de que el cambio ocurrió.
DO $edu$
BEGIN
  ALTER TABLE "edu_users"
    ADD CONSTRAINT "edu_users_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 12.8 · LO QUE PIDIÓ ws2-t3 (Ola C·1) EN SU PUNTO 6a ───────────────
--
-- Cinco columnas y tres índices ÚNICOS PARCIALES, copiados de su reporte.
-- Dos traducciones y una sustitución, todas explicadas abajo.

-- H-93 · LOS CRITERIOS DE RÚBRICA SE BORRAN DE VERDAD, y renombrar uno
-- deja el "criterionId" de todo el historial de calificaciones en NULL.
-- En el resto del vertical nada se borra: se desactiva. NOT NULL con
-- DEFAULT true, que es su propio backfill.
ALTER TABLE "edu_rubric_criteria"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- H-132 · LOS TOKENS LEÍDOS DE CACHÉ se cobran hoy a precio de token
-- nuevo. 🔴 TRADUCCIÓN: venían pedidas como "…PerMTokCents" y aquí van en
-- la unidad de sus DOS HERMANAS de la misma tabla —micros de dólar por
-- millón de tokens—. Dos unidades distintas en la misma tabla es como una
-- factura sale multiplicada por diez mil.
ALTER TABLE "edu_ai_prices" ADD COLUMN IF NOT EXISTS "cacheReadUsdMicrosPerMillion"  INTEGER;
ALTER TABLE "edu_ai_prices" ADD COLUMN IF NOT EXISTS "cacheWriteUsdMicrosPerMillion" INTEGER;

-- H-89 · EL AUTOR del requisito. La COHORTE y la VERSIÓN no van aquí sino
-- en edu_requirement_versions (§10): el índice único
-- "edu_requirements_nombre_key" no deja dos filas con el mismo nombre, y
-- cambiarlo sería un DROP. El autor sí cabe, y es la pregunta que se hace
-- quien ve su avance caer una tarde.
ALTER TABLE "edu_requirements" ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;
ALTER TABLE "edu_requirements" ADD COLUMN IF NOT EXISTS "updatedByName"   VARCHAR(160);

DO $edu$
BEGIN
  ALTER TABLE "edu_requirements"
    ADD CONSTRAINT "edu_requirements_updatedByUserId_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 12.9 · LOS TRES ÍNDICES ÚNICOS PARCIALES QUE PIDIÓ ws2-t3
--
-- ⚠️ ESTOS TRES SON DISTINTOS DE TODO LO DEMÁS DEL ARCHIVO, Y HAY QUE
-- DECIRLO ANTES DE LEERLOS.
--
-- No añaden una columna: IMPONEN UNA REGLA SOBRE LOS DATOS QUE YA ESTÁN.
-- Si hoy hay en la base dos calificaciones raíz del mismo caso, o dos
-- casos vivos del mismo paciente en la misma especialidad —que es
-- exactamente el fallo que estos índices existen para cerrar—, el CREATE
-- FALLA. Y un CREATE que falla a media hoja abortaría TODO el archivo en
-- el editor de Supabase.
--
-- 🔴 POR ESO CADA UNO VA EN SU PROPIO BLOQUE QUE ATRAPA `unique_violation`
-- Y AVISA CON UN NOTICE en vez de tumbar la ola. Si alguno no se crea, el
-- SQL termina igual, el resto de la ola queda puesta, y en la pestaña
-- "Messages" de Supabase aparece cuál falló y con qué consulta encontrar
-- los duplicados. NO se silencia: se cuenta.
--
-- ⚠️ NO se borra el "edu_case_grades_corrects_idx" normal que ya existe,
-- aunque ws2-t3 escribió que el nuevo «lo sustituye»: eso sería un DROP, y
-- en esta ola no se borra nada sin decisión de Rafael. Convivir cuesta un
-- índice de más al escribir y no cambia ni una lectura; el DROP, si se
-- quiere, va con el bloque comentado de la §14.
-- ═══════════════════════════════════════════════════════════════════════

-- H-05 / H-95 · UNA SOLA CALIFICACIÓN RAÍZ POR CASO. Hoy el 409 se
-- comprueba dentro de la transacción, pero dos transacciones simultáneas
-- en READ COMMITTED no se ven entre sí: el candado de verdad es éste.
DO $edu$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "edu_case_grades_una_raiz_idx"
    ON "edu_case_grades" ("institutionId", "caseId")
    WHERE "correctsId" IS NULL;
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'NO se creó edu_case_grades_una_raiz_idx: ya hay casos con DOS calificaciones raíz. Encuéntralos con: SELECT "institutionId","caseId",COUNT(*) FROM "edu_case_grades" WHERE "correctsId" IS NULL GROUP BY 1,2 HAVING COUNT(*)>1;';
END
$edu$;

-- H-05 / H-95 · Y UNA SOLA CORRECCIÓN POR CALIFICACIÓN.
DO $edu$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "edu_case_grades_una_correccion_idx"
    ON "edu_case_grades" ("institutionId", "correctsId")
    WHERE "correctsId" IS NOT NULL;
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'NO se creó edu_case_grades_una_correccion_idx: ya hay calificaciones corregidas DOS veces. Encuéntralas con: SELECT "institutionId","correctsId",COUNT(*) FROM "edu_case_grades" WHERE "correctsId" IS NOT NULL GROUP BY 1,2 HAVING COUNT(*)>1;';
END
$edu$;

-- H-35 · UN SOLO CASO VIVO por paciente y especialidad. Mismo patrón que
-- el índice único parcial que las autorizaciones ya tienen desde la Ola 4
-- (sql/edu-ola-4.sql). Los tres estados de fuera son los mismos que usa
-- EDU_CASE_CLOSED_STATUSES en src/lib/edu/types.ts.
DO $edu$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "edu_cases_uno_vivo_idx"
    ON "edu_cases" ("institutionId", "patientId", "programId")
    WHERE "status" NOT IN ('COMPLETED', 'TRANSFERRED', 'ABANDONED');
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'NO se creó edu_cases_uno_vivo_idx: ya hay pacientes con DOS casos vivos en la misma especialidad. Encuéntralos con: SELECT "institutionId","patientId","programId",COUNT(*) FROM "edu_cases" WHERE "status" NOT IN (''COMPLETED'',''TRANSFERRED'',''ABANDONED'') GROUP BY 1,2,3 HAVING COUNT(*)>1;';
END
$edu$;


-- ═══════════════════════════════════════════════════════════════════════
-- 13. LO QUE NO NECESITA NI UNA LÍNEA DE SQL, Y CONVIENE DEJAR ESCRITO
--
-- · H-150 · LOS DATOS DEL INSTITUTO (nombre, ciudad, estado, teléfono,
--   correo, logo y ZONA HORARIA) ya existen todos en "edu_institutions"
--   desde la Ola 0 y la Ola 1. Lo que faltaba era la PANTALLA y el
--   endpoint, no la columna: en todo el vertical había dos escrituras a
--   esa tabla y ninguna era del panel. Los pone esta ola en
--   src/lib/edu/institucion.ts.
--
-- · LA ROTACIÓN DOCENTE CON "startsAt" FUTURO ya está soportada en la
--   base Y en la lectura: "edu_supervisor_assignments"."startsAt" existe
--   desde la Ola 1A y `eduCurrentAssignmentWhere` (padron-core.ts:158)
--   ya filtra `startsAt <= now`. Lo único que falta es que el endpoint
--   que asigna acepte una fecha futura en vez de escribir `now` a pelo
--   (padron.ts:778) — una línea de lógica, cero columnas.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
-- 14. ⛔ ESTO NO SE EJECUTA. VA COMENTADO Y ES UNA DECISIÓN DE RAFAEL.
--
-- Aquí abajo hay DOS bloques que harían lo mismo que el resto del archivo
-- —cerrar un hallazgo de la auditoría— pero por el único camino que este
-- vertical tiene prohibido: BORRANDO un objeto de una base viva
-- (DROP INDEX). Están escritos, comentados y sin aplicar.
--
-- 🔴 NO HACE FALTA CORRERLOS PARA QUE LA OLA C FUNCIONE. Los dos
-- hallazgos ya quedan cerrados arriba por un camino aditivo:
--   · N-3 → la tabla de movimientos edu_odontogram_events (§8);
--   · H-89 → la tabla de versiones edu_requirement_versions (§10).
-- Correrlos sería cambiar de camino, no completar el que se tomó.
--
-- Si Rafael dice que sí a alguno, el orden es: quitar los guiones, correr
-- ESE bloque solo, y avisar para ajustar prisma/schema.prisma en el mismo
-- push (Prisma no sabe expresar un índice único PARCIAL, así que hoy el
-- esquema declara el completo y eso NO cambiaría solo).
-- ═══════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════

-- ── 14.A · EL ÍNDICE ÚNICO PARCIAL DEL ODONTOGRAMA (N-3) ───────────────
--
-- QUÉ HARÍA: permitir que un hallazgo dado de baja y el mismo hallazgo
-- vuelto a marcar sean DOS FILAS, en vez de una que revive. Con eso, el
-- rastro de quién lo quitó vive en la fila vieja y no lo pisa nadie.
--
-- POR QUÉ NO ESTÁ APLICADO — tres avisos, y ninguno es teórico:
--
--   1. ES UN DROP. "edu_odontogram_hallazgo_key" es el índice que HOY hace
--      posible el upsert del odontograma y el que impide que un doble clic
--      meta el mismo hallazgo dos veces. Entre el DROP y el CREATE hay una
--      ventana —corta, pero real— en la que ese candado NO EXISTE, y el
--      odontograma es una pantalla que se usa DE PIE, con el paciente en
--      el sillón. En una base con tráfico, esa ventana se puede llenar de
--      duplicados que después hay que limpiar a mano.
--
--   2. EL CÓDIGO DE HOY DEJARÍA DE FUNCIONAR COMO ESTÁ. `odontograma.ts`
--      hace un `upsert` contra la llave de CINCO columnas. Con el índice
--      parcial, Prisma ya no puede usar esa llave para el upsert (una
--      llave parcial no es un `@@unique` que el cliente sepa nombrar), así
--      que `setEduOdontogramFinding` y `setEduOdontogramNote` HAY QUE
--      REESCRIBIRLOS en la misma entrega — y ese archivo es de otra
--      casilla. Aplicar esto sin ese cambio deja el odontograma escribiendo
--      duplicados.
--
--   3. HAY QUE COMPROBAR ANTES QUE NO HAY DUPLICADOS VIVOS. El CREATE del
--      índice parcial falla si ya existen dos filas con la misma llave y
--      "deletedAt" IS NULL. La consulta de comprobación va primero.
--
-- CÓMO SE HARÍA, SI SE HACE (en este orden exacto):
--
-- -- (1) COMPROBAR. Tiene que devolver CERO filas. Si devuelve alguna,
-- --     PARAR: hay que decidir con cuál se queda cada boca antes de nada.
-- SELECT "institutionId", "patientId", "tooth", "surface", "condition", COUNT(*)
--   FROM "edu_odontogram_entries"
--  WHERE "deletedAt" IS NULL
--  GROUP BY 1,2,3,4,5
-- HAVING COUNT(*) > 1;
--
-- -- (2) CREAR EL NUEVO PRIMERO, con OTRO nombre. Así el candado nunca
-- --     deja de existir: en ningún instante hay cero índices únicos.
-- CREATE UNIQUE INDEX IF NOT EXISTS "edu_odontogram_hallazgo_vivo_key"
--   ON "edu_odontogram_entries"
--      ("institutionId", "patientId", "tooth", "surface", "condition")
--   WHERE "deletedAt" IS NULL;
--
-- -- (3) Y SOLO ENTONCES soltar el completo. ⛔ ESTA es la línea que borra
-- --     algo, y la única de todo el archivo.
-- DROP INDEX IF EXISTS "edu_odontogram_hallazgo_key";
--
-- Y en el mismo push: quitar el `@@unique` de EduOdontogramEntry en
-- prisma/schema.prisma (Prisma no sabe declarar un índice parcial, así que
-- el índice pasa a vivir SOLO aquí, como el índice único parcial de
-- edu_case_approvals que ya existe desde la Ola 4) y reescribir el upsert
-- de src/lib/edu/odontograma.ts como find + create/update explícito.


-- ── 14.B · EL ÍNDICE ÚNICO DE edu_requirements (H-89) ──────────────────
--
-- QUÉ HARÍA: permitir que el VERSIONADO viva DENTRO de edu_requirements
-- (con columnas "version" y "cohortId") en vez de en la tabla aparte de la
-- §10.
--
-- POR QUÉ NO ESTÁ APLICADO: hoy la tabla tiene
-- UNIQUE ("institutionId", "programId", "name") y dos versiones del mismo
-- requisito chocan contra él. Cambiarlo es otro DROP INDEX, con el mismo
-- aviso 1 de arriba, y ADEMÁS obligaría a tocar todo el código de
-- evaluación que hoy lee "la fila del requisito" dando por hecho que hay
-- UNA — que es de otra casilla.
--
-- La §10 resuelve lo mismo sin borrar nada, y por eso es lo que se hizo.
-- Esto queda solo por si Rafael prefiere el otro camino.
--
-- -- ALTER TABLE "edu_requirements" ADD COLUMN IF NOT EXISTS "version"  INTEGER NOT NULL DEFAULT 1;
-- -- ALTER TABLE "edu_requirements" ADD COLUMN IF NOT EXISTS "cohortId" TEXT;
-- -- CREATE UNIQUE INDEX IF NOT EXISTS "edu_requirements_nombre_version_key"
-- --   ON "edu_requirements" ("institutionId", "programId", "name", "version");
-- -- DROP INDEX IF EXISTS "edu_requirements_nombre_key";


-- ═══════════════════════════════════════════════════════════════════════
-- FIN DE sql/edu-ola-c.sql
--
-- Si esto corrió sin errores, la Ola C tiene su base puesta y la Ola C·2
-- solo tiene que pintar pantallas.
-- ═══════════════════════════════════════════════════════════════════════
