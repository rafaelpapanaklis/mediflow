-- ============================================================================
-- WS1-T6 — Almacenamiento: contar TODO lo que la clínica sube.
--
-- ⚠️ Lo aplica Rafael, en el SQL editor de Supabase. La terminal no toca la base.
-- Plano, aditivo e idempotente: se puede correr dos veces sin efecto.
--
-- Tabla de uso por archivo para lo que no tiene columna de tamaño propia:
-- CBCT ligero, GLB web, miniaturas, firmas, comprobantes, landing, soporte.
-- El código funciona sin ella (falla suave: suma 0 y no registra), pero hasta
-- aplicarla esos bytes no cuentan.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "clinic_storage_objects" (
  "id"        TEXT PRIMARY KEY,
  "clinicId"  TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "kind"      TEXT NOT NULL,
  "bucket"    TEXT NOT NULL,
  "path"      TEXT NOT NULL,
  "sizeBytes" BIGINT  NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "clinic_storage_objects_bucket_path_key"
  ON "clinic_storage_objects" ("bucket", "path");

CREATE INDEX IF NOT EXISTS "clinic_storage_objects_clinicId_kind_idx"
  ON "clinic_storage_objects" ("clinicId", "kind");

-- Igual que el resto de tablas: RLS deny-all (el servidor entra con service role).
ALTER TABLE "clinic_storage_objects" ENABLE ROW LEVEL SECURITY;
