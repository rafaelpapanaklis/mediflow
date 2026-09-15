-- ═══════════════════════════════════════════════════════════════════
-- MENÚ DE DOS NIVELES — interruptor POR CLÍNICA
-- Tabla clinic_feature_flags ⇄ modelo Prisma ClinicFeatureFlag
-- Lector: src/lib/menu-dos-niveles/interruptor.ts
--
-- Se corre en Supabase (SQL Editor). Lo aplica Rafael, nunca una terminal.
--     https://supabase.com/dashboard/project/_/sql/new
--
-- SIN ESTE SQL NO SE ROMPE NADA: el lector trata "la tabla no existe" como
-- "apagado" y todas las clínicas ven el menú de siempre. No añade columnas a
-- ninguna tabla existente (ni a clinics ni a users), así que el login no se
-- entera. Se puede correr antes o después del deploy.
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica datos de
-- ninguna otra tabla.
-- Columnas camelCase entrecomilladas (espejo exacto de Prisma; sin @map).
-- Delimitador único $m2n$ (nunca $$ pelado — Supabase lo rompe).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Tabla. Una fila por (clínica, función). Hoy la única función es
--    'menu-dos-niveles'. "enabled" permite apagar sin borrar la fila.
CREATE TABLE IF NOT EXISTS "clinic_feature_flags" (
  "clinicId"  text         NOT NULL,
  "flag"      text         NOT NULL,
  "enabled"   boolean      NOT NULL DEFAULT true,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clinic_feature_flags_pkey" PRIMARY KEY ("clinicId", "flag")
);

-- 2) Llave foránea a clinics: si se borra una sede, su interruptor se va con ella.
DO $m2n$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_feature_flags_clinicId_fkey') THEN
    ALTER TABLE "clinic_feature_flags"
      ADD CONSTRAINT "clinic_feature_flags_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla clinics inexistente — FK saltada (deploy parcial)';
END
$m2n$;

-- 3) Defense-in-depth: RLS deny-all para anon y authenticated (patrón
--    sql/rls-deny-all-policies.sql). DaleControl lee solo vía Prisma + service
--    role (bypassa RLS).
DO $m2n$
BEGIN
  EXECUTE 'ALTER TABLE "clinic_feature_flags" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clinic_feature_flags' AND policyname = 'clinic_feature_flags_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "clinic_feature_flags_deny_anon" ON "clinic_feature_flags" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'clinic_feature_flags no existe — RLS saltada';
END
$m2n$;

-- 4) ENCENDER en la sede «Local Altabrisa».
--    Solo enciende si hay EXACTAMENTE UNA clínica que se llame «Local Altabrisa»
--    (sin distinguir mayúsculas ni espacios de los lados). Con cero o con varias
--    NO toca nada y lo avisa: la consulta del paso 5 enseña las candidatas, con
--    el correo de su dueño, para encenderla a mano por id.
--    Si la fila ya existe NO la cambia (DO NOTHING): volver a correr este archivo
--    nunca reenciende un menú que se apagó a propósito.
DO $m2n$
DECLARE
  n       integer;
  sede_id text;
  sede    text;
BEGIN
  SELECT count(*) INTO n FROM "clinics" WHERE lower(btrim("name")) = 'local altabrisa';
  IF n = 1 THEN
    SELECT "id", "name" INTO sede_id, sede FROM "clinics" WHERE lower(btrim("name")) = 'local altabrisa';
    INSERT INTO "clinic_feature_flags" ("clinicId", "flag", "enabled")
    VALUES (sede_id, 'menu-dos-niveles', true)
    ON CONFLICT ("clinicId", "flag") DO NOTHING;
    RAISE NOTICE 'Menú de dos niveles: fila de «%» (%) lista. Mira el paso 5.', sede, sede_id;
  ELSE
    RAISE WARNING 'Hay % clínicas llamadas exactamente "Local Altabrisa": NO se encendió nada. Mira la lista del paso 5.', n;
  END IF;
END
$m2n$;

-- 5) Comprobación. Primero, las clínicas con el menú nuevo (menu_nuevo = true
--    encendido, false apagado); debajo, las que se llaman parecido a Altabrisa y
--    aún no tienen fila. La columna "duenos" es el correo del dueño: confirma que
--    es tu cuenta antes de dar nada por bueno.
SELECT c."name" AS clinica, c."id", f."enabled" AS menu_nuevo,
       (SELECT string_agg(u."email", ', ') FROM "users" u
         WHERE u."clinicId" = c."id" AND u."role" = 'SUPER_ADMIN') AS duenos
  FROM "clinic_feature_flags" f
  JOIN "clinics" c ON c."id" = f."clinicId"
 WHERE f."flag" = 'menu-dos-niveles'
UNION ALL
SELECT c."name", c."id", NULL,
       (SELECT string_agg(u."email", ', ') FROM "users" u
         WHERE u."clinicId" = c."id" AND u."role" = 'SUPER_ADMIN')
  FROM "clinics" c
 WHERE c."name" ILIKE '%altabrisa%'
   AND NOT EXISTS (
     SELECT 1 FROM "clinic_feature_flags" f
      WHERE f."clinicId" = c."id" AND f."flag" = 'menu-dos-niveles'
   );

-- ═══════════════════════════════════════════════════════════════════
-- A mano, cuando haga falta (cambia <ID> por el id de la clínica):
--
--   Encender en otra clínica:
--     INSERT INTO "clinic_feature_flags" ("clinicId", "flag", "enabled")
--     VALUES ('<ID>', 'menu-dos-niveles', true)
--     ON CONFLICT ("clinicId", "flag") DO NOTHING;
--
--   Volver a encender una que se apagó:
--     UPDATE "clinic_feature_flags" SET "enabled" = true
--      WHERE "clinicId" = '<ID>' AND "flag" = 'menu-dos-niveles';
--
--   Apagar (vuelve el menú de siempre en menos de un minuto, sin deploy):
--     UPDATE "clinic_feature_flags" SET "enabled" = false
--      WHERE "clinicId" = '<ID>' AND "flag" = 'menu-dos-niveles';
-- ═══════════════════════════════════════════════════════════════════
