-- ═══════════════════════════════════════════════════════════════════
-- Compliance Fase A · Commit 4 — Aviso de privacidad + ARCO
--
-- Tabla arco_requests para persistir solicitudes ARCO (Acceso,
-- Rectificación, Cancelación, Oposición) recibidas vía /api/arco/request.
--
-- Multi-tenant: clinicId nullable. Solicitudes anónimas (sin patientId)
-- van con clinicId=NULL — no cruzan datos de clínicas. Si la solicitud
-- llega con patientId, el endpoint valida y hereda el clinicId del
-- paciente.
-- ═══════════════════════════════════════════════════════════════════

-- ── Enums ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ArcoType') THEN
    CREATE TYPE "ArcoType" AS ENUM ('ACCESS', 'RECTIFICATION', 'CANCELLATION', 'OPPOSITION');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ArcoStatus') THEN
    CREATE TYPE "ArcoStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED');
  END IF;
END$$;

-- ── arco_requests ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "arco_requests" (
  "id"            TEXT          PRIMARY KEY,
  "clinicId"      TEXT,
  "patientId"     TEXT,
  "type"          "ArcoType"    NOT NULL,
  "reason"        TEXT          NOT NULL,
  "email"         VARCHAR(200)  NOT NULL,
  "status"        "ArcoStatus"  NOT NULL DEFAULT 'PENDING',
  "resolvedAt"    TIMESTAMPTZ(6),
  "resolvedNotes" TEXT,
  "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "arco_requests_clinicId_status_idx"
  ON "arco_requests"("clinicId", "status");
CREATE INDEX IF NOT EXISTS "arco_requests_email_idx"
  ON "arco_requests"("email");
