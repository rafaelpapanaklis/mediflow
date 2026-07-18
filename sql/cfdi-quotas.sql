-- ════════════════════════════════════════════════════════════════════════════
-- Cupos de facturas CFDI por plan + contador de consumo por clínica/mes.
--
-- ⚠️ APLICAR A MANO en el SQL Editor de Supabase ANTES de deployar / abrir el
-- Preview de la rama feat/cfdi-quotas. El modelo Prisma PlanConfig ya declara
-- las columnas nuevas (cfdiMonthly, cfdiOverageCents) y existe el modelo
-- CfdiUsage; sin esta migración `prisma.planConfig.findMany()` truena y TODA la
-- config de planes cae al FALLBACK del código (además `prisma.cfdiUsage` no
-- existiría). Aplicarlo ANTES es seguro: el código viejo no lee las columnas ni
-- la tabla nuevas y las ignora.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS + UPDATE, CREATE TABLE/INDEX IF NOT
-- EXISTS, FK y RLS con guard sobre pg_constraint/pg_policies. Re-ejecutable sin
-- efectos colaterales. Delimitadores nombrados ($cq$), nunca $$ pelado.
--
-- POLÍTICA (Rafael, 14-jul): incluidas por MES CALENDARIO BASIC=25 (provisional)
-- / PRO=50 / CLINIC=150. Excedente por timbre (centavos MXN) BASIC=200 / PRO=200
-- / CLINIC=125. JAMÁS se bloquea el timbrado: se timbra y el excedente se cobra
-- a fin de mes (mensual+Stripe → InvoiceItem; anual+tarjeta → cobro off-session
-- día 1; sin método → adeudo manual visible en el panel).
--
-- ⚠️ NO re-ejecutes sql/plan_configs.sql para esto: ese archivo aún siembra los
-- precios VIEJOS (499/999/1999) con ON CONFLICT DO UPDATE y pisaría los precios
-- vivos (419/689/1719). Este archivo es autosuficiente.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. plan_configs: columnas de cupo/excedente CFDI ────────────────────────
-- NOT NULL con DEFAULT: rellena las filas existentes (BASIC/PRO/CLINIC) sin
-- violar el NOT NULL; los UPDATE de abajo fijan el valor por plan.
ALTER TABLE "plan_configs"
  ADD COLUMN IF NOT EXISTS "cfdiMonthly" integer NOT NULL DEFAULT 50;
ALTER TABLE "plan_configs"
  ADD COLUMN IF NOT EXISTS "cfdiOverageCents" integer NOT NULL DEFAULT 200;

UPDATE "plan_configs" SET "cfdiMonthly" = 25,  "cfdiOverageCents" = 200 WHERE "planId" = 'BASIC';
UPDATE "plan_configs" SET "cfdiMonthly" = 50,  "cfdiOverageCents" = 200 WHERE "planId" = 'PRO';
UPDATE "plan_configs" SET "cfdiMonthly" = 150, "cfdiOverageCents" = 125 WHERE "planId" = 'CLINIC';

-- Verificación (debe devolver BASIC=25/200, PRO=50/200, CLINIC=150/125):
-- SELECT "planId", "cfdiMonthly", "cfdiOverageCents" FROM "plan_configs" ORDER BY "planId";

-- ── 2. Tabla cfdi_usage: contador mensual + estado de cobro del excedente ────
CREATE TABLE IF NOT EXISTS "cfdi_usage" (
    "id"            TEXT NOT NULL,
    "clinicId"      TEXT NOT NULL,
    "period"        TEXT NOT NULL,               -- "YYYY-MM" en la zona de la clínica
    "stamped"       INTEGER NOT NULL DEFAULT 0,
    "billingStatus" TEXT,                        -- null|none|invoice_item|charged|pending|failed
    "overageCents"  INTEGER,
    "billedAt"      TIMESTAMP(3),
    "stripeRef"     TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cfdi_usage_pkey" PRIMARY KEY ("id")
);

-- ── Índices ─────────────────────────────────────────────────────────────────
-- Único (clinicId, period): 1 fila por clínica/mes → soporta el upsert-increment.
CREATE UNIQUE INDEX IF NOT EXISTS "cfdi_usage_clinicId_period_key"
    ON "cfdi_usage"("clinicId", "period");
-- El cron filtra por billedAt IS NULL para cerrar periodos pendientes.
CREATE INDEX IF NOT EXISTS "cfdi_usage_billedAt_idx"
    ON "cfdi_usage"("billedAt");

-- ── Foreign key (ADD CONSTRAINT no soporta IF NOT EXISTS → guard) ────────────
DO $cq$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cfdi_usage_clinicId_fkey') THEN
    ALTER TABLE "cfdi_usage"
      ADD CONSTRAINT "cfdi_usage_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$cq$;

-- ── RLS deny-all (mismo patrón que patient_uploads / rls-deny-all) ───────────
-- Niega todo a anon/authenticated; el service role (Prisma) la sigue usando.
DO $cq$
DECLARE
  t    text;
  tbls text[] := ARRAY['cfdi_usage'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = t
        AND policyname = t || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        t || '_deny_anon', t
      );
    END IF;
  END LOOP;
END
$cq$;
