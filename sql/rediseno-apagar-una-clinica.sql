-- ═══════════════════════════════════════════════════════════════════
-- REDISEÑO DEL PANEL — APAGARLO EN UNA CLÍNICA (y volver a encenderla)
-- Tabla clinic_feature_flags ⇄ modelo Prisma ClinicFeatureFlag
-- Lector: src/lib/menu-dos-niveles/interruptor-core.ts
--
-- Se corre en Supabase (SQL Editor). Lo aplica Rafael, nunca una terminal.
--     https://supabase.com/dashboard/project/_/sql/new
--
-- PARA QUÉ SIRVE. Desde el 17-sep-2026 el rediseño es el panel por defecto:
-- toda clínica lo ve, las de hoy y las que se den de alta mañana, sin que nadie
-- escriba nada. La fila de esta tabla ya no enciende: APAGA. Si una clínica
-- llama quejándose, esto la devuelve al panel de siempre —a ella sola, sin
-- desplegar nada y sin tocar a las demás— y tarda menos de un minuto en notarse
-- (el lector guarda la respuesta de cada clínica 60 s en memoria).
--
-- SI LO QUE HACE FALTA ES APAGARLO PARA TODAS, esto NO es lo que buscas: es la
-- variable de entorno `REDISENO_APAGADO` en Vercel (ver el final del archivo).
-- Esa no toca la base y vuelve con un redespliegue de dos minutos.
--
-- ADITIVO: no borra ni una fila. Apagar es poner "enabled" en false, nunca un
-- DELETE, así que siempre se puede volver atrás con el paso 4.
-- Columnas camelCase entrecomilladas (espejo exacto de Prisma; sin @map).
-- Delimitador único $rd$ (nunca $$ pelado — Supabase lo rompe).
-- ═══════════════════════════════════════════════════════════════════

-- 0) ¿Existe la tabla? Si esto dice `false`, corre ANTES sql/menu-dos-niveles.sql
--    (es aditivo e idempotente, se puede correr aunque ya esté aplicado). Sin la
--    tabla no hay dónde escribir el apagado, y el panel sale encendido en todas.
SELECT to_regclass('public.clinic_feature_flags') IS NOT NULL AS tabla_lista;

-- 1) ¿CUÁL es la clínica? Copia su "id" de aquí. La columna "duenos" es el
--    correo de su dueño: confírmalo antes de apagarle nada a nadie.
--    "panel" dice lo que ve HOY cada una.
SELECT c."name" AS clinica,
       c."id",
       CASE WHEN f."enabled" IS FALSE THEN 'panel de siempre (apagada a mano)'
            ELSE 'rediseño' END AS panel,
       f."enabled" AS fila,
       (SELECT string_agg(u."email", ', ') FROM "users" u
         WHERE u."clinicId" = c."id" AND u."role" = 'SUPER_ADMIN') AS duenos
  FROM "clinics" c
  LEFT JOIN "clinic_feature_flags" f
         ON f."clinicId" = c."id" AND f."flag" = 'menu-dos-niveles'
 ORDER BY c."name";

-- 2) APAGAR esa clínica. Cambia <ID> por el id del paso 1 (las dos veces).
--    Sirve tenga fila o no: si no la tiene, la crea apagada; si la tiene, la
--    apaga. Vuelve al panel de siempre en menos de un minuto, sin deploy.
DO $rd$
DECLARE
  sede_id text := '<ID>';
  sede    text;
BEGIN
  SELECT "name" INTO sede FROM "clinics" WHERE "id" = sede_id;
  IF sede IS NULL THEN
    RAISE EXCEPTION 'No hay ninguna clínica con id «%». Cópialo del paso 1.', sede_id;
  END IF;

  INSERT INTO "clinic_feature_flags" ("clinicId", "flag", "enabled")
  VALUES (sede_id, 'menu-dos-niveles', false)
  ON CONFLICT ("clinicId", "flag") DO UPDATE SET "enabled" = false;

  RAISE NOTICE '«%» (%) vuelve al panel de siempre. Las demás clínicas no se han tocado.', sede, sede_id;
END
$rd$;

-- 3) COMPROBAR. La clínica que acabas de apagar tiene que salir con
--    panel = 'panel de siempre (apagada a mano)'. Las demás, con 'rediseño'.
SELECT c."name" AS clinica,
       c."id",
       CASE WHEN f."enabled" IS FALSE THEN 'panel de siempre (apagada a mano)'
            ELSE 'rediseño' END AS panel
  FROM "clinics" c
  LEFT JOIN "clinic_feature_flags" f
         ON f."clinicId" = c."id" AND f."flag" = 'menu-dos-niveles'
 ORDER BY panel, c."name";

-- ═══════════════════════════════════════════════════════════════════
-- 4) VOLVER A ENCENDERLA (cambia <ID>). Tarda lo mismo: menos de un minuto.
--    La fila se queda, apagada o encendida; aquí no se borra nada.
--
--     UPDATE "clinic_feature_flags" SET "enabled" = true
--      WHERE "clinicId" = '<ID>' AND "flag" = 'menu-dos-niveles';
--
-- 5) APAGARLO PARA TODAS (esto NO es SQL, y es lo que hay que hacer si el fallo
--    lo ven varias clínicas):
--
--     Vercel → el proyecto → Settings → Environment Variables
--     → Add:  REDISENO_APAGADO = 1   (Production)
--     → Deployments → Redeploy del despliegue de producción.
--
--    Devuelve a TODAS al panel de siempre sin mirar la base, así que funciona
--    aunque Supabase esté caído. Para deshacerlo: borra la variable y vuelve a
--    redesplegar. Las clínicas apagadas a mano en el paso 2 siguen apagadas.
-- ═══════════════════════════════════════════════════════════════════
