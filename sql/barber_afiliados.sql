-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — PROGRAMA DE SOCIOS (afiliados del vertical).
--
-- Amplía sql/barber.sql + sql/barber_complemento.sql (que DEBEN estar
-- aplicados antes) con: la cuenta de socio de cada barbería, los clics de
-- su liga, la atribución (quién refirió a quién), las comisiones con su
-- estado y la config GLOBAL de montos.
--
-- Equivalente idempotente de los modelos BarberAffiliate* de
-- prisma/schema.prisma. Aplicar manualmente en Supabase (SQL editor).
-- Re-ejecutable: cada bloque comprueba existencia antes de crear.
--
-- NO TOCA NADA DEL DENTAL. El motor de afiliados dental (affiliates,
-- affiliate_commissions, affiliate_clicks…) sigue exactamente igual; estas
-- son tablas nuevas, con prefijo barber_affiliate_ y sin una sola
-- referencia a clinics ni a affiliates.
--
-- DINERO: DECIMAL(10,2) siempre, jamás double precision.
--
-- Nota sobre $$: usamos un único delimitador `$barberaf$` y NUNCA bloques
-- DO anidados (el parser SQL de Supabase rompe con $$ anidado).
-- ═══════════════════════════════════════════════════════════════════════


-- ── Enums nuevos ───────────────────────────────────────────────────────
DO $barberaf$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberAffiliateReferralStatus') THEN
    CREATE TYPE "BarberAffiliateReferralStatus" AS ENUM ('SIGNED_UP', 'PAYING', 'CHURNED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BarberAffiliateCommissionStatus') THEN
    CREATE TYPE "BarberAffiliateCommissionStatus" AS ENUM ('PENDING', 'AVAILABLE', 'PAID');
  END IF;
END
$barberaf$;


-- ── Tablas nuevas ──────────────────────────────────────────────────────

-- La barbería vista como SOCIO. 1:1 con barber_shops. La crea sola la app
-- la primera vez que la barbería entra a /barber/afiliados.
CREATE TABLE IF NOT EXISTS "barber_affiliate_accounts" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "payoutMethod" TEXT,
    "payoutDetails" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_affiliate_accounts_pkey" PRIMARY KEY ("id")
);

-- Un clic en la liga. barbershopId = la barbería DUEÑA de la liga (quien
-- cobra), nunca la que visita. counted = false para bots y repetidos.
CREATE TABLE IF NOT EXISTS "barber_affiliate_clicks" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "vid" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "counted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "barber_affiliate_clicks_pkey" PRIMARY KEY ("id")
);

-- La atribución. UNA por barbería referida y PERMANENTE: el índice único
-- de referredBarbershopId es lo que impide que a alguien le roben su
-- referida escribiendo una segunda fila.
CREATE TABLE IF NOT EXISTS "barber_affiliate_referrals" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "referredBarbershopId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "BarberAffiliateReferralStatus" NOT NULL DEFAULT 'SIGNED_UP',
    "firstTouchAt" TIMESTAMP(3) NOT NULL,
    "signedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstPaidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_affiliate_referrals_pkey" PRIMARY KEY ("id")
);

-- Comisión devengada. La idempotencia del devengo la garantiza el índice
-- único (referredBarbershopId, periodKey): sincronizar mil veces no
-- duplica un peso.
CREATE TABLE IF NOT EXISTS "barber_affiliate_commissions" (
    "id" TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "referredBarbershopId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "basis" JSONB,
    "status" "BarberAffiliateCommissionStatus" NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "payoutRef" TEXT,
    "payoutProofUrl" TEXT,
    "payoutNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_affiliate_commissions_pkey" PRIMARY KEY ("id")
);

-- Config GLOBAL (una sola fila id = 'default'). ÚNICA tabla del bloque sin
-- barbershopId, a propósito: si la comisión fuera por barbería, la
-- barbería podría fijarse su propia comisión.
CREATE TABLE IF NOT EXISTS "barber_affiliate_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'fixed',
    "fixedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "maxMonths" INTEGER NOT NULL DEFAULT 0,
    "holdDays" INTEGER NOT NULL DEFAULT 30,
    "minPayout" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "termsUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "barber_affiliate_config_pkey" PRIMARY KEY ("id")
);


-- ── Índices ────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "barber_affiliate_accounts_barbershopId_key" ON "barber_affiliate_accounts"("barbershopId");
CREATE UNIQUE INDEX IF NOT EXISTS "barber_affiliate_accounts_referralCode_key" ON "barber_affiliate_accounts"("referralCode");
CREATE INDEX IF NOT EXISTS "barber_affiliate_accounts_barbershopId_idx" ON "barber_affiliate_accounts"("barbershopId");

CREATE INDEX IF NOT EXISTS "barber_affiliate_clicks_barbershopId_createdAt_idx" ON "barber_affiliate_clicks"("barbershopId", "createdAt");
CREATE INDEX IF NOT EXISTS "barber_affiliate_clicks_code_vid_createdAt_idx" ON "barber_affiliate_clicks"("code", "vid", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "barber_affiliate_referrals_referredBarbershopId_key" ON "barber_affiliate_referrals"("referredBarbershopId");
CREATE INDEX IF NOT EXISTS "barber_affiliate_referrals_barbershopId_createdAt_idx" ON "barber_affiliate_referrals"("barbershopId", "createdAt");
CREATE INDEX IF NOT EXISTS "barber_affiliate_referrals_accountId_status_idx" ON "barber_affiliate_referrals"("accountId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "barber_affiliate_commissions_referredBarbershopId_periodKey_key" ON "barber_affiliate_commissions"("referredBarbershopId", "periodKey");
CREATE INDEX IF NOT EXISTS "barber_affiliate_commissions_barbershopId_status_idx" ON "barber_affiliate_commissions"("barbershopId", "status");
CREATE INDEX IF NOT EXISTS "barber_affiliate_commissions_accountId_createdAt_idx" ON "barber_affiliate_commissions"("accountId", "createdAt");


-- ── Foreign keys (idempotentes vía pg_constraint) ─────────────────────
-- ADD CONSTRAINT no soporta IF NOT EXISTS, así que cada uno se envuelve en
-- un IF NOT EXISTS contra pg_constraint dentro de un único bloque DO.
--
-- CASCADE hacia barber_shops en TODAS: borrar una barbería tiene que poder
-- llevarse su rastro de socio por delante. (Ver la lección del NoAction de
-- barber_appointment_services, que dejó "borrar barbería" tronando.)
DO $barberaf$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_affiliate_accounts_barbershopId_fkey') THEN
    ALTER TABLE "barber_affiliate_accounts" ADD CONSTRAINT "barber_affiliate_accounts_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_affiliate_clicks_barbershopId_fkey') THEN
    ALTER TABLE "barber_affiliate_clicks" ADD CONSTRAINT "barber_affiliate_clicks_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_affiliate_referrals_barbershopId_fkey') THEN
    ALTER TABLE "barber_affiliate_referrals" ADD CONSTRAINT "barber_affiliate_referrals_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_affiliate_referrals_accountId_fkey') THEN
    ALTER TABLE "barber_affiliate_referrals" ADD CONSTRAINT "barber_affiliate_referrals_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "barber_affiliate_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- La barbería REFERIDA. CASCADE: si se borra la cuenta referida, su
  -- atribución (y con ella sus comisiones) se va. Lo ya PAGADO queda en el
  -- comprobante de Rafael, no en esta tabla.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_affiliate_referrals_referredBarbershopId_fkey') THEN
    ALTER TABLE "barber_affiliate_referrals" ADD CONSTRAINT "barber_affiliate_referrals_referredBarbershopId_fkey" FOREIGN KEY ("referredBarbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_affiliate_commissions_barbershopId_fkey') THEN
    ALTER TABLE "barber_affiliate_commissions" ADD CONSTRAINT "barber_affiliate_commissions_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_affiliate_commissions_accountId_fkey') THEN
    ALTER TABLE "barber_affiliate_commissions" ADD CONSTRAINT "barber_affiliate_commissions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "barber_affiliate_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_affiliate_commissions_referralId_fkey') THEN
    ALTER TABLE "barber_affiliate_commissions" ADD CONSTRAINT "barber_affiliate_commissions_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "barber_affiliate_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$barberaf$;


-- ── Semilla de la config global ────────────────────────────────────────
-- Los MISMOS números que FALLBACK_BARBER_AFFILIATE_CONFIG en
-- src/lib/barber/affiliates.ts: 500 MXN fijos por barbería referida que
-- empiece a pagar, 30 días de retención, sin mínimo de cobro y sin
-- recurrencia. Rafael los edita AQUÍ, sin redeploy — la UI nunca escribe
-- un monto, solo lee esta fila.
--
-- Para cambiar a porcentaje del plan:
--   UPDATE "barber_affiliate_config"
--      SET "mode" = 'pct', "percent" = 20, "updatedAt" = CURRENT_TIMESTAMP
--    WHERE "id" = 'default';
--
-- Para hacerla recurrente los primeros 6 meses:
--   UPDATE "barber_affiliate_config"
--      SET "recurring" = true, "maxMonths" = 6, "updatedAt" = CURRENT_TIMESTAMP
--    WHERE "id" = 'default';
--
-- ON CONFLICT DO NOTHING: re-ejecutar el archivo NO pisa lo que Rafael ya
-- haya ajustado a mano.
INSERT INTO "barber_affiliate_config" (
  "id", "isEnabled", "mode", "fixedAmount", "percent", "currency",
  "recurring", "maxMonths", "holdDays", "minPayout", "termsUrl", "updatedAt"
) VALUES (
  'default', true, 'fixed', 500, 0, 'MXN',
  false, 0, 30, 0, NULL, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- CÓMO MARCAR UNA COMISIÓN COMO PAGADA (el pago es MANUAL, no hay
-- dispersión automática). El socio ve la referencia y el comprobante en su
-- panel en cuanto se corre esto:
--
--   UPDATE "barber_affiliate_commissions"
--      SET "status" = 'PAID',
--          "paidAt" = CURRENT_TIMESTAMP,
--          "payoutRef" = 'SPEI 1234567',
--          "payoutProofUrl" = 'https://…/comprobante.pdf',
--          "updatedAt" = CURRENT_TIMESTAMP
--    WHERE "id" = '<id de la comisión>';
--
-- Y para ver a quién le toca cobrar, con sus datos de depósito:
--
--   SELECT a."barbershopId", s."name", a."payoutMethod", a."payoutDetails",
--          SUM(c."amount") AS disponible
--     FROM "barber_affiliate_commissions" c
--     JOIN "barber_affiliate_accounts" a ON a."id" = c."accountId"
--     JOIN "barber_shops" s ON s."id" = a."barbershopId"
--    WHERE c."status" = 'AVAILABLE'
--    GROUP BY a."barbershopId", s."name", a."payoutMethod", a."payoutDetails"
--    ORDER BY disponible DESC;
-- ═══════════════════════════════════════════════════════════════════════
