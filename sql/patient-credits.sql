-- ═══════════════════════════════════════════════════════════════════════
-- Patient credits / Saldo a favor (import "Saldos" col tipo=favor) — 2026-06-21
-- ⚠️ PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase
--    ANTES del deploy. Prisma usa esta tabla; sin ella, el import de saldos a
--    favor (commit) falla. (Las lecturas del badge "Saldo a favor" en el perfil
--    y el KPI de cobranza son resilientes: si la tabla no existe aún, muestran 0.)
--
-- QUÉ
-- Crea patient_credits: saldo a favor (crédito) por paciente. v1 SIN consumo —
-- el saldo a favor de un paciente = SUM(amount) de sus filas. El monto se guarda
-- SIEMPRE positivo; el "a favor" lo expresa el modelo, no el signo.
--
-- AISLAMIENTO POR CLÍNICA = Prisma-side (where clinicId), igual que el resto del
-- proyecto. La RLS deny-all solo blinda la API REST de Supabase (anon/
-- authenticated); el service role (Prisma) la bypasea por diseño. Este proyecto
-- NO usa current_setting/app.current_clinic_id — no se introduce aquí.
--
-- IDEMPOTENTE: CREATE TABLE/INDEX IF NOT EXISTS, FKs con guard sobre
-- pg_constraint, policy con guard sobre pg_policies. Re-ejecutable sin efectos
-- colaterales.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "patient_credits" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'migrated',
    "creditDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_credits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "patient_credits_clinicId_patientId_idx"
    ON "patient_credits"("clinicId", "patientId");

-- FKs (ADD CONSTRAINT no soporta IF NOT EXISTS → guard sobre pg_constraint).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_credits_clinicId_fkey') THEN
    ALTER TABLE "patient_credits"
      ADD CONSTRAINT "patient_credits_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_credits_patientId_fkey') THEN
    ALTER TABLE "patient_credits"
      ADD CONSTRAINT "patient_credits_patientId_fkey"
      FOREIGN KEY ("patientId") REFERENCES "patients"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- RLS deny-all (mismo patrón que supplier-marketplace / rls-deny-all-policies):
-- niega todo a anon/authenticated; el service role (Prisma) la sigue usando.
DO $$
DECLARE
  t    text;
  tbls text[] := ARRAY['patient_credits'];
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
END $$;
