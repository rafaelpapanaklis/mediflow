-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — PAGOS A MESES.
--
-- Va DESPUÉS de sql/edu-ola-5.sql (necesita "edu_charges", "edu_payments",
-- "edu_patients", "edu_users" y "edu_institutions"). En el orden general
-- de aplicación va al FINAL, después de sql/edu-cierre.sql. Producto
-- SEPARADO del dental, que está VIVO en producción: este archivo NO toca
-- ni una tabla, ni una columna, ni una fila del dental, de barbería ni de
-- inmuebles.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   1 enum     · "EduPaymentPlanStatus"
--   2 tablas   · edu_payment_plans, edu_installments
--   7 índices  · 2 únicos + 5 de consulta
--   8 llaves foráneas
--   0 backfill · no hay keys de permiso nuevas: el plan reusa caja.view /
--                caja.charge / caja.refund, que ya están repartidas.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
--
-- Nota sobre $$: delimitador con nombre, $edu$, y NUNCA bloques DO
-- anidados — el parser SQL de Supabase rompe con $$ anidado.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 LO QUE ESTE ESQUEMA NO GUARDA, A PROPÓSITO:
--   · NO hay columna "saldo del plan": se DERIVA de las mensualidades sin
--     pago. Un saldo guardado y editable a mano es la forma más fácil de
--     que una caja no cuadre.
--   · NO hay estado "VENCIDA" en la mensualidad: en la base viven los
--     HECHOS ("dueDate", y "paymentId" o su ausencia) y el estado se
--     calcula en cada lectura contra el hoy del instituto
--     (src/lib/edu/pagos-core.ts). Una columna VENCIDA necesitaría un
--     cron que la escriba — y el día que falle, toda la cartera diría
--     "al corriente".
--   · Que solo haya UN plan ACTIVO por cobro lo garantiza la APLICACIÓN
--     dentro de la transacción que crea el plan (mismo criterio que el
--     único turno de caja abierto; un índice único parcial rompería
--     cualquier upsert futuro, igual que allá).
--
-- 🔴 El dinero sigue siendo INTEGER de centavos, y las fechas siguen la
-- regla de la Ola 5: TIMESTAMPTZ(3) para los INSTANTES (cuándo se armó,
-- se canceló o se liquidó el plan) y TIMESTAMP(3) para los sellos
-- internos. "dueDate" es una FECHA DE CALENDARIO guardada a medianoche
-- UTC (como las fechas del contrato del instituto): un día pactado no
-- tiene zona horaria.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Enum ────────────────────────────────────────────────────────────

-- En qué va el plan. LIQUIDADO lo escribe la MISMA transacción que
-- registra el pago de la última mensualidad; CANCELADO es un acto con
-- autor y motivo. No hay 'VENCIDO': vencida está una mensualidad, y ni
-- siquiera se guarda — se deriva del calendario.
DO $edu$
BEGIN
  CREATE TYPE "EduPaymentPlanStatus" AS ENUM ('ACTIVO', 'LIQUIDADO', 'CANCELADO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 2. Tablas ──────────────────────────────────────────────────────────

-- EL PLAN DE PAGOS de un cobro: el acuerdo de partir su saldo en meses.
--
-- Cuelga del COBRO ("chargeId"); "patientId" se guarda además solo para
-- listar los planes de un paciente sin JOIN (mismo criterio que
-- edu_invoices y edu_prescriptions). Los TÉRMINOS pactados ("months",
-- "installmentCents", "downPaymentCents", "dueDay") se congelan al crear
-- y nada los recalcula: son el acuerdo, no acumuladores.
CREATE TABLE IF NOT EXISTS "edu_payment_plans" (
  "id"                TEXT                   NOT NULL,
  "institutionId"     TEXT                   NOT NULL,
  "chargeId"          TEXT                   NOT NULL,
  "patientId"         TEXT                   NOT NULL,
  "status"            "EduPaymentPlanStatus" NOT NULL DEFAULT 'ACTIVO',
  -- Cuántas mensualidades se pactaron (2 a 48; lo acota la aplicación).
  "months"            INTEGER                NOT NULL,
  -- La mensualidad "pareja". 🔴 La PRIMERA puede ser mayor: si el saldo
  -- no divide exacto, la diferencia ENTERA va en ella — jamás repartida
  -- en decimales que no suman.
  "installmentCents"  INTEGER                NOT NULL,
  -- Lo que el cobro tenía PAGADO al crear el plan (enganche y abonos
  -- previos). Congelado e informativo.
  "downPaymentCents"  INTEGER                NOT NULL DEFAULT 0,
  -- El día de corte pactado (1-31). Si un mes no lo tiene, la fecha se
  -- recorta al último día de ese mes; nunca se corre al mes siguiente.
  "dueDay"            INTEGER                NOT NULL,
  "createdByUserId"   TEXT                   NOT NULL,
  "createdAt"         TIMESTAMPTZ(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt"       TIMESTAMPTZ(3),
  "cancelledByUserId" TEXT,
  "cancelReason"      VARCHAR(300),
  "settledAt"         TIMESTAMPTZ(3),
  "updatedAt"         TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_payment_plans_pkey" PRIMARY KEY ("id")
);

-- UNA MENSUALIDAD del plan: número, monto y vencimiento, congelados al
-- crear. 🔴 SIN columna de estado: PAGADA = "paymentId" apunta al pago
-- que la liquidó; VENCIDA = sin pago y con la fecha pasada, derivado en
-- cada lectura. El monto NO se teclea al pagar: se cobra EXACTAMENTE
-- "amountCents".
CREATE TABLE IF NOT EXISTS "edu_installments" (
  "id"            TEXT         NOT NULL,
  "institutionId" TEXT         NOT NULL,
  "planId"        TEXT         NOT NULL,
  -- 1-based. La número 1 es la que carga los centavos del residuo.
  "number"        INTEGER      NOT NULL,
  "amountCents"   INTEGER      NOT NULL,
  -- Fecha de CALENDARIO a medianoche UTC.
  "dueDate"       TIMESTAMP(3) NOT NULL,
  -- El pago que la liquidó. NULL = sin pagar.
  "paymentId"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_installments_pkey" PRIMARY KEY ("id")
);


-- ── 3. Índices ─────────────────────────────────────────────────────────

-- · status  → "los planes activos", que es la pantalla de caja.
-- · cobro   → el candado de UN activo por cobro y el recibo del cobro.
-- · patient → la ficha del paciente, más recientes primero.
CREATE INDEX IF NOT EXISTS "edu_payment_plans_status_idx"
  ON "edu_payment_plans" ("institutionId", "status");
CREATE INDEX IF NOT EXISTS "edu_payment_plans_cobro_idx"
  ON "edu_payment_plans" ("institutionId", "chargeId");
CREATE INDEX IF NOT EXISTS "edu_payment_plans_patient_idx"
  ON "edu_payment_plans" ("institutionId", "patientId", "createdAt");

-- Un plan no puede tener dos mensualidades con el mismo número.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_installments_numero_key"
  ON "edu_installments" ("planId", "number");
-- 🔴 Un pago liquida UNA mensualidad: el pago de dos meses son dos pagos.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_installments_paymentId_key"
  ON "edu_installments" ("paymentId");
CREATE INDEX IF NOT EXISTS "edu_installments_plan_idx"
  ON "edu_installments" ("institutionId", "planId");
-- "Qué vence esta semana" del instituto entero, sin recorrer plan por plan.
CREATE INDEX IF NOT EXISTS "edu_installments_vence_idx"
  ON "edu_installments" ("institutionId", "dueDate");


-- ── 4. Llaves foráneas ─────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que cada una va
-- envuelta en su bloque.
--
-- ⚠️ CASCADE vs SET NULL, con el criterio de la Ola 5:
--   · CASCADE  → lo que no tiene sentido sin su padre (el plan sin su
--     cobro, la mensualidad sin su plan). El producto NO borra nada de
--     esto — un plan se CANCELA; el CASCADE está para que borrar un
--     instituto entero no se atore.
--   · SET NULL → quien canceló (la constancia sobrevive con el texto) y
--     el pago de una mensualidad (si un admin borrara el pago, la
--     mensualidad debe volver a "sin pagar", no desaparecer).

DO $edu$
BEGIN
  ALTER TABLE "edu_payment_plans"
    ADD CONSTRAINT "edu_payment_plans_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_payment_plans"
    ADD CONSTRAINT "edu_payment_plans_chargeId_fkey"
    FOREIGN KEY ("chargeId") REFERENCES "edu_charges" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_payment_plans"
    ADD CONSTRAINT "edu_payment_plans_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "edu_patients" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_payment_plans"
    ADD CONSTRAINT "edu_payment_plans_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "edu_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_payment_plans"
    ADD CONSTRAINT "edu_payment_plans_cancelledByUserId_fkey"
    FOREIGN KEY ("cancelledByUserId") REFERENCES "edu_users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_installments"
    ADD CONSTRAINT "edu_installments_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_installments"
    ADD CONSTRAINT "edu_installments_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "edu_payment_plans" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;

DO $edu$
BEGIN
  ALTER TABLE "edu_installments"
    ADD CONSTRAINT "edu_installments_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "edu_payments" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 5. Comprobación ────────────────────────────────────────────────────
-- Las dos tablas existen y el enum tiene sus tres valores. Deben dar
-- 2 y 3.

SELECT COUNT(*) AS tablas
FROM information_schema.tables
WHERE table_name IN ('edu_payment_plans', 'edu_installments');

SELECT COUNT(*) AS estados
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'EduPaymentPlanStatus';
