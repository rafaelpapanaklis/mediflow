-- ============================================================================
-- odontogram-v2.sql  ·  WS3-T1 (backend)
-- Extiende odontogram_entries al catálogo de 45 hallazgos y permite VARIAS
-- condiciones por (diente, cara).
--
--   1. state (8 valores) -> "conditionId" (id LIBRE del catálogo nuevo).
--   2. Migra los valores existentes (CARIES->caries, RESINA->restoration, ...).
--   3. Borra las filas SANO (sano = ausencia de registro).
--   4. Recrea la UNIQUE incluyendo "conditionId"
--      (patientId, toothNumber, surface, "conditionId").
--
-- Idempotente y seguro de re-correr. Aplicar en Supabase (SQL editor).
-- Nota: las columnas camelCase de Prisma van entre comillas dobles.
-- ============================================================================

DO $odo_v2$
BEGIN
  -- 1. Agrega la columna "conditionId" si aún no existe.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'odontogram_entries' AND column_name = 'conditionId'
  ) THEN
    ALTER TABLE odontogram_entries ADD COLUMN "conditionId" text;
  END IF;

  -- 2-3. Si todavía existe la columna legacy `state`, migra datos y la elimina.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'odontogram_entries' AND column_name = 'state'
  ) THEN
    -- Borra las marcas SANO: en el modelo nuevo "sano" = ausencia de registro.
    DELETE FROM odontogram_entries WHERE state = 'SANO';

    -- Mapea los 7 estados restantes al id del catálogo nuevo.
    UPDATE odontogram_entries
    SET "conditionId" = CASE state
      WHEN 'CARIES'     THEN 'caries'
      WHEN 'RESINA'     THEN 'restoration'
      WHEN 'CORONA'     THEN 'crown'
      WHEN 'ENDODONCIA' THEN 'rct'
      WHEN 'IMPLANTE'   THEN 'implant'
      WHEN 'AUSENTE'    THEN 'missing'
      WHEN 'EXTRACCION' THEN 'ext_done'
      ELSE lower(state)
    END
    WHERE "conditionId" IS NULL;

    ALTER TABLE odontogram_entries DROP COLUMN state;
  END IF;

  -- 4. "conditionId" es obligatorio tras el backfill. Solo si no quedan NULLs.
  IF NOT EXISTS (SELECT 1 FROM odontogram_entries WHERE "conditionId" IS NULL) THEN
    ALTER TABLE odontogram_entries ALTER COLUMN "conditionId" SET NOT NULL;
  END IF;

  -- 5. Quita la UNIQUE vieja (sea constraint o índice; Prisma usa índice *_key).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'odontogram_entries_patientId_toothNumber_surface_key'
  ) THEN
    ALTER TABLE odontogram_entries
      DROP CONSTRAINT "odontogram_entries_patientId_toothNumber_surface_key";
  ELSIF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'odontogram_entries_patientId_toothNumber_surface_key'
      AND relkind = 'i'
  ) THEN
    DROP INDEX "odontogram_entries_patientId_toothNumber_surface_key";
  END IF;

  -- 6. Crea la UNIQUE nueva con "conditionId" si no existe ya.
  --    NULL en surface se considera distinto en UNIQUE; la dedupe de
  --    condiciones de diente completo se hace en la capa de aplicación.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'odontogram_entries_patientId_toothNumber_surface_conditionId_key'
  ) THEN
    CREATE UNIQUE INDEX "odontogram_entries_patientId_toothNumber_surface_conditionId_key"
      ON odontogram_entries ("patientId", "toothNumber", "surface", "conditionId");
  END IF;
END
$odo_v2$;
