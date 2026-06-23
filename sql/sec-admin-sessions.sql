-- ============================================================================
-- WS2-T3 · Sesiones de admin en DB (identidad real + revocación + atribución)
-- ----------------------------------------------------------------------------
-- APLICAR A MANO en Supabase (NO `prisma migrate`). Idempotente.
--
-- Las columnas van entre comillas dobles y en camelCase a propósito: el schema
-- de Prisma NO usa @map en estos campos, así que el cliente genera SQL con los
-- nombres en camelCase ("passwordHash", "adminUserId", "tokenHash", ...). Si se
-- crean en snake_case, Prisma fallará en runtime al no encontrar las columnas.
--
-- admin_users / admin_sessions son tablas GLOBALES (sin clinicId): quedan FUERA
-- del RLS por clínica a propósito. NO se habilita ROW LEVEL SECURITY en ellas.
-- ============================================================================

-- 1) Administradores de plataforma ------------------------------------------
CREATE TABLE IF NOT EXISTS "admin_users" (
  "id"           TEXT PRIMARY KEY,
  "email"        TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "totpSecret"   TEXT,
  "totpEnabled"  BOOLEAN NOT NULL DEFAULT false,
  "role"         TEXT NOT NULL DEFAULT 'SUPER_ADMIN',
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_email_key" ON "admin_users" ("email");

-- 2) Sesiones de admin (token aleatorio; en BD solo vive su sha256) ----------
CREATE TABLE IF NOT EXISTS "admin_sessions" (
  "id"          TEXT PRIMARY KEY,
  "adminUserId" TEXT NOT NULL,
  "tokenHash"   TEXT NOT NULL,
  "ipAddress"   TEXT,
  "userAgent"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "revokedAt"   TIMESTAMP(3),
  CONSTRAINT "admin_sessions_adminUserId_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "admin_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_sessions_tokenHash_key" ON "admin_sessions" ("tokenHash");
CREATE INDEX        IF NOT EXISTS "admin_sessions_adminUserId_idx" ON "admin_sessions" ("adminUserId");

-- 3) Atribución del actor en la bitácora ------------------------------------
--    "staff" = User de clínica (default, comportamiento histórico)
--    "admin" = AdminUser de plataforma (cookie admin) → actorAdminId = AdminUser.id
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actorType"    TEXT DEFAULT 'staff';
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actorAdminId" TEXT;

-- ============================================================================
-- SEMILLA DEL PRIMER ADMIN
-- ----------------------------------------------------------------------------
-- NO se siembra desde este SQL. La app crea el primer AdminUser automáticamente
-- en el primer login (lib/admin-auth.ts → ensureSeedAdmin): si no existe ningún
-- AdminUser, lo crea con email = ADMIN_EMAIL (o admin@dalecontrol.com),
-- passwordHash = bcrypt(ADMIN_PASSWORD) y totpSecret = ADMIN_TOTP_SECRET. Así el
-- acceso actual (mismas envs ADMIN_PASSWORD + ADMIN_TOTP_SECRET) sigue intacto.
-- ============================================================================
