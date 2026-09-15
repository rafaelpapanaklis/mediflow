-- ═══════════════════════════════════════════════════════════════════
-- Sabina: qué puede hacer en nombre de cada usuario (WS1-T1, 2026-09-14)
-- Tabla sabina_user_permissions ⇄ SabinaUserPermission (prisma/schema.prisma).
--
-- Lo edita el SUPER_ADMIN desde Equipo → botón «Sabina» de cada miembro, y lo
-- aplica `crearSabinaCtx` (src/lib/sabina/tipos.ts) en cada petición a Sabina.
--
--   · Sin fila           → Sabina activa, con todo lo que el usuario puede.
--   · enabled = false    → Sabina no hace NADA en nombre de ese usuario.
--   · permissions vacío  → todo lo que el usuario puede.
--   · permissions con keys → exactamente esas (reemplaza, no suma: misma
--     convención que users."permissionsOverride").
--   En todos los casos se intersecan con los permisos del usuario: Sabina nunca
--   puede más que quien le escribe.
--
-- Tabla aparte y no columnas en "users": getAuthContext lee el usuario sin
-- select, y una columna del schema que aún no existe en la base tumbaría el
-- login de todo el panel. Si esta tabla falta, el panel sigue igual: Sabina se
-- comporta como hoy y el botón de Equipo avisa de que falta este archivo.
--
-- IDEMPOTENTE: CREATE ... IF NOT EXISTS + ADD COLUMN IF NOT EXISTS + bloques DO
-- con guardas. Seguro de re-correr. Delimitadores $sp$ (NUNCA $$ pelado — el
-- editor de Supabase rompe el parser con $$).
--
-- Aplicar a mano en Supabase. NO prisma migrate.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Tabla. Columnas en camelCase entre comillas: Prisma mapea el nombre del
--    campo tal cual (sin @map) → la columna DEBE llamarse igual.
CREATE TABLE IF NOT EXISTS "sabina_user_permissions" (
  "userId"      TEXT NOT NULL,
  "clinicId"    TEXT NOT NULL,
  "enabled"     BOOLEAN NOT NULL DEFAULT true,
  "permissions" TEXT[] NOT NULL DEFAULT '{}',
  "updatedById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sabina_user_permissions_pkey" PRIMARY KEY ("userId")
);

-- Por si la tabla ya existía de una versión previa: columnas idempotentes.
ALTER TABLE "sabina_user_permissions" ADD COLUMN IF NOT EXISTS "enabled"     BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "sabina_user_permissions" ADD COLUMN IF NOT EXISTS "permissions" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "sabina_user_permissions" ADD COLUMN IF NOT EXISTS "updatedById" TEXT;
ALTER TABLE "sabina_user_permissions" ADD COLUMN IF NOT EXISTS "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "sabina_user_permissions" ADD COLUMN IF NOT EXISTS "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2) Índice de tenant: toda lectura filtra por clínica.
CREATE INDEX IF NOT EXISTS "sabina_user_permissions_clinicId_idx" ON "sabina_user_permissions" ("clinicId");

-- 3) Llaves foráneas (idempotentes). Si se borra el usuario o la clínica, su
--    configuración de Sabina se va con él.
DO $sp$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sabina_user_permissions_userId_fkey') THEN
    ALTER TABLE "sabina_user_permissions"
      ADD CONSTRAINT "sabina_user_permissions_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sabina_user_permissions_clinicId_fkey') THEN
    ALTER TABLE "sabina_user_permissions"
      ADD CONSTRAINT "sabina_user_permissions_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla referenciada inexistente — FKs saltadas (deploy parcial)';
END
$sp$;

-- 4) Defense-in-depth: RLS deny-all para anon y authenticated (patrón
--    sql/rls-deny-all-policies.sql). DaleControl accede solo vía Prisma +
--    service role (bypassa RLS). Esto cierra PostgREST si se filtra el anon key.
DO $sp$
BEGIN
  EXECUTE 'ALTER TABLE "sabina_user_permissions" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sabina_user_permissions' AND policyname = 'sabina_user_permissions_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "sabina_user_permissions_deny_anon" ON "sabina_user_permissions" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'sabina_user_permissions no existe — RLS saltada';
END
$sp$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación:
--   SELECT policyname FROM pg_policies WHERE tablename = 'sabina_user_permissions';
--   SELECT conname FROM pg_constraint WHERE conname LIKE 'sabina_user_permissions_%';
--   SELECT count(*) FROM "sabina_user_permissions";   -- 0 recién aplicado
-- ═══════════════════════════════════════════════════════════════════
