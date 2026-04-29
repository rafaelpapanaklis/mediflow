-- ═══════════════════════════════════════════════════════════════════
-- Compliance Fase B · Commit 2 — CUMS catalog + prescription items FK
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "cums_items" (
  "clave"             VARCHAR(20)  PRIMARY KEY,
  "descripcion"       VARCHAR(500) NOT NULL,
  "presentacion"      VARCHAR(200) NOT NULL,
  "formaFarmaceutica" VARCHAR(100),
  "grupoTerapeutico"  VARCHAR(200),
  "cofeprisGroup"     VARCHAR(20)
);

CREATE INDEX IF NOT EXISTS "cums_items_cofeprisGroup_idx"
  ON "cums_items"("cofeprisGroup");
CREATE INDEX IF NOT EXISTS "cums_items_grupoTerapeutico_idx"
  ON "cums_items"("grupoTerapeutico");

CREATE TABLE IF NOT EXISTS "prescription_items" (
  "id"             TEXT          PRIMARY KEY,
  "prescriptionId" TEXT          NOT NULL,
  "cumsKey"        VARCHAR(20)   NOT NULL,
  "dosage"         VARCHAR(200)  NOT NULL,
  "duration"       VARCHAR(100),
  "quantity"       VARCHAR(50),
  "notes"          TEXT,
  "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "prescription_items_prescriptionId_fkey"
    FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE CASCADE,
  CONSTRAINT "prescription_items_cumsKey_fkey"
    FOREIGN KEY ("cumsKey") REFERENCES "cums_items"("clave")
);

CREATE INDEX IF NOT EXISTS "prescription_items_prescriptionId_idx"
  ON "prescription_items"("prescriptionId");
