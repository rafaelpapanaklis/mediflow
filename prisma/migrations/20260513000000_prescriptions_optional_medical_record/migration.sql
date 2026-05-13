-- ═══════════════════════════════════════════════════════════════════
-- Prescriptions sin medicalRecord obligatorio
--
-- CONTEXTO
-- El botón "Crear receta" en los formularios clínicos (dental,
-- cardiology, pediatrics) creaba un medicalRecord huérfano antes de
-- emitir la receta, contaminando el histórico clínico con entradas
-- que no corresponden a consultas reales.
--
-- CAMBIOS
--   1. `prescriptions.medicalRecordId` pasa a NULLABLE — una receta
--      puede emitirse standalone (re-emisión, urgencia, follow-up).
--   2. La FK pasa de ON DELETE CASCADE → ON DELETE SET NULL — si la
--      consulta se elimina, la receta se conserva.
--
-- IDEMPOTENTE: se puede re-correr sin efectos colaterales.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Hacer la columna nullable (no-op si ya lo es).
DO $$ BEGIN
  ALTER TABLE "prescriptions" ALTER COLUMN "medicalRecordId" DROP NOT NULL;
EXCEPTION WHEN others THEN null; END $$;

-- 2) Recrear FK con ON DELETE SET NULL (era CASCADE).
ALTER TABLE "prescriptions" DROP CONSTRAINT IF EXISTS "prescriptions_medicalRecordId_fkey";
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_medicalRecordId_fkey"
  FOREIGN KEY ("medicalRecordId") REFERENCES "medical_records"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
