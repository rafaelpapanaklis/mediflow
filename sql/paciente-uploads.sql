-- ═══════════════════════════════════════════════════════════════════════
-- Archivos subidos por el paciente — PatientUpload (WS1-T8) — 2026-06-23
-- ⚠️ PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase
--    ANTES del deploy de la rama feat/paciente-subir-documentos.
--
-- El paciente sube estudios / identificación / otros desde /paciente/documentos.
-- El binario vive en el bucket privado `patient-files`; `storageKey` es el path
-- interno (clinicId/patientId/patient-uploads/...). clinicId/patientId SIEMPRE
-- derivados del link de la sesión, nunca del cliente. La clínica los ve en el
-- expediente.
--
-- IDEMPOTENTE: CREATE TYPE/TABLE/INDEX con guard, FKs con guard sobre
-- pg_constraint, policy con guard sobre pg_policies. Re-ejecutable sin efectos
-- colaterales.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Enum PatientUploadKind ────────────────────────────────────────────
-- Prisma mapea el enum a un TYPE de Postgres con el MISMO nombre (sin @@map).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PatientUploadKind') THEN
    CREATE TYPE "PatientUploadKind" AS ENUM ('ESTUDIO', 'IDENTIFICACION', 'OTRO');
  END IF;
END $$;

-- ── Tabla ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "patient_uploads" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "kind" "PatientUploadKind" NOT NULL DEFAULT 'OTRO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_uploads_pkey" PRIMARY KEY ("id")
);

-- ── Índices ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "patient_uploads_clinicId_patientId_createdAt_idx"
    ON "patient_uploads"("clinicId", "patientId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "patient_uploads_accountId_idx"
    ON "patient_uploads"("accountId");

-- ── Foreign keys (ADD CONSTRAINT no soporta IF NOT EXISTS → guard) ─────
DO $pu$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_uploads_clinicId_fkey') THEN
    ALTER TABLE "patient_uploads"
      ADD CONSTRAINT "patient_uploads_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_uploads_patientId_fkey') THEN
    ALTER TABLE "patient_uploads"
      ADD CONSTRAINT "patient_uploads_patientId_fkey"
      FOREIGN KEY ("patientId") REFERENCES "patients"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_uploads_accountId_fkey') THEN
    ALTER TABLE "patient_uploads"
      ADD CONSTRAINT "patient_uploads_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "patient_accounts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$pu$;

-- ── RLS deny-all (mismo patrón que patient_credits / rls-deny-all) ─────
-- Niega todo a anon/authenticated; el service role (Prisma) la sigue usando.
DO $$
DECLARE
  t    text;
  tbls text[] := ARRAY['patient_uploads'];
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
