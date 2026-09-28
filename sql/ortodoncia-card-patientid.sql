-- Ortodoncia — hallazgo ws1-t8 (revisión del hallazgo ws1-t1/ws1-t4 §1,
-- "Firmar control falla en dev.108"): una de las DOS causas reales que
-- salieron en el log del servidor (panel.log) fue
--
--   Invalid `prisma.orthoCardElastic.createMany()` invocation:
--   The column `patientId` does not exist in the current database.
--
-- `patientId` SÍ está en schema.prisma para ortho_card_elastics,
-- ortho_card_ipr_points y ortho_card_broken_brackets (campo opcional,
-- relación `Patient?`) desde el PR #15 original (6-may-2026) — pero el
-- script de esa fase (scripts/apply-ortho-redesign-fase1-prod.sql) NUNCA
-- creó esa columna en esas 3 tablas: el esquema y la base llevan
-- desincronizados desde entonces. Aditivo, idempotente, sin bloques DO —
-- pégalo tal cual en el SQL Editor de Supabase.

ALTER TABLE "ortho_card_elastics" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "ortho_card_elastics" DROP CONSTRAINT IF EXISTS "ortho_card_elastics_patientId_fkey";
ALTER TABLE "ortho_card_elastics"
  ADD CONSTRAINT "ortho_card_elastics_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "ortho_card_elastics_patientId_idx" ON "ortho_card_elastics" ("patientId");

ALTER TABLE "ortho_card_ipr_points" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "ortho_card_ipr_points" DROP CONSTRAINT IF EXISTS "ortho_card_ipr_points_patientId_fkey";
ALTER TABLE "ortho_card_ipr_points"
  ADD CONSTRAINT "ortho_card_ipr_points_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "ortho_card_ipr_points_patientId_idx" ON "ortho_card_ipr_points" ("patientId");

ALTER TABLE "ortho_card_broken_brackets" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "ortho_card_broken_brackets" DROP CONSTRAINT IF EXISTS "ortho_card_broken_brackets_patientId_fkey";
ALTER TABLE "ortho_card_broken_brackets"
  ADD CONSTRAINT "ortho_card_broken_brackets_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "ortho_card_broken_brackets_patientId_idx" ON "ortho_card_broken_brackets" ("patientId");
