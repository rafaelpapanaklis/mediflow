-- ═══════════════════════════════════════════════════════════════════
-- PERSONALIZAR EL MENÚ — el orden que cada PERSONA se armó a mano
-- Tabla user_menu_layouts ⇄ modelo Prisma UserMenuLayout
-- Lo lee  : src/lib/menu-personalizado/almacen.ts
-- Lo edita: la opción «Personalizar» de la tarjeta del usuario, en el menú
--           de dos niveles (solo en las clínicas con ese menú encendido).
--
-- Se corre en Supabase (SQL Editor). Lo aplica Rafael, nunca una terminal.
--     https://supabase.com/dashboard/project/_/sql/new
--
-- SIN ESTE SQL NO SE CAE NADA: el lector trata «la tabla no existe» como
-- «nadie ha personalizado», todo el mundo ve el menú de siempre y la opción
-- «Personalizar» ni siquiera aparece. No añade columnas a ninguna tabla
-- existente (ni a "users" ni a "clinics"), así que el login —que lee al
-- usuario con todas sus columnas— no se entera de nada.
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr entero. No borra ni cambia datos
-- de ninguna otra tabla. SIN bloques DO $$ …: el editor de Supabase los rompe,
-- así que la idempotencia va con IF NOT EXISTS y con DROP … IF EXISTS antes de
-- crear lo que no admite IF NOT EXISTS (restricciones y políticas).
--
-- Columnas en camelCase entrecomillado: espejo exacto de Prisma (sin @map).
-- ═══════════════════════════════════════════════════════════════════

-- 1) La tabla. UNA fila por usuario. Cada persona tiene una fila de "users"
--    POR clínica, así que quien trabaja en dos sedes personaliza cada una por
--    su lado. "layout" guarda SOLO el sitio de cada cosa (ids y contenedores),
--    nunca qué opciones ve: eso se recalcula con sus permisos en cada carga.
--    "revision" cambia en cada guardado y es lo que evita que dos pestañas
--    abiertas a la vez se pisen la una a la otra.
CREATE TABLE IF NOT EXISTS "user_menu_layouts" (
  "userId"    text         NOT NULL,
  "clinicId"  text         NOT NULL,
  "layout"    jsonb        NOT NULL,
  "revision"  text         NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_menu_layouts_pkey" PRIMARY KEY ("userId")
);

-- Por si la tabla ya existiera de una prueba anterior: columnas idempotentes.
ALTER TABLE "user_menu_layouts" ADD COLUMN IF NOT EXISTS "clinicId"  text;
ALTER TABLE "user_menu_layouts" ADD COLUMN IF NOT EXISTS "layout"    jsonb;
ALTER TABLE "user_menu_layouts" ADD COLUMN IF NOT EXISTS "revision"  text;
ALTER TABLE "user_menu_layouts" ADD COLUMN IF NOT EXISTS "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "user_menu_layouts" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2) Índice de tenant: toda lectura filtra por clínica además de por usuario.
CREATE INDEX IF NOT EXISTS "user_menu_layouts_clinicId_idx" ON "user_menu_layouts" ("clinicId");

-- 3) Llaves foráneas. Si se borra el usuario (o la clínica), su menú personal
--    se va con él. DROP … IF EXISTS + ADD es la forma PLANA de que re-correr
--    esto no falle: PostgreSQL no tiene ADD CONSTRAINT IF NOT EXISTS.
ALTER TABLE "user_menu_layouts" DROP CONSTRAINT IF EXISTS "user_menu_layouts_userId_fkey";
ALTER TABLE "user_menu_layouts"
  ADD CONSTRAINT "user_menu_layouts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_menu_layouts" DROP CONSTRAINT IF EXISTS "user_menu_layouts_clinicId_fkey";
ALTER TABLE "user_menu_layouts"
  ADD CONSTRAINT "user_menu_layouts_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) Defense-in-depth: RLS deny-all para anon y authenticated (mismo patrón que
--    sql/rls-deny-all-policies.sql). DaleControl entra solo por Prisma con la
--    service role, que se salta RLS; esto cierra PostgREST si se filtrara la
--    anon key. ENABLE no falla si ya estaba puesta.
ALTER TABLE "user_menu_layouts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_menu_layouts_deny_anon" ON "user_menu_layouts";
CREATE POLICY "user_menu_layouts_deny_anon" ON "user_menu_layouts"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- 5) Comprobación. Debe decir que la tabla existe y cuántas personas han
--    personalizado su menú (recién aplicado: 0).
SELECT to_regclass('public.user_menu_layouts') IS NOT NULL AS tabla_lista,
       (SELECT count(*) FROM "user_menu_layouts")           AS menus_personalizados;

-- ═══════════════════════════════════════════════════════════════════
-- A mano, cuando haga falta:
--
--   Ver quién ha personalizado su menú (y en qué sede):
--     SELECT u."email", c."name" AS clinica, m."updatedAt"
--       FROM "user_menu_layouts" m
--       JOIN "users" u   ON u."id" = m."userId"
--       JOIN "clinics" c ON c."id" = m."clinicId"
--      ORDER BY m."updatedAt" DESC;
--
--   Devolver a UNA persona su menú de fábrica (lo mismo que hace el botón
--   «Volver al menú original»); cambia <ID> por el id de su fila de users:
--     DELETE FROM "user_menu_layouts" WHERE "userId" = '<ID>';
--
--   Devolver el menú de fábrica a TODA una sede (cambia <CLINIC_ID>):
--     DELETE FROM "user_menu_layouts" WHERE "clinicId" = '<CLINIC_ID>';
-- ═══════════════════════════════════════════════════════════════════
