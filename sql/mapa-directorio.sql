-- ----------------------------------------------------------------------------
-- WS2-T3 - Mapa del directorio (/descubre): pin geografico de la clinica.
-- Agrega latitude/longitude a la tabla `clinics` (modelo Prisma Clinic, @@map).
-- IDEMPOTENTE: re-ejecutable sin error (ADD COLUMN IF NOT EXISTS).
-- No es tabla nueva -> SIN RLS, sin nuevas policies.
-- Prisma `Float?` -> Postgres DOUBLE PRECISION. Aplicar en Supabase (SQL editor).
-- ----------------------------------------------------------------------------

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
