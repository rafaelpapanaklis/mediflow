-- ═══════════════════════════════════════════════════════════════════
-- Compliance Fase C · Commit 8 — Referencia y contrarreferencia
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReferralType') THEN
    CREATE TYPE "ReferralType" AS ENUM ('OUTGOING', 'INCOMING');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReferralStatus') THEN
    CREATE TYPE "ReferralStatus" AS ENUM ('SENT', 'ACCEPTED', 'REJECTED', 'RESPONDED', 'CANCELLED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "referrals" (
  "id"                 TEXT             PRIMARY KEY,
  "clinicId"           TEXT             NOT NULL,
  "patientId"          TEXT             NOT NULL,
  "fromDoctorId"       TEXT             NOT NULL,
  "toClinicName"       VARCHAR(200)     NOT NULL,
  "toClinicClues"      VARCHAR(11),
  "toDoctorName"       VARCHAR(200),
  "toSpecialty"        VARCHAR(100),
  "reason"             TEXT             NOT NULL,
  "clinicalSummary"    TEXT             NOT NULL,
  "relevantDiagnoses"  JSONB,
  "type"               "ReferralType"   NOT NULL,
  "status"             "ReferralStatus" NOT NULL DEFAULT 'SENT',
  "sentAt"             TIMESTAMPTZ(6)   NOT NULL DEFAULT NOW(),
  "respondedAt"        TIMESTAMPTZ(6),
  "response"           TEXT,
  CONSTRAINT "referrals_clinicId_fkey"     FOREIGN KEY ("clinicId")     REFERENCES "clinics"("id")  ON DELETE CASCADE,
  CONSTRAINT "referrals_patientId_fkey"    FOREIGN KEY ("patientId")    REFERENCES "patients"("id") ON DELETE CASCADE,
  CONSTRAINT "referrals_fromDoctorId_fkey" FOREIGN KEY ("fromDoctorId") REFERENCES "users"("id")
);

CREATE INDEX IF NOT EXISTS "referrals_clinicId_status_idx"
  ON "referrals"("clinicId", "status");
CREATE INDEX IF NOT EXISTS "referrals_patientId_idx"
  ON "referrals"("patientId");
