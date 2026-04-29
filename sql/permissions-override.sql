-- Permisos granulares por usuario.
-- Array de keys ("agenda.view", "patients.edit", ...) que reemplaza al set
-- default del role cuando no está vacío. Vacío = usar default del role.
-- Idempotente: si la columna ya existe, no falla.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "permissionsOverride" TEXT[] NOT NULL DEFAULT '{}';
