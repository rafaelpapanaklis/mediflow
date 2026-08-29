-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola 5 · TARIFARIOS Y CAJA.
--
-- Va DESPUÉS de sql/edu-ola-0.sql, sql/edu-ola-1.sql y sql/edu-ola-2.sql
-- (necesita "edu_institutions", "edu_users", "edu_patients" y "edu_cases").
-- Producto SEPARADO del dental, que está VIVO en producción: este archivo
-- NO toca ni una tabla, ni una columna, ni una fila del dental, de
-- barbería ni de inmuebles.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   3 enums    · "EduFeeRule", "EduChargeStatus", "EduPaymentMethod"
--   7 tablas   · edu_procedures, edu_fee_schedules, edu_fee_schedule_items,
--                edu_charges, edu_charge_items, edu_payments,
--                edu_cash_sessions
--  20 índices  · 4 únicos + 16 de consulta
--  22 llaves foráneas
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
-- 🔴 EL DINERO SE GUARDA EN CENTAVOS ENTEROS (INTEGER), no en NUMERIC ni
-- en DOUBLE PRECISION.
--
-- En coma flotante 0.1 + 0.2 no da 0.3, y un tarifario de 40 renglones
-- acumula ese error hasta que el corte no cuadra por un peso que nadie
-- encuentra. Un entero de centavos suma exacto y se compara exacto.
--
-- ⚠️ Un INTEGER de Postgres llega a 2,147,483,647 centavos ≈ 21 millones de
-- pesos. La aplicación pone topes MUY por debajo (un precio unitario
-- máximo de $100,000, una cantidad máxima de 99 y un cobro máximo de
-- $1,000,000) precisamente para que ninguna suma pueda acercarse a ese
-- límite. Si una escuela algún día los necesita más altos, el cambio es en
-- src/lib/edu/dinero-core.ts y hay que revisar ESTA nota antes.
--
-- 🔴 NOTA SOBRE LOS TIPOS DE FECHA — no es un descuido que convivan dos:
--   · TIMESTAMP(3)   → sellos internos ("createdAt"/"updatedAt").
--   · TIMESTAMPTZ(3) → cuándo se cobró, cuándo entró el dinero y cuándo se
--     abrió y se cerró el turno. Son INSTANTES, y la escuela puede estar
--     en cualquier zona del país: un corte guardado sin zona se mueve solo
--     una hora en octubre.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Enums ───────────────────────────────────────────────────────────

-- CUÁNDO se aplica sola una lista de precios.
--
-- 🔴 Las LISTAS son N y abiertas; las REGLAS son un conjunto cerrado, y eso
-- es a propósito: una regla es código, alguien tiene que escribir de dónde
-- sale el dato que la dispara. Una lista nueva de convenio, campaña o
-- personal nace MANUAL y se elige a mano al cobrar, sin tocar una línea de
-- código ni volver a este archivo.
DO $edu$
BEGIN
  CREATE TYPE "EduFeeRule" AS ENUM ('MANUAL', 'REFERRED_BY_STUDENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- En qué va el cobro. Se DERIVA de (total, pagado, cancelado) en la
-- aplicación y se guarda para poder filtrar e indexar; nunca se captura.
DO $edu$
BEGIN
  CREATE TYPE "EduChargeStatus" AS ENUM (
    'PENDING', 'PARTIAL', 'PAID', 'REFUNDED', 'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

-- Cómo pagó. OTHER existe para no obligar a mentir: una beca, un
-- intercambio o un vale no son efectivo ni tarjeta.
DO $edu$
BEGIN
  CREATE TYPE "EduPaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 2. Tablas ──────────────────────────────────────────────────────────

-- El catálogo de procedimientos de la escuela.
--
-- 🔴 NO TRAE PRECIO, y no es un olvido: el precio es de la LISTA, no del
-- procedimiento. Un "priceCents" aquí sería la puerta a "y el de alumno lo
-- pongo en otra columna", que es exactamente el diseño que esta ola no
-- hace — porque la tercera lista (un convenio, una campaña) obligaría a
-- rehacer la tabla, las pantallas y los cobros ya emitidos.
CREATE TABLE IF NOT EXISTS "edu_procedures" (
  "id"              TEXT         NOT NULL,
  "institutionId"   TEXT         NOT NULL,
  "name"            VARCHAR(120) NOT NULL,
  -- La clave corta que la escuela ya usa en sus papeles. Única DENTRO del
  -- instituto y normalizada en MAYÚSCULAS por la aplicación (Postgres
  -- distingue: "endo-1" y "ENDO-1" serían dos claves con el mismo texto
  -- impreso en el tarifario de la pared).
  "code"            VARCHAR(20)  NOT NULL,
  -- Agrupación LIBRE ("Endodoncia", "Prótesis"). Texto y no catálogo:
  -- cada escuela agrupa distinto, y un catálogo cerrado obligaría a pedir
  -- permiso para dar de alta una categoría.
  "category"        VARCHAR(60),
  -- Cuánto dura en el sillón. Sirve para proponer la duración de la cita;
  -- no bloquea nada.
  "durationMinutes" INTEGER      NOT NULL DEFAULT 60,
  "isActive"        BOOLEAN      NOT NULL DEFAULT true,
  "orderIndex"      INTEGER      NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_procedures_pkey" PRIMARY KEY ("id")
);

-- LA LISTA DE PRECIOS. Son N, no dos.
--
-- "isDefault" marca la lista a la que se cae cuando ninguna regla dispara
-- (el "Público general"). "rule" marca CUÁNDO se aplica sola. Son dos
-- cosas distintas y por eso son dos columnas: una lista de convenio se
-- aplica a mano (MANUAL) y no es la predeterminada de nadie.
--
-- ⚠️ Que haya UN solo default y UNA sola lista por regla automática lo
-- garantiza la APLICACIÓN (src/lib/edu/tarifas.ts, dentro de la misma
-- transacción que escribe), no la base: un índice único parcial con
-- "isActive" de por medio no lo puede expresar, y uno completo prohibiría
-- conservar listas históricas desactivadas. Si un día hubiera dos, gana la
-- de menor "orderIndex" — el desempate es determinista a propósito, para
-- que el precio no dependa del orden en que Postgres devolvió las filas.
CREATE TABLE IF NOT EXISTS "edu_fee_schedules" (
  "id"            TEXT         NOT NULL,
  "institutionId" TEXT         NOT NULL,
  "name"          VARCHAR(80)  NOT NULL,
  -- Clave corta y estable ("publico", "alumno", "convenio-imss"): es lo
  -- que se lee en un reporte y lo que NO cambia cuando la dirección
  -- renombra la lista.
  "key"           VARCHAR(40)  NOT NULL,
  "rule"          "EduFeeRule" NOT NULL DEFAULT 'MANUAL',
  "isDefault"     BOOLEAN      NOT NULL DEFAULT false,
  "isActive"      BOOLEAN      NOT NULL DEFAULT true,
  "orderIndex"    INTEGER      NOT NULL DEFAULT 0,
  "notes"         VARCHAR(300),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_fee_schedules_pkey" PRIMARY KEY ("id")
);

-- El precio de UN procedimiento en UNA lista. Único por par.
--
-- 🔴 Que un procedimiento NO tenga fila en una lista no es un error:
-- quiere decir que esa lista no lo cubre, y quien resuelve el precio cae a
-- la lista predeterminada y lo DICE en pantalla. Un 0 implícito ahí sería
-- regalar el tratamiento sin que nadie lo decidiera — por eso "sin fila" y
-- "cero" tienen que poder distinguirse, y por eso el cero es un precio
-- válido y querido (un tamizaje gratis).
CREATE TABLE IF NOT EXISTS "edu_fee_schedule_items" (
  "id"            TEXT         NOT NULL,
  "institutionId" TEXT         NOT NULL,
  "feeScheduleId" TEXT         NOT NULL,
  "procedureId"   TEXT         NOT NULL,
  -- Centavos enteros.
  "priceCents"    INTEGER      NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_fee_schedule_items_pkey" PRIMARY KEY ("id")
);

-- EL COBRO: un ticket del paciente.
--
-- 🔴 "feeScheduleId" es la lista que se APLICÓ y "feeScheduleLabel" es su
-- nombre CONGELADO. Las dos: el id sirve para reportar y se pone en NULL si
-- algún día la lista desaparece; el texto sobrevive a eso y a que la
-- dirección la renombre. Un recibo que cambia de contenido después de
-- firmado no es un recibo.
--
-- 🔴 "balanceCents" de un cobro CANCELADO queda en CERO. No se le debe
-- nada a nadie. Dejarlo en el total es exactamente el bug que ya se pagó
-- en el producto dental: una factura cancelada seguía apareciendo como
-- "Cobrar ahora · $1,800" en cinco pantallas. El "totalCents" sí se
-- conserva: es lo que el cobro decía.
CREATE TABLE IF NOT EXISTS "edu_charges" (
  "id"                TEXT              NOT NULL,
  "institutionId"     TEXT              NOT NULL,
  -- Folio del cobro, único dentro del instituto. Lo genera la aplicación
  -- (C-0001, C-0002…) o lo teclea la escuela.
  "folio"             VARCHAR(30)       NOT NULL,
  "patientId"         TEXT              NOT NULL,
  -- El caso clínico, cuando se sabe. Es NULLABLE porque CAJA no ve casos
  -- (la línea del contrato de la Ola 2) y cobra igual: el expediente no es
  -- asunto suyo.
  "caseId"            TEXT,
  "feeScheduleId"     TEXT,
  "feeScheduleLabel"  VARCHAR(80),
  -- Suma de (cantidad × precio unitario) de las líneas, ANTES de
  -- descuentos.
  "subtotalCents"     INTEGER           NOT NULL DEFAULT 0,
  -- Suma de los descuentos de las líneas. El invariante que fijan las
  -- pruebas: subtotal − descuento == total, SIEMPRE.
  "discountCents"     INTEGER           NOT NULL DEFAULT 0,
  "totalCents"        INTEGER           NOT NULL DEFAULT 0,
  -- Neto pagado: pagos menos devoluciones. Se recalcula dentro de la misma
  -- transacción que escribe el pago, a partir de los pagos REALES y no
  -- sumándole el monto nuevo a la columna (dos pagos simultáneos leerían
  -- 0, escribirían 500 los dos, y el paciente habría pagado 1000).
  "paidCents"         INTEGER           NOT NULL DEFAULT 0,
  "balanceCents"      INTEGER           NOT NULL DEFAULT 0,
  "status"            "EduChargeStatus" NOT NULL DEFAULT 'PENDING',
  "notes"             VARCHAR(500),
  "chargedByUserId"   TEXT              NOT NULL,
  "chargedAt"         TIMESTAMPTZ(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- El turno en el que se emitió. NULL = se emitió sin turno abierto: se
  -- permite, porque el corte es una herramienta y no un peaje para
  -- atender a un paciente que ya está en el mostrador.
  "cashSessionId"     TEXT,
  -- Anulación. Se guarda quién y cuándo porque es dinero.
  "cancelledAt"       TIMESTAMPTZ(3),
  "cancelledByUserId" TEXT,
  "cancelReason"      VARCHAR(300),
  "createdAt"         TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_charges_pkey" PRIMARY KEY ("id")
);

-- La línea del cobro.
--
-- 🔴 EL PRECIO SE CONGELA AQUÍ. "unitPriceCents" y "description" se
-- escriben al emitir y no se vuelven a tocar: si mañana sube el tarifario,
-- este renglón sigue diciendo lo que se cobró. "procedureId" es NULLABLE
-- para permitir la línea libre (un material, una placa) y va en SET NULL
-- para que dar de baja un procedimiento no borre historia.
CREATE TABLE IF NOT EXISTS "edu_charge_items" (
  "id"               TEXT         NOT NULL,
  "institutionId"    TEXT         NOT NULL,
  "chargeId"         TEXT         NOT NULL,
  "procedureId"      TEXT,
  -- El nombre CONGELADO de lo que se cobró.
  "description"      VARCHAR(160) NOT NULL,
  "quantity"         INTEGER      NOT NULL DEFAULT 1,
  "unitPriceCents"   INTEGER      NOT NULL,
  "discountCents"    INTEGER      NOT NULL DEFAULT 0,
  -- cantidad × unitario − descuento. Se guarda calculado para que el
  -- recibo no dependa de que quien lo lea repita la fórmula.
  "totalCents"       INTEGER      NOT NULL,
  -- 🔴 ANTIFRAUDE, EN LA BASE Y NO EN UN LOG. Cuando la línea trae
  -- "procedureId", el precio lo pone el SERVIDOR y cualquier precio que
  -- mande el navegador se descarta. Si el que mandó era distinto, se
  -- guarda aquí — NULL = no hubo discrepancia. Un console.warn se pierde;
  -- una columna se puede consultar el día que alguien pregunte por qué un
  -- cobro salió raro.
  "clientPriceCents" INTEGER,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_charge_items_pkey" PRIMARY KEY ("id")
);

-- El pago (o la devolución) de un cobro.
--
-- 🔴 UNA DEVOLUCIÓN ES OTRA FILA, no un pago borrado ni un monto negativo.
-- "isRefund" la marca y el neto es pagos − devoluciones. Así el corte
-- puede decir "cobrado $4,200 · devuelto $300" en vez de un solo número
-- que esconde las dos cosas, y nadie tiene que borrar un renglón de dinero
-- para corregir un error.
--
-- 🔴 "cashSessionId" es el turno del PAGO, no el del cobro. Un cobro de
-- ayer que se liquida hoy entra en el corte de HOY, porque el dinero está
-- en la caja de hoy. Colgarlo del turno del cobro descuadraría los dos.
CREATE TABLE IF NOT EXISTS "edu_payments" (
  "id"               TEXT               NOT NULL,
  "institutionId"    TEXT               NOT NULL,
  "chargeId"         TEXT               NOT NULL,
  "method"           "EduPaymentMethod" NOT NULL DEFAULT 'CASH',
  -- Siempre POSITIVO, también en una devolución: el signo lo pone
  -- "isRefund". Un monto negativo se cuela en cualquier suma que olvide
  -- mirar la bandera.
  "amountCents"      INTEGER            NOT NULL,
  "isRefund"         BOOLEAN            NOT NULL DEFAULT false,
  "reference"        VARCHAR(80),
  "notes"            VARCHAR(300),
  "paidAt"           TIMESTAMPTZ(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedByUserId" TEXT               NOT NULL,
  "cashSessionId"    TEXT,
  "createdAt"        TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_payments_pkey" PRIMARY KEY ("id")
);

-- EL TURNO DE CAJA. Un corte es de TURNO, no de día natural.
--
-- 🔴 Es la lección que costó un bug en el dental: la ventana va de
-- "openedAt" a "closedAt" (o a ahora), y si nadie corta en tres días, la
-- ventana son tres días. La pantalla lo DICE en vez de titular "hoy" unos
-- datos que no son de hoy.
--
-- ⚠️ Hay como mucho UN turno abierto por instituto ("closedAt" IS NULL).
-- Lo garantiza la aplicación dentro de una transacción; en la base no cabe
-- sin un índice único PARCIAL, y uno parcial rompería cualquier upsert
-- futuro (Prisma emite ON CONFLICT sin el predicado y Postgres no lo
-- infiere). Si algún día se colaran dos, se ven como dos turnos abiertos y
-- se cierra uno.
CREATE TABLE IF NOT EXISTS "edu_cash_sessions" (
  "id"              TEXT           NOT NULL,
  "institutionId"   TEXT           NOT NULL,
  "openedAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"        TIMESTAMPTZ(3),
  -- Fondo con el que se abre.
  "openingCents"    INTEGER        NOT NULL DEFAULT 0,
  -- Lo que se CONTÓ al cerrar. NULL mientras el turno sigue abierto.
  "countedCents"    INTEGER,
  -- Lo que DEBERÍA haber en efectivo: fondo + efectivo cobrado − efectivo
  -- devuelto. Se congela al cerrar para que el corte impreso no cambie si
  -- mañana alguien registra un pago con fecha vieja.
  "expectedCents"   INTEGER,
  -- contado − esperado. Positivo sobra, negativo falta. También congelado.
  "differenceCents" INTEGER,
  "notes"           VARCHAR(500),
  "openedByUserId"  TEXT           NOT NULL,
  "closedByUserId"  TEXT,
  "createdAt"       TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_cash_sessions_pkey" PRIMARY KEY ("id")
);


-- ── 3. Índices ─────────────────────────────────────────────────────────
-- Los nombres son los que genera (o los que le dice el `map:` de) Prisma:
-- si algún día se corre `prisma migrate diff` contra esta base, los
-- reconoce y no propone recrearlos.

-- Procedimientos: la clave no se repite dentro del instituto.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_procedures_institutionId_code_key"
  ON "edu_procedures" ("institutionId", "code");

CREATE INDEX IF NOT EXISTS "edu_procedures_orden_idx"
  ON "edu_procedures" ("institutionId", "isActive", "orderIndex");

CREATE INDEX IF NOT EXISTS "edu_procedures_categoria_idx"
  ON "edu_procedures" ("institutionId", "category");

-- Listas de precios: la clave no se repite dentro del instituto.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_fee_schedules_institutionId_key_key"
  ON "edu_fee_schedules" ("institutionId", "key");

CREATE INDEX IF NOT EXISTS "edu_fee_schedules_orden_idx"
  ON "edu_fee_schedules" ("institutionId", "isActive", "orderIndex");

-- 🔴 Precio único por par (lista, procedimiento). El índice va COMPLETO y
-- sin WHERE: el `upsert` de Prisma emite ON CONFLICT ("feeScheduleId",
-- "procedureId") y un índice parcial NO lo satisface — Postgres exigiría
-- repetir el predicado, cosa que Prisma no hace, y la captura de precios
-- reventaría con "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification".
CREATE UNIQUE INDEX IF NOT EXISTS "edu_fee_schedule_items_feeScheduleId_procedureId_key"
  ON "edu_fee_schedule_items" ("feeScheduleId", "procedureId");

CREATE INDEX IF NOT EXISTS "edu_fee_items_procedure_idx"
  ON "edu_fee_schedule_items" ("institutionId", "procedureId");

CREATE INDEX IF NOT EXISTS "edu_fee_items_schedule_idx"
  ON "edu_fee_schedule_items" ("institutionId", "feeScheduleId");

-- Cobros: el folio no se repite dentro del instituto.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_charges_institutionId_folio_key"
  ON "edu_charges" ("institutionId", "folio");

-- Por fecha (la lista de caja), por paciente (su histórico), por estado
-- (la cobranza) y por turno (el corte).
CREATE INDEX IF NOT EXISTS "edu_charges_fecha_idx"
  ON "edu_charges" ("institutionId", "chargedAt");

CREATE INDEX IF NOT EXISTS "edu_charges_patient_idx"
  ON "edu_charges" ("institutionId", "patientId", "chargedAt");

CREATE INDEX IF NOT EXISTS "edu_charges_status_idx"
  ON "edu_charges" ("institutionId", "status");

CREATE INDEX IF NOT EXISTS "edu_charges_session_idx"
  ON "edu_charges" ("institutionId", "cashSessionId");

CREATE INDEX IF NOT EXISTS "edu_charge_items_charge_idx"
  ON "edu_charge_items" ("institutionId", "chargeId");

CREATE INDEX IF NOT EXISTS "edu_charge_items_procedure_idx"
  ON "edu_charge_items" ("institutionId", "procedureId");

-- Pagos: por cobro (el recibo), por fecha y por turno (el corte).
CREATE INDEX IF NOT EXISTS "edu_payments_charge_idx"
  ON "edu_payments" ("institutionId", "chargeId");

CREATE INDEX IF NOT EXISTS "edu_payments_fecha_idx"
  ON "edu_payments" ("institutionId", "paidAt");

CREATE INDEX IF NOT EXISTS "edu_payments_session_idx"
  ON "edu_payments" ("institutionId", "cashSessionId");

-- Turnos: el abierto se busca por "closedAt" IS NULL en cada cobro.
CREATE INDEX IF NOT EXISTS "edu_cash_sessions_abierto_idx"
  ON "edu_cash_sessions" ("institutionId", "openedAt");

CREATE INDEX IF NOT EXISTS "edu_cash_sessions_cerrado_idx"
  ON "edu_cash_sessions" ("institutionId", "closedAt");


-- ── 4. Llaves foráneas ─────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- envuelta en su bloque.
--
-- ⚠️ CASCADE vs SET NULL, y por qué no son todas iguales:
--   · CASCADE  → lo que pertenece al instituto y lo que no tiene sentido
--     sin su padre (las líneas sin su cobro, los pagos sin su cobro). El
--     producto NO borra nada de esto: un cobro se CANCELA y un pago se
--     DEVUELVE con otro pago. El CASCADE está para que borrar un instituto
--     entero —operación de administración, no del panel— no se atore.
--   · SET NULL → las referencias "hacia los lados": la lista que se aplicó,
--     el procedimiento de una línea, el caso de un cobro, el turno de un
--     pago, quién canceló. Perder la referencia es aceptable; perder el
--     cobro, no. El texto congelado ("feeScheduleLabel", "description")
--     sobrevive a esos NULL, que es justamente para lo que está.
--
-- 🔴 "chargedByUserId" y "receivedByUserId" van en CASCADE y NO en SET NULL
-- porque son NOT NULL: son el rastro de quién tocó el dinero. En este
-- producto un usuario no se borra —se desactiva (isActive)— así que ese
-- CASCADE no se dispara nunca desde el panel; está para que borrar el
-- instituto entero no se atore en una llave.

DO $edu$
BEGIN
  ALTER TABLE "edu_procedures"
    ADD CONSTRAINT "edu_procedures_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_fee_schedules"
    ADD CONSTRAINT "edu_fee_schedules_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_fee_schedule_items"
    ADD CONSTRAINT "edu_fee_schedule_items_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_fee_schedule_items"
    ADD CONSTRAINT "edu_fee_schedule_items_feeScheduleId_fkey"
    FOREIGN KEY ("feeScheduleId") REFERENCES "edu_fee_schedules" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_fee_schedule_items"
    ADD CONSTRAINT "edu_fee_schedule_items_procedureId_fkey"
    FOREIGN KEY ("procedureId") REFERENCES "edu_procedures" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_charges"
    ADD CONSTRAINT "edu_charges_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_charges"
    ADD CONSTRAINT "edu_charges_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_charges"
    ADD CONSTRAINT "edu_charges_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "edu_cases" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_charges"
    ADD CONSTRAINT "edu_charges_feeScheduleId_fkey"
    FOREIGN KEY ("feeScheduleId") REFERENCES "edu_fee_schedules" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_charges"
    ADD CONSTRAINT "edu_charges_chargedByUserId_fkey"
    FOREIGN KEY ("chargedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_charges"
    ADD CONSTRAINT "edu_charges_cancelledByUserId_fkey"
    FOREIGN KEY ("cancelledByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_charges"
    ADD CONSTRAINT "edu_charges_cashSessionId_fkey"
    FOREIGN KEY ("cashSessionId") REFERENCES "edu_cash_sessions" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_charge_items"
    ADD CONSTRAINT "edu_charge_items_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_charge_items"
    ADD CONSTRAINT "edu_charge_items_chargeId_fkey"
    FOREIGN KEY ("chargeId") REFERENCES "edu_charges" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_charge_items"
    ADD CONSTRAINT "edu_charge_items_procedureId_fkey"
    FOREIGN KEY ("procedureId") REFERENCES "edu_procedures" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_payments"
    ADD CONSTRAINT "edu_payments_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_payments"
    ADD CONSTRAINT "edu_payments_chargeId_fkey"
    FOREIGN KEY ("chargeId") REFERENCES "edu_charges" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_payments"
    ADD CONSTRAINT "edu_payments_receivedByUserId_fkey"
    FOREIGN KEY ("receivedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_payments"
    ADD CONSTRAINT "edu_payments_cashSessionId_fkey"
    FOREIGN KEY ("cashSessionId") REFERENCES "edu_cash_sessions" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_cash_sessions"
    ADD CONSTRAINT "edu_cash_sessions_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_cash_sessions"
    ADD CONSTRAINT "edu_cash_sessions_openedByUserId_fkey"
    FOREIGN KEY ("openedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_cash_sessions"
    ADD CONSTRAINT "edu_cash_sessions_closedByUserId_fkey"
    FOREIGN KEY ("closedByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 5. Documentación en la propia base ─────────────────────────────────
-- COMMENT ON reemplaza el comentario anterior: es idempotente por sí solo.
COMMENT ON TABLE "edu_fee_schedules" IS
  'LISTA DE PRECIOS. Son N, no dos: el instituto arranca con "Público general" y "Paciente de alumno" y agrega convenios, personal o campañas con un INSERT. isDefault = a la que se cae cuando ninguna regla dispara; rule = cuándo se aplica sola.';
COMMENT ON COLUMN "edu_fee_schedules"."rule" IS
  'Las LISTAS son abiertas; las REGLAS son un conjunto cerrado, porque una regla es código. Una lista nueva nace MANUAL y se elige a mano al cobrar.';
COMMENT ON COLUMN "edu_fee_schedules"."isDefault" IS
  'Solo una activa. Lo garantiza la aplicación dentro de la misma transacción que escribe; un índice único parcial no lo puede expresar con isActive de por medio. Sin lista predeterminada NO se puede cobrar: el servidor no sabría qué precio poner.';
COMMENT ON TABLE "edu_procedures" IS
  'Catálogo. NO trae precio a propósito: el precio es de la LISTA. Un priceCents aquí sería la puerta a una segunda columna de precio, y la tercera lista obligaría a rehacer todo.';
COMMENT ON COLUMN "edu_fee_schedule_items"."priceCents" IS
  'Centavos enteros. CERO es un precio válido (un tamizaje gratis) y por eso "sin fila" y "cero" tienen que distinguirse: sin fila = esa lista no cubre ese procedimiento.';
COMMENT ON COLUMN "edu_charges"."feeScheduleLabel" IS
  'El nombre CONGELADO de la lista que se aplicó. Sobrevive a que la dirección la renombre o la desactive: un recibo que cambia después de firmado no es un recibo.';
COMMENT ON COLUMN "edu_charges"."balanceCents" IS
  'Saldo VIVO. Un cobro CANCELADO lo deja en 0: no se le debe nada a nadie. Dejarlo en el total es el bug que ya se pagó en el dental (una factura cancelada seguía ofreciendo "Cobrar ahora"). Toda suma filtra además por status.';
COMMENT ON COLUMN "edu_charges"."caseId" IS
  'NULL en la mayoría: CAJA no ve casos clínicos (visibility.ts) y cobra igual. Lo cuelga quien sí los ve.';
COMMENT ON COLUMN "edu_charge_items"."unitPriceCents" IS
  'CONGELADO al emitir. Cambiar la tarifa después NO reescribe un cobro ya emitido: el recibo que se imprimió y se firmó dice lo que dice.';
COMMENT ON COLUMN "edu_charge_items"."clientPriceCents" IS
  'ANTIFRAUDE. El precio que mandó el navegador cuando difería del que puso el servidor; NULL = no hubo discrepancia. Se guarda aquí y no en un log porque un log no se puede consultar el día que alguien pregunte por qué un cobro salió raro.';
COMMENT ON COLUMN "edu_payments"."isRefund" IS
  'Una devolución es OTRA fila, no un monto negativo ni un pago borrado. El neto es pagos menos devoluciones, y el corte enseña las dos columnas.';
COMMENT ON COLUMN "edu_payments"."cashSessionId" IS
  'El turno del PAGO, no el del cobro: un cobro de ayer que se liquida hoy entra en el corte de HOY, porque el dinero está en la caja de hoy.';
COMMENT ON TABLE "edu_cash_sessions" IS
  'Corte por TURNO, no por día natural: la ventana va de openedAt a closedAt (o a ahora). Si nadie corta en tres días, la ventana son tres días y la pantalla lo dice.';
COMMENT ON COLUMN "edu_cash_sessions"."expectedCents" IS
  'Se congela al cerrar. Si mañana alguien registra un pago con fecha vieja, el corte que se imprimió y se firmó sigue diciendo lo mismo.';


-- ═══════════════════════════════════════════════════════════════════════
-- 6. BACKFILL DEL OVERRIDE DE PERMISOS  ← LÉELO ANTES DE CERRAR EL ARCHIVO
--
-- 🔴 "permissionsOverride" REEMPLAZA al default del rol, no se suma. Es
-- decir: a quien YA tenga un override guardado, las SEIS keys de esta ola
-- (tarifarios.view/manage, caja.view/charge/refund/corte) NO le llegan
-- solas. Entrará al panel, no verá "Caja" ni "Tarifarios" en el menú, y
-- desde fuera parecerá que la ola no se aplicó.
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
-- ⚠️ SOLO HAY DOS BLOQUES, y no es un olvido: DOCENTE y ALUMNO no reciben
-- NI UNA key de dinero. Copiarle a un docente el bloque de dirección le
-- abriría los precios y los cobros de la escuela entera.
--
-- -- DIRECCION: las seis. Poner precios es decidir cuánto cuesta la
-- -- escuela, y eso lo decide quien la dirige.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'tarifarios.view', 'tarifarios.manage',
--           'caja.view', 'caja.charge', 'caja.refund', 'caja.corte'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'DIRECCION'
--   AND cardinality("permissionsOverride") > 0;
--
-- -- CAJA: las seis MENOS "tarifarios.manage". Cobra, devuelve, corta y
-- -- LEE el tarifario —tiene que poder consultarlo delante del paciente—
-- -- pero no lo escribe: quien cobra no se pone su propio precio.
-- UPDATE "edu_users"
-- SET "permissionsOverride" = ARRAY(
--       SELECT DISTINCT unnest(
--         "permissionsOverride" || ARRAY[
--           'tarifarios.view',
--           'caja.view', 'caja.charge', 'caja.refund', 'caja.corte'
--         ]::TEXT[]
--       )
--     )
-- WHERE "role" = 'CAJA'
--   AND cardinality("permissionsOverride") > 0;
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- 7. EJEMPLO: LAS DOS LISTAS DE PRECIOS INICIALES
--
-- Todo lo de aquí abajo está COMENTADO a propósito: es el ejemplo, no
-- parte de la migración. Descoméntalo, cámbiale los datos y córrelo aparte
-- — o hazlo desde /instituto/tarifarios sin tocar SQL, que es lo normal.
--
-- 🔴 SON DOS PORQUE SE EMPIEZA CON DOS, NO PORQUE EL PRODUCTO OPINE. La
-- tercera ("Convenio sindicato", "Personal del instituto", "Campaña de
-- septiembre") es otro INSERT igual a éstos: no hay migración, ni columna
-- nueva, ni una línea de código que tocar. Ésa es toda la razón de que el
-- precio viva en (lista × procedimiento) y no en dos columnas del
-- procedimiento.
--
-- Sustituye 'ieo' por el slug del instituto que creaste con edu-ola-0.sql.
--
-- ── Las dos listas ─────────────────────────────────────────────────────
-- INSERT INTO "edu_fee_schedules"
--   ("id", "institutionId", "name", "key", "rule", "isDefault", "isActive",
--    "orderIndex", "notes", "createdAt", "updatedAt")
-- SELECT
--   gen_random_uuid()::text,   -- Prisma escribe cuids; la columna es TEXT,
--                              -- así que cualquier id único sirve
--   i."id",
--   v."name", v."key", v."rule"::"EduFeeRule", v."isDefault", true,
--   v."orderIndex", v."notes",
--   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
-- FROM "edu_institutions" i
-- CROSS JOIN (VALUES
--   -- La PREDETERMINADA: la que se aplica a quien llega solo a la clínica.
--   ('Público general',    'publico', 'MANUAL',              true,  1,
--    'Pacientes que llegan por su cuenta a la clínica de la escuela.'),
--   -- La AUTOMÁTICA: se aplica sola cuando el paciente trae
--   -- "referredByStudentId" — el origen que marca recepción en la Ola 2
--   -- con el permiso pacientes.origen.
--   ('Paciente de alumno', 'alumno',  'REFERRED_BY_STUDENT', false, 2,
--    'Pacientes que trae un residente. El sistema la aplica solo, sin que nadie tenga que acordarse en el mostrador.')
-- ) AS v("name", "key", "rule", "isDefault", "orderIndex", "notes")
-- WHERE i."slug" = 'ieo'
-- ON CONFLICT DO NOTHING;
--
-- ── Un par de procedimientos de ejemplo ────────────────────────────────
-- INSERT INTO "edu_procedures"
--   ("id", "institutionId", "name", "code", "category", "durationMinutes",
--    "isActive", "orderIndex", "createdAt", "updatedAt")
-- SELECT
--   gen_random_uuid()::text, i."id",
--   v."name", v."code", v."category", v."min", true, v."orderIndex",
--   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
-- FROM "edu_institutions" i
-- CROSS JOIN (VALUES
--   ('Consulta de valoración',      'VAL-1',  'Diagnóstico',  30, 1),
--   ('Endodoncia unirradicular',    'ENDO-1', 'Endodoncia',   90, 2),
--   ('Resina simple',               'RES-1',  'Operatoria',   45, 3)
-- ) AS v("name", "code", "category", "min", "orderIndex")
-- WHERE i."slug" = 'ieo'
-- ON CONFLICT DO NOTHING;
--
-- ── Los precios: uno por (lista × procedimiento) ───────────────────────
-- 🔴 La valoración va a CERO en las dos listas a propósito: un tamizaje
-- gratis es un precio, no una ausencia de precio. Si no existiera la fila,
-- el sistema diría que esa lista no cubre la valoración.
--
-- INSERT INTO "edu_fee_schedule_items"
--   ("id", "institutionId", "feeScheduleId", "procedureId", "priceCents",
--    "createdAt", "updatedAt")
-- SELECT
--   gen_random_uuid()::text, s."institutionId", s."id", p."id",
--   CASE
--     WHEN p."code" = 'VAL-1'                        THEN 0
--     WHEN p."code" = 'ENDO-1' AND s."key" = 'alumno' THEN  90000  -- $900.00
--     WHEN p."code" = 'ENDO-1'                        THEN 250000  -- $2,500.00
--     WHEN p."code" = 'RES-1'  AND s."key" = 'alumno' THEN  25000  -- $250.00
--     WHEN p."code" = 'RES-1'                         THEN  60000  -- $600.00
--   END
-- FROM "edu_fee_schedules" s
-- JOIN "edu_procedures" p ON p."institutionId" = s."institutionId"
-- JOIN "edu_institutions" i ON i."id" = s."institutionId"
-- WHERE i."slug" = 'ieo'
--   AND s."key" IN ('publico', 'alumno')
--   AND p."code" IN ('VAL-1', 'ENDO-1', 'RES-1')
-- ON CONFLICT DO NOTHING;
--
-- ── Comprobación ───────────────────────────────────────────────────────
-- SELECT p."code", p."name",
--        max(CASE WHEN s."key" = 'publico' THEN it."priceCents" END) / 100.0 AS publico,
--        max(CASE WHEN s."key" = 'alumno'  THEN it."priceCents" END) / 100.0 AS alumno
-- FROM "edu_procedures" p
-- JOIN "edu_institutions" i ON i."id" = p."institutionId"
-- LEFT JOIN "edu_fee_schedule_items" it ON it."procedureId" = p."id"
-- LEFT JOIN "edu_fee_schedules" s ON s."id" = it."feeScheduleId"
-- WHERE i."slug" = 'ieo'
-- GROUP BY p."code", p."name"
-- ORDER BY p."code";
--
-- Si eso devuelve las filas y caja sigue diciendo "no hay ninguna lista de
-- precios predeterminada", el sospechoso número uno es el instituto:
-- comprueba que el "institutionId" de las listas nuevas sea el MISMO con el
-- que entra tu usuario
-- (SELECT "institutionId" FROM "edu_users" WHERE "email" = '…').
-- ═══════════════════════════════════════════════════════════════════════
