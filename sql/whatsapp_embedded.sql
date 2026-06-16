-- ═══════════════════════════════════════════════════════════════════
-- WhatsApp Embedded Signup (autoservicio por clínica)
-- Añade 2 columnas a clinics. NO crea tabla nueva → clinics ya tiene RLS.
-- APLICAR A MANO en el SQL editor de Supabase. Idempotente.
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "waBusinessAccountId" TEXT;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "waConnMethod"        TEXT;
