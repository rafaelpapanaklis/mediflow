-- ═══════════════════════════════════════════════════════════════════
-- ARCO cancellation: campos de soft-delete + anonimización para
-- pacientes que ejercen su derecho de cancelación bajo LFPDPPP.
--
-- NOM-024 obliga a retener historia clínica 5 años, así que el flujo de
-- cancelación NO hace hard delete. En su lugar:
--   1) deletedAt: timestamp de cuándo se ejecutó la cancelación. Una vez
--      seteado, el paciente queda oculto de listas, búsquedas y agenda.
--   2) anonymizedAt: timestamp de cuándo se reemplazó el PII (nombre,
--      curp, rfc, email, teléfono, etc.) por placeholders.
-- Idempotente — seguro de re-correr.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "deletedAt"     TIMESTAMP(3);
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "anonymizedAt"  TIMESTAMP(3);

-- Index parcial: las queries calientes filtran "deletedAt IS NULL".
CREATE INDEX IF NOT EXISTS "patients_clinicId_active_idx"
  ON "patients"("clinicId")
  WHERE "deletedAt" IS NULL;
