-- ═══════════════════════════════════════════════════════════════════════
-- CAJA v2 — PIN por usuario + permiso de Caja + campos IVA/doctor en Invoice
-- Idempotente (ADD COLUMN IF NOT EXISTS). Aplicar en Supabase ANTES de que el
-- deploy con estas columnas llegue a prod (si no, Prisma revienta por columna
-- faltante al hacer SELECT del usuario). Columnas camelCase entre comillas.
-- ═══════════════════════════════════════════════════════════════════════

-- users: hash del PIN de Caja (bcrypt, 6 dígitos) + permiso de acceso a Caja
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cajaPinHash"   TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "canAccessCaja" BOOLEAN NOT NULL DEFAULT false;

-- invoices: doctor atribuido (reportes por médico) + IVA configurable por factura
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "doctorId"    TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "taxRate"     DOUBLE PRECISION NOT NULL DEFAULT 16;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "taxIncluded" BOOLEAN NOT NULL DEFAULT true;
