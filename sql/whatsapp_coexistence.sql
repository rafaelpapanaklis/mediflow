-- WhatsApp coexistence: columnas nuevas en la clínica.
-- Idempotente (ADD COLUMN IF NOT EXISTS). Aplicar en Supabase (SQL Editor).
-- Modelo Prisma: Clinic -> tabla "clinics". Campos sin @map => columnas camelCase (con comillas).
--   waBusinessAccountId: WhatsApp Business Account ID (WABA) de la clinica.
--   waConnMethod: "manual" | "coexistence" (null en clinicas conectadas antes de este cambio).

ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "waBusinessAccountId" TEXT;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "waConnMethod" TEXT;
