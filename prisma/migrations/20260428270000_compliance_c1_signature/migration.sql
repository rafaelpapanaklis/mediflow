-- ═══════════════════════════════════════════════════════════════════
-- Compliance Fase C · Commit 6 — Firma electrónica FIEL/SAT
--
-- - doctor_signature_certs: cert FIEL del doctor (.cer público + .key
--   privada cifrada AES-256-GCM con SIGNATURE_MASTER_KEY del env).
-- - signed_documents: cada documento firmado (PKCS7 + TSA opcional).
--   docId polimórfico (no FK enforced) — apunta a prescriptions,
--   medical_records, consent_forms, etc.
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SignedDocType') THEN
    CREATE TYPE "SignedDocType" AS ENUM ('PRESCRIPTION', 'MEDICAL_RECORD', 'CONSENT', 'OTHER');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "doctor_signature_certs" (
  "id"             TEXT          PRIMARY KEY,
  "userId"         TEXT          NOT NULL UNIQUE,
  "cerFileUrl"     TEXT          NOT NULL,
  "keyFileUrl"     TEXT          NOT NULL,
  "keyEncIv"       VARCHAR(48)   NOT NULL,
  "keyEncAuthTag"  VARCHAR(48)   NOT NULL,
  "cerSerial"      VARCHAR(60)   NOT NULL,
  "cerIssuer"      VARCHAR(200)  NOT NULL,
  "validFrom"      TIMESTAMPTZ(6) NOT NULL,
  "validUntil"     TIMESTAMPTZ(6) NOT NULL,
  "rfc"            VARCHAR(13)   NOT NULL,
  "isActive"       BOOLEAN       NOT NULL DEFAULT TRUE,
  "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "doctor_signature_certs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "doctor_signature_certs_rfc_idx"
  ON "doctor_signature_certs"("rfc");

CREATE TABLE IF NOT EXISTS "signed_documents" (
  "id"           TEXT             PRIMARY KEY,
  "clinicId"     TEXT             NOT NULL,
  "docType"      "SignedDocType"  NOT NULL,
  "docId"        TEXT             NOT NULL,
  "signerUserId" TEXT             NOT NULL,
  "sha256"       VARCHAR(64)      NOT NULL,
  "signature"    TEXT             NOT NULL,
  "tsaTimestamp" TEXT,
  "signedAt"     TIMESTAMPTZ(6)   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "signed_documents_clinicId_docType_idx"
  ON "signed_documents"("clinicId", "docType");
CREATE INDEX IF NOT EXISTS "signed_documents_docId_idx"
  ON "signed_documents"("docId");
