-- ═══════════════════════════════════════════════════════════════════════
-- Portal del paciente (cuentas reales) — schema.
--
-- Equivalente idempotente de los modelos Prisma PatientAccount,
-- PatientAccountLink y PatientAccountSession (prisma/schema.prisma).
--
-- Aplicar manualmente en Supabase (SQL editor). Re-ejecutable: cada
-- bloque comprueba existencia antes de crear, así que correrlo varias
-- veces no produce errores ni duplicados.
--
-- Nota sobre $$: usamos un único delimitador `$pp$` y NUNCA bloques
-- DO anidados (el parser SQL de Supabase rompe con $$ anidado).
-- ═══════════════════════════════════════════════════════════════════════


-- ── Tablas ────────────────────────────────────────────────────────────

-- Cuenta GLOBAL del paciente (sin clinicId). Email único, siempre lowercase.
CREATE TABLE IF NOT EXISTS "patient_accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "verifyCodeHash" TEXT,
    "verifyCodeExpiry" TIMESTAMP(3),
    "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "resetTokenHash" TEXT,
    "resetTokenExpiry" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "patient_accounts_pkey" PRIMARY KEY ("id")
);

-- Vínculo cuenta ↔ expediente (Patient) por clínica. clinicId denormalizado.
CREATE TABLE IF NOT EXISTS "patient_account_links" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "patient_account_links_pkey" PRIMARY KEY ("id")
);

-- Sesiones del portal. La cookie httpOnly `patient_session` lleva el token
-- plano; aquí solo se persiste sha256(token).
CREATE TABLE IF NOT EXISTS "patient_account_sessions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "patient_account_sessions_pkey" PRIMARY KEY ("id")
);


-- ── Índices ───────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "patient_accounts_email_key"
    ON "patient_accounts"("email");

CREATE UNIQUE INDEX IF NOT EXISTS "patient_account_links_accountId_patientId_key"
    ON "patient_account_links"("accountId", "patientId");

CREATE INDEX IF NOT EXISTS "patient_account_links_accountId_clinicId_idx"
    ON "patient_account_links"("accountId", "clinicId");

CREATE INDEX IF NOT EXISTS "patient_account_links_patientId_idx"
    ON "patient_account_links"("patientId");

CREATE UNIQUE INDEX IF NOT EXISTS "patient_account_sessions_tokenHash_key"
    ON "patient_account_sessions"("tokenHash");

CREATE INDEX IF NOT EXISTS "patient_account_sessions_accountId_idx"
    ON "patient_account_sessions"("accountId");

CREATE INDEX IF NOT EXISTS "patient_account_sessions_expiresAt_idx"
    ON "patient_account_sessions"("expiresAt");


-- ── Foreign keys ──────────────────────────────────────────────────────

DO $pp$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patient_account_links_accountId_fkey'
  ) THEN
    ALTER TABLE "patient_account_links"
      ADD CONSTRAINT "patient_account_links_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "patient_accounts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patient_account_links_patientId_fkey'
  ) THEN
    ALTER TABLE "patient_account_links"
      ADD CONSTRAINT "patient_account_links_patientId_fkey"
      FOREIGN KEY ("patientId") REFERENCES "patients"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patient_account_sessions_accountId_fkey'
  ) THEN
    ALTER TABLE "patient_account_sessions"
      ADD CONSTRAINT "patient_account_sessions_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "patient_accounts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$pp$;
