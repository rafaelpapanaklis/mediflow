-- sec-staff-2fa — 2FA (TOTP) para usuarios de clínica (opcional + forzable)
-- APLICAR A MANO en el SQL editor de Supabase. NO se corre `prisma migrate`.
-- Idempotente (IF NOT EXISTS). Nombres de columna = nombres de campo Prisma
-- (camelCase, entre comillas → case-sensitive).

-- Por usuario: secret TOTP (base32), flag de activación y hashes bcrypt de los
-- códigos de recuperación de un solo uso.
ALTER TABLE "users"   ADD COLUMN IF NOT EXISTS "totpSecret"    text;
ALTER TABLE "users"   ADD COLUMN IF NOT EXISTS "totpEnabled"   boolean NOT NULL DEFAULT false;
ALTER TABLE "users"   ADD COLUMN IF NOT EXISTS "recoveryCodes" text[]  NOT NULL DEFAULT ARRAY[]::text[];

-- Por clínica: si true, todos sus usuarios DEBEN enrolar 2FA al entrar al panel.
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "require2fa"    boolean NOT NULL DEFAULT false;
