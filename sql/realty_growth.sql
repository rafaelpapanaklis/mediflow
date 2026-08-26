-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INMUEBLES — CRECIMIENTO (Ola 2, terminal O2-T7)
--
-- Bot de WhatsApp · Campañas y reactivación · Reseñas a Google ·
-- Investigación de inquilino · Programa de socios.
--
-- Idempotente: se puede correr N veces. Todo va con IF NOT EXISTS y las
-- restricciones dentro de bloques DO con guarda contra pg_constraint, que
-- es como se aplican los sql/ de este repo (mismo criterio que
-- sql/barber_bot.sql y sql/barber_campanas.sql).
--
-- 🔴 MIENTRAS ESTE ARCHIVO NO SE CORRA, el panel NO truena: cada lectura
-- reconoce el 42P01 ("relation does not exist") y pinta "falta aplicar
-- sql/realty_growth.sql". Ver isMissingRealtyGrowthTable() en
-- src/lib/realty/bot/core.ts.
--
-- Convenciones que se respetan a propósito, para que el día que estas
-- tablas entren a prisma/schema.prisma el `migrate diff` salga vacío:
--   · nombres de columna en camelCase ENTRECOMILLADOS;
--   · TIMESTAMP(3) ... DEFAULT CURRENT_TIMESTAMP  ≡  DateTime @default(now())
--   · TEXT para los cuid();
--   · FK a realty_accounts(id) ON DELETE CASCADE: borrar la cuenta se
--     lleva TODO su rastro de crecimiento, igual que el resto del vertical.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. BOT DE WHATSAPP
-- ═══════════════════════════════════════════════════════════════════════

-- 🔴 `enabled` NACE EN false y `aiDailyCapMxn` NACE EN 0.
--
-- Las dos columnas están FUERA del jsonb a propósito: son las dos que
-- deciden si se le habla a un prospecto en nombre de la inmobiliaria y
-- cuánto se puede gastar haciéndolo, así que tienen que ser inspeccionables
-- con un SELECT y acotables con un CHECK. Todo lo demás (tono, qué sabe
-- hacer, horario) vive en `settings` porque cambia de forma seguido y no
-- pone dinero en riesgo.
--
-- El tope NO tiene valor "ilimitado". El CHECK lo encierra entre 0 y 500
-- pesos por día: no existe manera de dejar el bot encendido con gasto
-- abierto, ni desde la UI, ni desde la API, ni con un UPDATE a mano.
CREATE TABLE IF NOT EXISTS realty_bot_settings (
  "accountId"      TEXT PRIMARY KEY REFERENCES realty_accounts(id) ON DELETE CASCADE,
  enabled          BOOLEAN      NOT NULL DEFAULT false,
  "aiDailyCapMxn"  INTEGER      NOT NULL DEFAULT 0,
  settings         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  "updatedByUserId" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $realty_growth$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_bot_cap_bounded') THEN
    ALTER TABLE realty_bot_settings
      ADD CONSTRAINT realty_bot_cap_bounded
      CHECK ("aiDailyCapMxn" >= 0 AND "aiDailyCapMxn" <= 500);
  END IF;
END
$realty_growth$;

-- Gasto de IA POR CUENTA Y POR DÍA. `day` es la fecha en la ZONA DE LA
-- CUENTA (America/Mexico_City por default), no en UTC: un tope "por día"
-- que se reinicia a las 6 de la tarde no es un tope, es una sorpresa.
-- costMicros: 1 peso = 1 000 000 micros. Un turno cuesta fracciones de
-- centavo y sumarlo en centavos redondeados regala el tope.
CREATE TABLE IF NOT EXISTS realty_bot_spend (
  "accountId"  TEXT         NOT NULL REFERENCES realty_accounts(id) ON DELETE CASCADE,
  day          DATE         NOT NULL,
  "costMicros" BIGINT       NOT NULL DEFAULT 0,
  turns        INTEGER      NOT NULL DEFAULT 0,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("accountId", day)
);

-- Cada turno del bot: qué le escribieron, qué contestó y cuánto costó.
-- `correctedBody` es la corrección que escribe una persona desde el panel;
-- NO reescribe `outboundBody` — lo que se mandó, se mandó, y borrarlo haría
-- imposible entender por qué el bot dijo lo que dijo.
CREATE TABLE IF NOT EXISTS realty_bot_turns (
  id              TEXT         PRIMARY KEY,
  "accountId"     TEXT         NOT NULL REFERENCES realty_accounts(id) ON DELETE CASCADE,
  "threadId"      TEXT,
  "contactId"     TEXT,
  "leadId"        TEXT,
  phone           TEXT         NOT NULL,
  "inboundBody"   TEXT,
  "outboundBody"  TEXT,
  -- Por qué NO contestó (RealtyBotSkipReason). null = sí contestó.
  "skipReason"    TEXT,
  handoff         BOOLEAN      NOT NULL DEFAULT false,
  "handoffReason" TEXT,
  model           TEXT,
  "inputTokens"   INTEGER      NOT NULL DEFAULT 0,
  "outputTokens"  INTEGER      NOT NULL DEFAULT 0,
  "costMicros"    BIGINT       NOT NULL DEFAULT 0,
  -- Lo que el bot dedujo del prospecto en este turno (presupuesto, crédito,
  -- zona). Se guarda aunque se haya escrito ya en el lead: es la evidencia
  -- de DÓNDE salió el dato.
  extracted       JSONB,
  "correctedBody" TEXT,
  "correctedById" TEXT,
  "correctedAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS realty_bot_turns_account_created_idx
  ON realty_bot_turns ("accountId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS realty_bot_turns_thread_idx
  ON realty_bot_turns ("threadId", "createdAt" DESC);

-- Conversaciones que atiende UNA PERSONA. Mientras haya fila, el bot calla
-- en ese teléfono. Es lo que pasa cuando el prospecto pide humano o cuando
-- alguien del equipo toma el hilo desde el panel.
CREATE TABLE IF NOT EXISTS realty_bot_pauses (
  "accountId" TEXT         NOT NULL REFERENCES realty_accounts(id) ON DELETE CASCADE,
  phone       TEXT         NOT NULL,
  reason      TEXT,
  "pausedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("accountId", phone)
);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. CONSENTIMIENTO — la tabla que evita que Meta tumbe el número
-- ═══════════════════════════════════════════════════════════════════════

-- 🔴 El número de WhatsApp es DEL CLIENTE. Un reporte de spam se lo tumba a
-- él, no a DaleControl. Por eso la baja es una tabla propia, con índice
-- único por (cuenta, teléfono), y se consulta ANTES de cada envío de
-- campaña — no después, no "casi siempre".
--
-- scope:
--   MARKETING = no quiere campañas ni avisos comerciales (el default de una
--               baja: sigue pudiendo recibir el aviso de su visita).
--   ALL       = no quiere NADA automático.
-- source: REPLY (escribió BAJA) | MANUAL (alguien lo marcó) | IMPORT.
CREATE TABLE IF NOT EXISTS realty_contact_optouts (
  id          TEXT         PRIMARY KEY,
  "accountId" TEXT         NOT NULL REFERENCES realty_accounts(id) ON DELETE CASCADE,
  "contactId" TEXT,
  -- 10 dígitos (mxTenDigits). El teléfono y NO el contactId es la llave:
  -- la misma persona puede estar dos veces en la libreta y la baja es de
  -- la PERSONA, no del registro.
  phone       TEXT         NOT NULL,
  scope       TEXT         NOT NULL DEFAULT 'MARKETING',
  source      TEXT         NOT NULL DEFAULT 'REPLY',
  note        TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS realty_contact_optouts_account_phone_key
  ON realty_contact_optouts ("accountId", phone);
CREATE INDEX IF NOT EXISTS realty_contact_optouts_contact_idx
  ON realty_contact_optouts ("contactId");

DO $realty_growth$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_optout_scope_valid') THEN
    ALTER TABLE realty_contact_optouts
      ADD CONSTRAINT realty_optout_scope_valid CHECK (scope IN ('MARKETING', 'ALL'));
  END IF;
END
$realty_growth$;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. AJUSTES DE CRECIMIENTO POR CUENTA
-- ═══════════════════════════════════════════════════════════════════════

-- campaignDailyCap: TOPE DIARIO de mensajes de campaña por cuenta. Es
-- independiente del cupo del plan (messageQuota, que es mensual): protege
-- del envío masivo en un solo día, que es exactamente lo que dispara los
-- reportes de spam y las restricciones de Meta.
CREATE TABLE IF NOT EXISTS realty_growth_settings (
  "accountId"         TEXT PRIMARY KEY REFERENCES realty_accounts(id) ON DELETE CASCADE,
  "googleReviewUrl"   TEXT,
  "reviewsEnabled"    BOOLEAN      NOT NULL DEFAULT false,
  "campaignDailyCap"  INTEGER      NOT NULL DEFAULT 100,
  "priceDropEnabled"  BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $realty_growth$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_growth_daily_cap_bounded') THEN
    ALTER TABLE realty_growth_settings
      ADD CONSTRAINT realty_growth_daily_cap_bounded
      CHECK ("campaignDailyCap" >= 0 AND "campaignDailyCap" <= 500);
  END IF;
END
$realty_growth$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. CAMPAÑAS
-- ═══════════════════════════════════════════════════════════════════════

-- kind:
--   MANUAL      — lista segmentada a mano desde el CRM.
--   REACTIVACION— prospectos fríos de más de N días.
--   BAJADA_PRECIO — la casa que viste bajó de precio (la más rentable).
--   RESENA      — pedir reseña en Google tras una operación cerrada.
-- status: BORRADOR | PROGRAMADA | ENVIANDO | ENVIADA | CANCELADA
-- segment: el criterio EN CRUDO con el que se armó la lista. Se guarda para
--   poder explicar a quién se le mandó y por qué, meses después.
CREATE TABLE IF NOT EXISTS realty_campaigns (
  id              TEXT         PRIMARY KEY,
  "accountId"     TEXT         NOT NULL REFERENCES realty_accounts(id) ON DELETE CASCADE,
  name            TEXT         NOT NULL,
  kind            TEXT         NOT NULL DEFAULT 'MANUAL',
  status          TEXT         NOT NULL DEFAULT 'BORRADOR',
  -- Plantilla de WhatsApp (RealtyWaKind) con la que sale. Fuera de la
  -- ventana de 24 h no hay texto libre: o hay plantilla, o no se manda.
  "templateKind"  TEXT,
  -- Cuerpo para quien SÍ tenga la ventana abierta y para la vista previa.
  body            TEXT,
  "propertyId"    TEXT,
  segment         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  "scheduledAt"   TIMESTAMP(3),
  "startedAt"     TIMESTAMP(3),
  "finishedAt"    TIMESTAMP(3),
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS realty_campaigns_account_status_idx
  ON realty_campaigns ("accountId", status, "scheduledAt");
CREATE INDEX IF NOT EXISTS realty_campaigns_account_created_idx
  ON realty_campaigns ("accountId", "createdAt" DESC);
-- Una sola campaña viva de bajada de precio por inmueble: sin esto, tres
-- ajustes de precio en una semana son tres WhatsApps a la misma persona.
CREATE UNIQUE INDEX IF NOT EXISTS realty_campaigns_price_drop_open_key
  ON realty_campaigns ("accountId", "propertyId")
  WHERE kind = 'BAJADA_PRECIO' AND status IN ('BORRADOR', 'PROGRAMADA', 'ENVIANDO');

DO $realty_growth$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_campaign_status_valid') THEN
    ALTER TABLE realty_campaigns
      ADD CONSTRAINT realty_campaign_status_valid
      CHECK (status IN ('BORRADOR', 'PROGRAMADA', 'ENVIANDO', 'ENVIADA', 'CANCELADA'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_campaign_kind_valid') THEN
    ALTER TABLE realty_campaigns
      ADD CONSTRAINT realty_campaign_kind_valid
      CHECK (kind IN ('MANUAL', 'REACTIVACION', 'BAJADA_PRECIO', 'RESENA'));
  END IF;
END
$realty_growth$;

-- Un destinatario por fila. `status` OMITIDO + `skipReason` es lo que
-- permite enseñar "no se le mandó a 12 personas porque pidieron baja"
-- en vez de un silencio.
CREATE TABLE IF NOT EXISTS realty_campaign_recipients (
  id            TEXT         PRIMARY KEY,
  "campaignId"  TEXT         NOT NULL REFERENCES realty_campaigns(id) ON DELETE CASCADE,
  "accountId"   TEXT         NOT NULL REFERENCES realty_accounts(id) ON DELETE CASCADE,
  "contactId"   TEXT,
  phone         TEXT         NOT NULL,
  name          TEXT,
  params        JSONB,
  status        TEXT         NOT NULL DEFAULT 'PENDIENTE',
  "skipReason"  TEXT,
  "messageId"   TEXT,
  error         TEXT,
  "sentAt"      TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Correr el envío dos veces NO le manda dos veces a la misma persona.
CREATE UNIQUE INDEX IF NOT EXISTS realty_campaign_recipients_unique
  ON realty_campaign_recipients ("campaignId", phone);
CREATE INDEX IF NOT EXISTS realty_campaign_recipients_pending_idx
  ON realty_campaign_recipients ("campaignId", status);
CREATE INDEX IF NOT EXISTS realty_campaign_recipients_account_sent_idx
  ON realty_campaign_recipients ("accountId", "sentAt");

DO $realty_growth$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_recipient_status_valid') THEN
    ALTER TABLE realty_campaign_recipients
      ADD CONSTRAINT realty_recipient_status_valid
      CHECK (status IN ('PENDIENTE', 'ENVIADO', 'FALLIDO', 'OMITIDO'));
  END IF;
END
$realty_growth$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. VIGILANCIA DE PRECIO — el disparador de "bajó de precio la casa que viste"
-- ═══════════════════════════════════════════════════════════════════════

-- El inmueble no guarda su precio anterior (realty_properties.price se
-- pisa), y prisma/schema.prisma NO se toca en esta ola. Así que la vigilancia
-- lleva su propia foto del último precio visto: el barrido compara, y si
-- BAJÓ, arma la campaña. Sin esto habría que adivinar el histórico.
CREATE TABLE IF NOT EXISTS realty_property_price_watch (
  "propertyId"  TEXT         PRIMARY KEY,
  "accountId"   TEXT         NOT NULL REFERENCES realty_accounts(id) ON DELETE CASCADE,
  -- Precio de la operación que anuncia (venta o renta), en la moneda del
  -- inmueble. NUMERIC(14,2) para casar con realty_properties.price.
  "lastPrice"   NUMERIC(14,2) NOT NULL,
  currency      TEXT         NOT NULL DEFAULT 'MXN',
  operation     TEXT         NOT NULL DEFAULT 'VENTA',
  "lastDropAt"  TIMESTAMP(3),
  "lastDropFrom" NUMERIC(14,2),
  "checkedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS realty_price_watch_account_idx
  ON realty_property_price_watch ("accountId", "checkedAt");

-- ═══════════════════════════════════════════════════════════════════════
-- 6. INVESTIGACIÓN DE INQUILINO
-- ═══════════════════════════════════════════════════════════════════════

-- 🔴 CONSULTAR BURÓ SIN PERMISO DEL INVESTIGADO ES ILEGAL (LFPDPPP art. 8 y
-- Ley para Regular las Sociedades de Información Crediticia art. 28: la
-- consulta necesita autorización EXPRESA del cliente). Por eso el
-- consentimiento no es un checkbox opcional: sin `consentAt` la solicitud
-- NO puede salir de PENDIENTE_CONSENTIMIENTO, y eso lo garantiza el CHECK
-- de abajo, no solo la UI.
--
-- status:
--   PENDIENTE_CONSENTIMIENTO — capturada, falta que el investigado autorice
--   SOLICITADA               — ya con consentimiento, esperando al proveedor
--   EN_PROCESO               — el proveedor la está trabajando
--   LISTA                    — hay resultado adjunto
--   CANCELADA
-- tier: BASICA | COMPLETA
-- provider: MANUAL (hoy: la tramita alguien de DaleControl) | el id del
--   proveedor cuando haya convenio. Ver el adaptador en
--   src/lib/realty/screening.ts.
CREATE TABLE IF NOT EXISTS realty_screening_requests (
  id                 TEXT         PRIMARY KEY,
  "accountId"        TEXT         NOT NULL REFERENCES realty_accounts(id) ON DELETE CASCADE,
  "contactId"        TEXT         NOT NULL,
  "leaseId"          TEXT,
  "leasePartyId"     TEXT,
  "propertyId"       TEXT,
  tier               TEXT         NOT NULL DEFAULT 'BASICA',
  provider           TEXT         NOT NULL DEFAULT 'MANUAL',
  "providerRef"      TEXT,
  status             TEXT         NOT NULL DEFAULT 'PENDIENTE_CONSENTIMIENTO',
  -- Lo que el investigado autoriza que se consulte. Se guarda el TEXTO que
  -- aceptó, no solo un booleano: dentro de dos años hay que poder enseñar
  -- QUÉ decía la autorización que firmó.
  "consentText"      TEXT,
  "consentAt"        TIMESTAMP(3),
  "consentName"      TEXT,
  "consentIp"        TEXT,
  "consentUserAgent" TEXT,
  -- Datos del investigado (nombre, ingreso declarado, empleo, referencias).
  -- Lo mínimo indispensable: aquí NO se guardan documentos de identidad ni
  -- números de cuenta — eso viaja al proveedor y vuelve como resultado.
  applicant          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  "priceCents"       INTEGER,
  currency           TEXT         NOT NULL DEFAULT 'MXN',
  -- Resultado
  "resultUrl"        TEXT,
  "resultSummary"    TEXT,
  "riskLevel"        TEXT,
  recommendation     TEXT,
  "requestedById"    TEXT,
  "requestedAt"      TIMESTAMP(3),
  "deliveredAt"      TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS realty_screening_account_status_idx
  ON realty_screening_requests ("accountId", status, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS realty_screening_contact_idx
  ON realty_screening_requests ("contactId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS realty_screening_lease_idx
  ON realty_screening_requests ("leaseId");

DO $realty_growth$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_screening_status_valid') THEN
    ALTER TABLE realty_screening_requests
      ADD CONSTRAINT realty_screening_status_valid
      CHECK (status IN ('PENDIENTE_CONSENTIMIENTO', 'SOLICITADA', 'EN_PROCESO', 'LISTA', 'CANCELADA'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_screening_tier_valid') THEN
    ALTER TABLE realty_screening_requests
      ADD CONSTRAINT realty_screening_tier_valid CHECK (tier IN ('BASICA', 'COMPLETA'));
  END IF;
  -- 🔴 LA GARANTÍA LEGAL, EN LA BASE: sin consentimiento con fecha, la
  -- solicitud no avanza. Un bug de UI no puede saltarse esto.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_screening_needs_consent') THEN
    ALTER TABLE realty_screening_requests
      ADD CONSTRAINT realty_screening_needs_consent
      CHECK (status IN ('PENDIENTE_CONSENTIMIENTO', 'CANCELADA') OR "consentAt" IS NOT NULL);
  END IF;
END
$realty_growth$;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. PROGRAMA DE SOCIOS (AFILIADOS)
-- ═══════════════════════════════════════════════════════════════════════

-- Config de PLATAFORMA, no de una cuenta: una sola fila, id = 'default'.
-- Mismo criterio que realty_plan_configs (sin accountId a propósito).
-- El monto es EDITABLE sin redeploy — cero pesos escritos en el código.
CREATE TABLE IF NOT EXISTS realty_affiliate_config (
  id                  TEXT         PRIMARY KEY DEFAULT 'default',
  enabled             BOOLEAN      NOT NULL DEFAULT true,
  -- Porcentaje de la mensualidad de la cuenta referida. Decimal para poder
  -- poner 12.5 sin pelearse con enteros.
  "commissionPct"     NUMERIC(5,2) NOT NULL DEFAULT 20,
  -- Cuántos meses se paga la comisión. -1 = mientras la referida siga
  -- pagando (mismo criterio de "ilimitado" que el resto del vertical).
  "commissionMonths"  INTEGER      NOT NULL DEFAULT 12,
  -- Días que dura la cookie de atribución.
  "cookieDays"        INTEGER      NOT NULL DEFAULT 60,
  -- Mínimo para poder solicitar pago, en centavos.
  "payoutMinCents"    INTEGER      NOT NULL DEFAULT 50000,
  terms               TEXT,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO realty_affiliate_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

DO $realty_growth$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_affiliate_config_single') THEN
    ALTER TABLE realty_affiliate_config
      ADD CONSTRAINT realty_affiliate_config_single CHECK (id = 'default');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_affiliate_pct_bounded') THEN
    ALTER TABLE realty_affiliate_config
      ADD CONSTRAINT realty_affiliate_pct_bounded
      CHECK ("commissionPct" >= 0 AND "commissionPct" <= 100);
  END IF;
END
$realty_growth$;

-- El SOCIO. Hoy siempre es una cuenta de inmuebles que recomienda a otra
-- (espejo de barber). `accountId` es único: una cuenta, un código.
CREATE TABLE IF NOT EXISTS realty_affiliates (
  id           TEXT         PRIMARY KEY,
  "accountId"  TEXT         NOT NULL REFERENCES realty_accounts(id) ON DELETE CASCADE,
  code         TEXT         NOT NULL,
  status       TEXT         NOT NULL DEFAULT 'ACTIVO',
  "payoutInfo" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS realty_affiliates_account_key ON realty_affiliates ("accountId");
CREATE UNIQUE INDEX IF NOT EXISTS realty_affiliates_code_key ON realty_affiliates (code);

DO $realty_growth$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_affiliate_status_valid') THEN
    ALTER TABLE realty_affiliates
      ADD CONSTRAINT realty_affiliate_status_valid CHECK (status IN ('ACTIVO', 'SUSPENDIDO'));
  END IF;
END
$realty_growth$;

-- Clics de atribución. `vid` es el id anónimo del visitante (cookie); el
-- único por (code, vid, día) es lo que evita que F5 infle el contador.
-- NO se guarda la IP en claro: solo un hash, y sirve para detectar bots.
CREATE TABLE IF NOT EXISTS realty_affiliate_clicks (
  id          TEXT         PRIMARY KEY,
  code        TEXT         NOT NULL,
  vid         TEXT         NOT NULL,
  day         DATE         NOT NULL,
  "ipHash"    TEXT,
  "userAgent" TEXT,
  "isBot"     BOOLEAN      NOT NULL DEFAULT false,
  "landedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS realty_affiliate_clicks_dedupe
  ON realty_affiliate_clicks (code, vid, day);
CREATE INDEX IF NOT EXISTS realty_affiliate_clicks_code_idx
  ON realty_affiliate_clicks (code, "landedAt" DESC);

-- La cuenta referida. Único por cuenta referida: una cuenta tiene UN padrino
-- y no se lo puede robar otro socio después.
CREATE TABLE IF NOT EXISTS realty_affiliate_referrals (
  id                  TEXT         PRIMARY KEY,
  "affiliateId"       TEXT         NOT NULL REFERENCES realty_affiliates(id) ON DELETE CASCADE,
  "referredAccountId" TEXT         NOT NULL REFERENCES realty_accounts(id) ON DELETE CASCADE,
  "attributedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "firstPaidAt"       TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS realty_affiliate_referrals_account_key
  ON realty_affiliate_referrals ("referredAccountId");
CREATE INDEX IF NOT EXISTS realty_affiliate_referrals_affiliate_idx
  ON realty_affiliate_referrals ("affiliateId", "attributedAt" DESC);

-- La comisión DEVENGADA. Nace cuando la cuenta referida PAGA (espejo de
-- barber: al pagar, no al registrarse).
-- status: PENDIENTE → APROBADA → PAGADA (o CANCELADA por reembolso).
CREATE TABLE IF NOT EXISTS realty_affiliate_commissions (
  id                  TEXT         PRIMARY KEY,
  "affiliateId"       TEXT         NOT NULL REFERENCES realty_affiliates(id) ON DELETE CASCADE,
  "referredAccountId" TEXT         NOT NULL REFERENCES realty_accounts(id) ON DELETE CASCADE,
  "amountCents"       INTEGER      NOT NULL,
  currency            TEXT         NOT NULL DEFAULT 'MXN',
  "baseCents"         INTEGER      NOT NULL DEFAULT 0,
  "commissionPct"     NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- "YYYY-MM" del mes que se cobró.
  "periodMonth"       TEXT         NOT NULL,
  status              TEXT         NOT NULL DEFAULT 'PENDIENTE',
  -- Id de la factura de Stripe que la disparó. ÚNICO: el webhook de Stripe
  -- reentrega, y sin esto cada reentrega devengaba otra comisión.
  "sourceRef"         TEXT,
  "paidAt"            TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS realty_affiliate_commissions_source_key
  ON realty_affiliate_commissions ("sourceRef")
  WHERE "sourceRef" IS NOT NULL;
CREATE INDEX IF NOT EXISTS realty_affiliate_commissions_affiliate_idx
  ON realty_affiliate_commissions ("affiliateId", status, "createdAt" DESC);

DO $realty_growth$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_commission_status_valid') THEN
    ALTER TABLE realty_affiliate_commissions
      ADD CONSTRAINT realty_commission_status_valid
      CHECK (status IN ('PENDIENTE', 'APROBADA', 'PAGADA', 'CANCELADA'));
  END IF;
END
$realty_growth$;

COMMIT;
