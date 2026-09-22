-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T5 · ANTICIPO POR WHATSAPP CON MERCADO PAGO.
--
-- «El paciente elige horario → la IA le indica que requiere anticipo → le
--  manda el link de pago → al acreditarse queda confirmada la cita.»
--
-- ⚠️ APLICAR ANTES DE INTEGRAR LA RAMA. El código nuevo lee
-- "appointments"."holdExpiresAt" en TODAS las consultas de disponibilidad:
-- si la rama entra sin esta columna, la agenda entera falla (P2022).
--
-- Contenido:
--   1 columna nueva  · "appointments"."holdExpiresAt" (+ 1 índice)
--   3 tablas nuevas  · clinic_mercadopago, appointment_deposits,
--                      appointment_deposit_payments
--   8 índices        · 2 únicos + 6 de consulta (1 de ellos en "appointments")
--   7 llaves foráneas
--   7 CHECK (solo en las tablas nuevas; a "appointments" no se le añade ninguno)
--   RLS deny-all en las 3 tablas nuevas
--   1 función + 1 trigger · appt_liberar_apartado_vencido
--
-- NO toca ni una fila que ya exista. Las citas de hoy quedan con
-- "holdExpiresAt" = NULL, que significa exactamente lo de siempre.
--
-- IDEMPOTENTE: cada bloque comprueba existencia antes de crear; correrlo
-- varias veces no da errores ni duplicados. CERO DROP.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
--
-- Nota sobre $$: delimitadores con nombre ($anticipo$) y NUNCA bloques DO
-- anidados — el parser SQL de Supabase rompe con $$ anidado.
-- Nota sobre los nombres: camelCase ENTRECOMILLADO, como los escribe Prisma.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. La cita apartada ────────────────────────────────────────────────
-- Una cita SCHEDULED con "holdExpiresAt" APARTA su hueco solo hasta esa
-- fecha. Pasada, deja de contar para la disponibilidad (el código la ignora
-- en todas las consultas: src/lib/agenda/apartado.ts). NULL = cita normal.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "holdExpiresAt" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "appointments_holdExpiresAt_idx"
  ON "appointments" ("holdExpiresAt");


-- ── 2. La cuenta de Mercado Pago de la clínica ─────────────────────────
-- Una fila por clínica. Los tokens OAuth van CIFRADOS (AES-256-GCM, el
-- mismo envelope que la llave de Facturapi); el servidor se niega a
-- guardarlos en claro. Sin cuenta conectada, el anticipo está apagado.
CREATE TABLE IF NOT EXISTS "clinic_mercadopago" (
  "clinicId"            TEXT NOT NULL,
  "mpUserId"            TEXT,
  "mpNickname"          TEXT,
  "mpEmail"             TEXT,
  "liveMode"            BOOLEAN,
  "accessToken"         TEXT,
  "refreshToken"        TEXT,
  "tokenExpiresAt"      TIMESTAMPTZ(6),
  "connectedAt"         TIMESTAMPTZ(6),
  "connectedById"       TEXT,
  "disconnectedAt"      TIMESTAMPTZ(6),
  "depositEnabled"      BOOLEAN NOT NULL DEFAULT false,
  "depositMode"         TEXT NOT NULL DEFAULT 'fixed',
  "depositAmount"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "depositPercent"      INTEGER NOT NULL DEFAULT 0,
  "holdMinutes"         INTEGER NOT NULL DEFAULT 30,
  -- Comisión de DaleControl (marketplace_fee). Arranca en 0: sale APAGADA.
  "marketplaceFeeMode"  TEXT NOT NULL DEFAULT 'fixed',
  "marketplaceFeeValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clinic_mercadopago_pkey" PRIMARY KEY ("clinicId")
);


-- ── 3. Cada anticipo pedido ────────────────────────────────────────────
-- El rastro: a qué cita, cuánto se pidió (lo decide el SERVIDOR), con qué
-- preferencia de MP, hasta cuándo, y qué pasó.
CREATE TABLE IF NOT EXISTS "appointment_deposits" (
  "id"                   TEXT NOT NULL,
  "clinicId"             TEXT NOT NULL,
  "appointmentId"        TEXT,
  "patientId"            TEXT NOT NULL,
  "amount"               DOUBLE PRECISION NOT NULL,
  "marketplaceFee"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency"             TEXT NOT NULL DEFAULT 'MXN',
  "status"               TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt"            TIMESTAMPTZ(6) NOT NULL,
  "mpPreferenceId"       TEXT,
  "checkoutUrl"          TEXT,
  "mpCollectorId"        TEXT,
  "waPhone"              TEXT,
  "mpPaymentId"          TEXT,
  "paidAmount"           DOUBLE PRECISION,
  "paidAt"               TIMESTAMPTZ(6),
  "appointmentConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "lastMpStatus"         TEXT,
  "lastMpStatusDetail"   TEXT,
  "noticeSentAt"         TIMESTAMPTZ(6),
  "noticeError"          TEXT,
  "createdAt"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "appointment_deposits_pkey" PRIMARY KEY ("id")
);


-- ── 4. Cada pago aprobado que se aplicó ────────────────────────────────
-- "mpPaymentId" ÚNICO: es lo que hace idempotente al webhook. Mercado Pago
-- reintenta y el mismo pago puede llegar tres veces; solo la primera entrega
-- crea el saldo a favor. Las otras chocan con este índice y no hacen nada.
CREATE TABLE IF NOT EXISTS "appointment_deposit_payments" (
  "id"              TEXT NOT NULL,
  "clinicId"        TEXT NOT NULL,
  "depositId"       TEXT NOT NULL,
  "mpPaymentId"     TEXT NOT NULL,
  "amount"          DOUBLE PRECISION NOT NULL,
  "currency"        TEXT NOT NULL,
  "dateApproved"    TIMESTAMPTZ(6),
  "payerEmail"      TEXT,
  "paymentMethodId" TEXT,
  "patientCreditId" TEXT,
  "anomaly"         TEXT,
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "appointment_deposit_payments_pkey" PRIMARY KEY ("id")
);


-- ── 5. Índices ─────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_deposit_payments_mpPaymentId_key"
  ON "appointment_deposit_payments" ("mpPaymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_deposit_payments_patientCreditId_key"
  ON "appointment_deposit_payments" ("patientCreditId");
CREATE INDEX IF NOT EXISTS "appointment_deposit_payments_clinicId_createdAt_idx"
  ON "appointment_deposit_payments" ("clinicId", "createdAt");
CREATE INDEX IF NOT EXISTS "appointment_deposit_payments_depositId_idx"
  ON "appointment_deposit_payments" ("depositId");
CREATE INDEX IF NOT EXISTS "appointment_deposits_clinicId_createdAt_idx"
  ON "appointment_deposits" ("clinicId", "createdAt");
-- La del cron: «los PENDING que ya vencieron».
CREATE INDEX IF NOT EXISTS "appointment_deposits_status_expiresAt_idx"
  ON "appointment_deposits" ("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "appointment_deposits_appointmentId_idx"
  ON "appointment_deposits" ("appointmentId");


-- ── 6. Llaves foráneas ─────────────────────────────────────────────────
-- CASCADE en clínica y paciente (igual que patient_credits). SET NULL en la
-- cita: si alguien borra la cita, el rastro del dinero se queda.
DO $anticipo$
BEGIN
  ALTER TABLE "clinic_mercadopago"
    ADD CONSTRAINT "clinic_mercadopago_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;

DO $anticipo$
BEGIN
  ALTER TABLE "clinic_mercadopago"
    ADD CONSTRAINT "clinic_mercadopago_connectedById_fkey"
    FOREIGN KEY ("connectedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;

DO $anticipo$
BEGIN
  ALTER TABLE "appointment_deposits"
    ADD CONSTRAINT "appointment_deposits_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;

DO $anticipo$
BEGIN
  ALTER TABLE "appointment_deposits"
    ADD CONSTRAINT "appointment_deposits_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;

DO $anticipo$
BEGIN
  ALTER TABLE "appointment_deposits"
    ADD CONSTRAINT "appointment_deposits_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;

DO $anticipo$
BEGIN
  ALTER TABLE "appointment_deposit_payments"
    ADD CONSTRAINT "appointment_deposit_payments_depositId_fkey"
    FOREIGN KEY ("depositId") REFERENCES "appointment_deposits"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;

DO $anticipo$
BEGIN
  ALTER TABLE "appointment_deposit_payments"
    ADD CONSTRAINT "appointment_deposit_payments_patientCreditId_fkey"
    FOREIGN KEY ("patientCreditId") REFERENCES "patient_credits"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;


-- ── 7. CHECK: lo que la base NO deja escribir ──────────────────────────
-- Una segunda red por debajo de la validación del servidor.
DO $anticipo$
BEGIN
  ALTER TABLE "clinic_mercadopago" ADD CONSTRAINT "clinic_mercadopago_depositMode_chk"
    CHECK ("depositMode" IN ('fixed', 'percent', 'total'));
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;

DO $anticipo$
BEGIN
  ALTER TABLE "clinic_mercadopago" ADD CONSTRAINT "clinic_mercadopago_depositValues_chk"
    CHECK ("depositAmount" >= 0 AND "depositPercent" BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;

DO $anticipo$
BEGIN
  ALTER TABLE "clinic_mercadopago" ADD CONSTRAINT "clinic_mercadopago_holdMinutes_chk"
    CHECK ("holdMinutes" BETWEEN 10 AND 240);
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;

DO $anticipo$
BEGIN
  ALTER TABLE "clinic_mercadopago" ADD CONSTRAINT "clinic_mercadopago_fee_chk"
    CHECK ("marketplaceFeeMode" IN ('fixed', 'percent')
           AND "marketplaceFeeValue" >= 0
           AND ("marketplaceFeeMode" <> 'percent' OR "marketplaceFeeValue" < 100));
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;

DO $anticipo$
BEGIN
  ALTER TABLE "appointment_deposits" ADD CONSTRAINT "appointment_deposits_status_chk"
    CHECK ("status" IN ('PENDING', 'PAID', 'EXPIRED', 'FAILED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;

DO $anticipo$
BEGIN
  ALTER TABLE "appointment_deposits" ADD CONSTRAINT "appointment_deposits_amount_chk"
    CHECK ("amount" > 0 AND "marketplaceFee" >= 0 AND "marketplaceFee" < "amount");
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;

DO $anticipo$
BEGIN
  ALTER TABLE "appointment_deposit_payments" ADD CONSTRAINT "appointment_deposit_payments_amount_chk"
    CHECK ("amount" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;

-- ── 8. RLS deny-all (patrón sql/rls-deny-all-policies.sql) ─────────────
-- DaleControl lee solo por Prisma + service role, que no pasa por RLS.
DO $anticipo$
DECLARE
  t    text;
  tbls text[] := ARRAY['clinic_mercadopago', 'appointment_deposits', 'appointment_deposit_payments'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        t || '_deny_anon', t
      );
    END IF;
  END LOOP;
END
$anticipo$;


-- ── 9. El hueco apartado que caduca, también para la constraint ────────
-- appt_doctor_no_overlap (y la de sillón) cuentan cualquier cita que no esté
-- CANCELLED/NO_SHOW. Postgres no admite now() en el WHERE de una EXCLUDE, así
-- que una cita apartada y VENCIDA seguiría bloqueando el INSERT de la
-- siguiente aunque todas las consultas de la app digan que el hueco está
-- libre. Este trigger cierra esa brecha en UN sitio, para TODOS los que
-- escriben citas (bot, panel, portal, página pública, Sabina…):
--
--  (a) Antes de que una cita que OCUPA se escriba, cancela las citas
--      apartadas y ya vencidas del mismo doctor (o sillón) que se le cruzan.
--      Mismo intervalo semiabierto [) que la constraint. La constraint se
--      comprueba después de este trigger, así que la nueva cita entra.
--  (b) Una cita que DEJA de estar SCHEDULED (se paga y se confirma, la
--      recepción la confirma o la cancela, se libera) pierde el apartado:
--      "holdExpiresAt" vuelve a NULL. Si no, al volver a SCHEDULED —un
--      reagendado, una reactivación— nacería «vencida» y la agenda (y el
--      cron) la tratarían como hueco libre aunque estuviera pagada.
--
-- Que el cron no corra NO deja la agenda apartada: la caducidad la da el
-- dato; el cron solo marca el anticipo como vencido y avisa al paciente.
CREATE OR REPLACE FUNCTION "appt_liberar_apartado_vencido"() RETURNS trigger
LANGUAGE plpgsql AS $anticipo$
BEGIN
  IF NEW."status" <> 'SCHEDULED' AND NEW."holdExpiresAt" IS NOT NULL THEN
    NEW."holdExpiresAt" := NULL;
  END IF;

  -- Solo una cita que ocupa (la misma condición que la constraint) choca.
  IF NEW."status" IN ('CANCELLED', 'NO_SHOW') OR NEW."overrideReason" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE "appointments" AS a
     SET "status"       = 'CANCELLED',
         "cancelledAt"  = now(),
         "cancelReason" = 'Anticipo no pagado a tiempo: el horario se liberó'
   WHERE a."clinicId" = NEW."clinicId"
     AND a."id" <> NEW."id"
     AND a."status" = 'SCHEDULED'
     AND a."holdExpiresAt" IS NOT NULL
     AND a."holdExpiresAt" <= now()
     AND a."overrideReason" IS NULL
     AND (a."doctorId" = NEW."doctorId"
          OR (NEW."resourceId" IS NOT NULL AND a."resourceId" = NEW."resourceId"))
     AND tstzrange(a."startsAt", a."endsAt", '[)') && tstzrange(NEW."startsAt", NEW."endsAt", '[)');

  RETURN NEW;
END
$anticipo$;

DO $anticipo$
BEGIN
  CREATE TRIGGER "appt_liberar_apartado_vencido"
    BEFORE INSERT OR UPDATE OF "startsAt", "endsAt", "doctorId", "resourceId", "status", "overrideReason"
    ON "appointments"
    FOR EACH ROW EXECUTE FUNCTION "appt_liberar_apartado_vencido"();
EXCEPTION WHEN duplicate_object THEN NULL;
END
$anticipo$;


-- ── 10. Comprobación ───────────────────────────────────────────────────
-- Tiene que devolver: columna 1, tablas 3, llaves 7, trigger 1.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'appointments' AND column_name = 'holdExpiresAt')         AS columna,
  (SELECT count(*) FROM pg_tables
     WHERE tablename IN ('clinic_mercadopago', 'appointment_deposits', 'appointment_deposit_payments')) AS tablas,
  (SELECT count(*) FROM pg_constraint
     WHERE contype = 'f' AND conrelid IN ('clinic_mercadopago'::regclass,
                                          'appointment_deposits'::regclass,
                                          'appointment_deposit_payments'::regclass))              AS llaves,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'appt_liberar_apartado_vencido')          AS trigger;
