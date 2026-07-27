-- Portal invite desde la ficha (cuentas reales del paciente).
-- Idempotente: correr a mano en Supabase ANTES del preview/merge del PR.
--
-- Convierte passwordHash en nullable para permitir cuentas "invitadas" que aún
-- no fijan su contraseña (el paciente la define desde el correo de invitación,
-- reusando el flujo de /paciente/recuperar). Agrega la atribución de la
-- invitación. patient_accounts YA tiene RLS deny-all — NO se agregan policies.

ALTER TABLE "patient_accounts" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "patient_accounts" ADD COLUMN IF NOT EXISTS "invitedByUserId" text;
ALTER TABLE "patient_accounts" ADD COLUMN IF NOT EXISTS "invitedAt" timestamp(3);
