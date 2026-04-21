-- ============================================================
-- Prescriptions (recetas médicas con QR verificable)
-- Aplicar manualmente en Supabase SQL editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS "prescriptions" (
    "id" TEXT NOT NULL,
    "medicalRecordId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "medications" JSONB NOT NULL,
    "indications" TEXT,
    "qrCode" TEXT NOT NULL,
    "verifyUrl" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "cofeprisGroup" TEXT,
    "cofeprisFolio" TEXT,
    "digitalSignature" TEXT,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "prescriptions_qrCode_key" ON "prescriptions"("qrCode");
CREATE INDEX IF NOT EXISTS "prescriptions_clinicId_idx" ON "prescriptions"("clinicId");
CREATE INDEX IF NOT EXISTS "prescriptions_patientId_idx" ON "prescriptions"("patientId");

ALTER TABLE "prescriptions"
    ADD CONSTRAINT "prescriptions_medicalRecordId_fkey"
    FOREIGN KEY ("medicalRecordId") REFERENCES "medical_records"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prescriptions"
    ADD CONSTRAINT "prescriptions_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prescriptions"
    ADD CONSTRAINT "prescriptions_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "prescriptions"
    ADD CONSTRAINT "prescriptions_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
