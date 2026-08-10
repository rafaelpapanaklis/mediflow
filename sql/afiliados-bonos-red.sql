-- Afiliados — BONOS POR RED (ago 2026). Aditivo e idempotente.
--
-- Premia al afiliado por las clínicas ACTIVAS que trajeron SUS VENDEDORES
-- (AffiliateSellerAttribution), no las que trajo él mismo — para esas ya
-- existen los bonos propios de sql/afiliados-hitos.sql.
--
-- Se puede correr las veces que haga falta: todo va con IF NOT EXISTS.
--
-- ⚠️ Si ya corriste una versión anterior de este archivo con OTROS nombres de
-- columna, vuelve a correrlo: las que falten se agregan y las que sobren se
-- quedan sin usar (inofensivas). El código lee EXACTAMENTE estos nombres.

-- ── 1. Los 5 escalones en la config del programa ─────────────────────────
-- 5 umbrales + 5 pagos únicos + 5 mensuales + el interruptor. Los montos por
-- defecto dejan el mensual en exactamente 1/8 del pago único: el mensual
-- iguala al único a los 8 meses y a partir del noveno lo supera. Rafael los
-- edita en /admin → Afiliados → Esquema de pago.
ALTER TABLE "affiliate_payout_config"
  ADD COLUMN IF NOT EXISTS "networkBonusEnabled"     boolean          NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "networkTier1Clinics"     integer          NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "networkTier1OnceMxn"     double precision NOT NULL DEFAULT 3000,
  ADD COLUMN IF NOT EXISTS "networkTier1MonthlyMxn"  double precision NOT NULL DEFAULT 375,
  ADD COLUMN IF NOT EXISTS "networkTier2Clinics"     integer          NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "networkTier2OnceMxn"     double precision NOT NULL DEFAULT 15000,
  ADD COLUMN IF NOT EXISTS "networkTier2MonthlyMxn"  double precision NOT NULL DEFAULT 1875,
  ADD COLUMN IF NOT EXISTS "networkTier3Clinics"     integer          NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "networkTier3OnceMxn"     double precision NOT NULL DEFAULT 40000,
  ADD COLUMN IF NOT EXISTS "networkTier3MonthlyMxn"  double precision NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS "networkTier4Clinics"     integer          NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS "networkTier4OnceMxn"     double precision NOT NULL DEFAULT 120000,
  ADD COLUMN IF NOT EXISTS "networkTier4MonthlyMxn"  double precision NOT NULL DEFAULT 15000,
  ADD COLUMN IF NOT EXISTS "networkTier5Clinics"     integer          NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS "networkTier5OnceMxn"     double precision NOT NULL DEFAULT 400000,
  ADD COLUMN IF NOT EXISTS "networkTier5MonthlyMxn"  double precision NOT NULL DEFAULT 50000;

-- ── 2. Un escalón otorgado a un afiliado ─────────────────────────────────
-- La fila nace en 'tracking' el primer corte mensual que ve al afiliado en el
-- umbral, y ahí arranca el reloj de los 3 meses sostenidos (`qualifiedSince`).
-- Cumplidos los 3 pasa a 'pending_choice' con los montos CONGELADOS: a partir
-- de ese instante editar la config ya no los mueve.
--
-- status:
--   tracking       — en el umbral, contando los 3 meses. NO se paga nada.
--   pending_choice — otorgado; espera que el afiliado elija. NO se paga nada.
--   once_paid      — eligió pago único; la comisión ya se generó. Cerrado.
--   monthly_active — eligió mensual; el cron le genera una comisión al mes.
--   monthly_paused — eligió mensual pero su red cayó del umbral. Se reactiva solo.
CREATE TABLE IF NOT EXISTS "affiliate_network_bonus_awards" (
  "id"               text             NOT NULL,
  "affiliateId"      text             NOT NULL,
  -- 1..5 — el escalón EN LA CONFIG, no en pantalla.
  "tier"             integer          NOT NULL,
  -- Umbral y montos. Vivos mientras 'tracking'; CONGELADOS al otorgarse.
  "clinics"          integer          NOT NULL,
  "onceMxn"          double precision NOT NULL,
  "monthlyMxn"       double precision NOT NULL,
  "status"           text             NOT NULL DEFAULT 'tracking',
  -- Inicio de la racha. null = no está en el umbral (el reloj se reinicia).
  "qualifiedSince"   timestamp(3),
  -- Cuándo se otorgó (paso a 'pending_choice') y cuándo eligió.
  "awardedAt"        timestamp(3),
  "chosenAt"         timestamp(3),
  -- 'once' | 'monthly'. null = todavía no elige. DEFINITIVA una vez escrita.
  "choice"           text,
  -- Modo único: cuándo se generó la comisión.
  "paidAt"           timestamp(3),
  -- Modo mensual: última mensualidad generada y SU MES ('YYYY-MM').
  -- `lastMonthlyKey` es el candado barato contra el doble pago; el candado
  -- duro es el índice único de affiliate_commissions."stripeInvoiceId".
  "lastMonthlyAt"    timestamp(3),
  "lastMonthlyKey"   text,
  "monthlyPaidCount" integer          NOT NULL DEFAULT 0,
  "pausedAt"         timestamp(3),
  -- Último conteo de red que vio el cron: es lo que explica una pausa.
  "lastCount"        integer          NOT NULL DEFAULT 0,
  "createdAt"        timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        timestamp(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_network_bonus_awards_pkey" PRIMARY KEY ("id")
);

-- Un escalón se otorga UNA sola vez por afiliado. Esta es la regla del
-- programa hecha constraint: sin ella, dos corridas del cron en paralelo
-- podrían otorgar el mismo escalón dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_network_bonus_awards_aff_tier_key"
  ON "affiliate_network_bonus_awards" ("affiliateId", "tier");

CREATE INDEX IF NOT EXISTS "affiliate_network_bonus_awards_status_idx"
  ON "affiliate_network_bonus_awards" ("status");

CREATE INDEX IF NOT EXISTS "affiliate_network_bonus_awards_affiliate_idx"
  ON "affiliate_network_bonus_awards" ("affiliateId");

-- FK al afiliado (mismo patrón que el resto del módulo: la FK vive en el SQL,
-- no como relación de Prisma). Se envuelve porque ADD CONSTRAINT no acepta
-- IF NOT EXISTS y este archivo tiene que poder re-correrse.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'affiliate_network_bonus_awards_affiliateId_fkey'
  ) THEN
    ALTER TABLE "affiliate_network_bonus_awards"
      ADD CONSTRAINT "affiliate_network_bonus_awards_affiliateId_fkey"
      FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 3. RLS: mismo candado que el resto del módulo ────────────────────────
-- La tabla solo se toca desde el servidor (service role). Ni anon ni
-- authenticated deben verla: aquí vive dinero comprometido por afiliado.
DO $$ BEGIN
  ALTER TABLE "affiliate_network_bonus_awards" ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'affiliate_network_bonus_awards'
      AND policyname = 'affiliate_network_bonus_awards_deny_anon'
  ) THEN
    CREATE POLICY "affiliate_network_bonus_awards_deny_anon" ON "affiliate_network_bonus_awards"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ── 4. Nota sobre affiliate_commissions ──────────────────────────────────
-- Los bonos NO tienen tabla de pagos propia: se registran en
-- affiliate_commissions con kind = 'network_bonus' para entrar por el mismo
-- flujo de pago, reportes y estado de cuenta. No hace falta DDL:
--   · clinicId  = ''  (un bono no nace de una clínica concreta)
--     VERIFICADO en sql/affiliates.sql: esa columna NO tiene FK a "clinics"
--     —la única FK de la tabla es affiliateId → affiliates.id— así que el
--     centinela vacío no viola nada. Si algún día se le pone FK a clinicId,
--     este INSERT deja de funcionar: hay que hacerla nullable antes.
--   · amountMxn = 0   (no hay factura detrás; no infla el "revenue traído")
--   · stripeInvoiceId = 'netbonus:<awardId>:once' | 'netbonus:<awardId>:YYYY-MM'
--     ← EL CANDADO DE IDEMPOTENCIA. El índice único que ya existe sobre
--       "stripeInvoiceId" (affiliate_commissions_stripeInvoiceId_key) es lo
--       que impide que el cron pague dos veces el mismo mes, aunque corra dos
--       veces o dos instancias a la vez. La comisión y la actualización del
--       award van en la MISMA transacción, así que el choque revierte las dos.
