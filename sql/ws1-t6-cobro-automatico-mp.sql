-- ============================================================================
-- WS1-T6 — Cobro automático con tarjeta (Mercado Pago Suscripciones /preapproval),
-- mejora 9 de la auditoría BEVADENT. OPCIONAL y APAGADO de fábrica.
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal no
--    toca la base.
--
-- TRES TABLAS NUEVAS, fuera de prisma/schema.prisma a propósito: el código usa
-- SQL crudo y pregunta con to_regclass si existen. Mientras no se pegue este
-- SQL la función entera está oculta (ni el interruptor ni el botón se ven) y el
-- webhook ignora los avisos de suscripciones con 200.
--
--   mp_cobro_automatico_config      — el interruptor por clínica (false de fábrica).
--   mp_cobros_automaticos           — una suscripción de MP por factura a plazos.
--   mp_cobros_automaticos_intentos  — cada cobro que MP intentó (authorized
--                                     payment): lo aprobado (con el Payment que
--                                     se creó) y lo rechazado (aviso a recepción).
--
-- La tarjeta NUNCA se guarda: vive en Mercado Pago. Aquí solo hay ids de MP, el
-- monto, el correo con el que el paciente entra a MP y los estados.
--
-- Plano e idempotente: se puede pegar dos veces. Sin DROP, sin UPDATE, sin DO $$.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "mp_cobro_automatico_config" (
  "clinicId"    text        PRIMARY KEY REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "enabled"     boolean     NOT NULL DEFAULT false,
  "updatedById" text        REFERENCES "users" ("id") ON DELETE SET NULL,
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "mp_cobros_automaticos" (
  "id"              text          PRIMARY KEY,
  "clinicId"        text          NOT NULL REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "invoiceId"       text          NOT NULL REFERENCES "invoices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "patientId"       text          REFERENCES "patients" ("id") ON DELETE SET NULL,
  -- El caso de ortodoncia desde el que se activó (si lo hay). Sin FK: el id de
  -- orthodontic_treatment_plans puede ser uuid, cuid o de siembra (todo text).
  "treatmentPlanId" text,
  "mpPreapprovalId" text          UNIQUE,
  -- user_id de MP de la cuenta que cobra: el pago se verifica contra ella.
  "mpCollectorId"   text,
  -- creating · pending · authorized · paused · cancelled
  "status"          text          NOT NULL DEFAULT 'creating',
  "amount"          numeric(12,2) NOT NULL,
  "payerEmail"      text          NOT NULL,
  "initPoint"       text,
  "startDate"       date,
  "endDate"         date,
  "nextPaymentDate" timestamptz,
  "cancelReason"    text,
  "lastSyncAt"      timestamptz,
  "createdById"     text          REFERENCES "users" ("id") ON DELETE SET NULL,
  "createdAt"       timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT "mp_cobros_automaticos_status_chk"
    CHECK ("status" IN ('creating','pending','authorized','paused','cancelled')),
  CONSTRAINT "mp_cobros_automaticos_amount_chk" CHECK ("amount" > 0)
);

-- UNA suscripción viva por factura: dos «Activar» a la vez no crean dos cobros.
CREATE UNIQUE INDEX IF NOT EXISTS "mp_cobros_automaticos_uno_vivo_por_factura"
  ON "mp_cobros_automaticos" ("invoiceId")
  WHERE "status" IN ('creating','pending','authorized','paused');

CREATE INDEX IF NOT EXISTS "mp_cobros_automaticos_clinic_idx"
  ON "mp_cobros_automaticos" ("clinicId", "status");

CREATE TABLE IF NOT EXISTS "mp_cobros_automaticos_intentos" (
  "id"                    text          PRIMARY KEY,
  "clinicId"              text          NOT NULL REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "cobroId"               text          NOT NULL REFERENCES "mp_cobros_automaticos" ("id") ON DELETE CASCADE,
  -- id del authorized payment de MP (o «suscripcion-cancelada:<preapproval>»
  -- cuando MP cancela la suscripción por su lado: también es aviso a recepción).
  "mpAuthorizedPaymentId" text          NOT NULL UNIQUE,
  "mpPaymentId"           text,
  "status"                text,
  "paymentStatus"         text,
  "statusDetail"          text,
  "amount"                numeric(12,2),
  -- El Payment de la factura que creó este cobro (sin FK: un reembolso o borrado
  -- de la factura no debe tumbar el rastro).
  "paymentRowId"          text,
  "avisoRecepcion"        boolean       NOT NULL DEFAULT false,
  "revisadoAt"            timestamptz,
  "revisadoById"          text          REFERENCES "users" ("id") ON DELETE SET NULL,
  "createdAt"             timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"             timestamptz   NOT NULL DEFAULT now()
);

-- El aviso de Caja: rechazados sin revisar de una clínica.
CREATE INDEX IF NOT EXISTS "mp_cobros_automaticos_intentos_aviso_idx"
  ON "mp_cobros_automaticos_intentos" ("clinicId", "createdAt" DESC)
  WHERE "avisoRecepcion" = true AND "revisadoAt" IS NULL;

-- Deny-all para anon/authenticated (Prisma usa el service role y salta RLS).
-- Con RLS activo y SIN políticas nadie más lee ni escribe estas tablas.
ALTER TABLE "mp_cobro_automatico_config"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_cobros_automaticos"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mp_cobros_automaticos_intentos" ENABLE ROW LEVEL SECURITY;

-- Verificación (solo lectura):
-- SELECT to_regclass('public.mp_cobro_automatico_config'), to_regclass('public.mp_cobros_automaticos'),
--        to_regclass('public.mp_cobros_automaticos_intentos');
-- SELECT c."name", k."enabled", k."updatedAt" FROM "mp_cobro_automatico_config" k JOIN "clinics" c ON c."id" = k."clinicId";
