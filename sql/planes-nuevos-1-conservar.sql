-- ════════════════════════════════════════════════════════════════════════════
-- PLANES NUEVOS · PASO 1 de 2 — CONSERVAR lo que ya tienen las clínicas
--
--   ⚠️  ORDEN (no se puede invertir):
--        1) ESTE archivo            → ANTES de desplegar el código
--        2) deploy del código       (rama feat/planes-nuevos, ya integrada)
--        3) planes-nuevos-2-precios.sql → DESPUÉS de que el código esté en producción
--
--   Si se pegara el 2 antes que el código, todas las clínicas actuales leerían de
--   golpe los límites y el precio nuevos (los Profesional bajarían de 6 a 5
--   usuarios, los Básico de 2 a 3, Clínica pasaría a $1,489).
--   Y si el código se desplegara SIN haber pegado este archivo, TODA consulta a
--   `clinics` sin `select` fallaría (el cliente de Prisma pide columnas que aún
--   no existen).
--
-- QUÉ HACE
--   Añade a "clinics" las condiciones conservadas y RELLENA cada clínica existente
--   con lo que tiene HOY su plan, copiándolo de `plan_configs` tal como está en
--   este momento (no números escritos a mano aquí):
--     planOverrideFor          plan para el que se conservan (la guarda: si la clínica
--                              cambia de plan, dejan de valer solas)
--     maxUsersOverride         usuarios   (-1 = ilimitado; NULL = sigue el plan)
--     maxClinicsOverride       sedes      (-1 = ilimitado; NULL = sigue el plan)
--     priceMxnMonthlyOverride  precio mensual que paga (MXN + IVA)
--     priceMxnAnnualOverride   precio anual que paga (MXN + IVA)
--   Con los planes de hoy debe quedar: Básico 2 usuarios · Profesional 6 ·
--   Clínica ilimitados (-1); sedes 1/1/N (N = lo que diga plan_configs hoy);
--   precios 419/3264 · 689/5376 · 1719/13404.
--
-- SEGURIDAD
--   · Idempotente: ADD COLUMN IF NOT EXISTS, y el UPDATE solo toca filas con
--     "planOverrideFor" IS NULL, así que re-ejecutarlo no pisa nada.
--   · Aplicarlo ANTES del deploy es inocuo: el código viejo ignora las columnas.
--   · SQL plano, sin bloques DO $$ (el editor de Supabase no los digiere).
--
--   VENTANA DEL DESPLIEGUE: una clínica que se dé de alta entre este archivo y el
--   deploy (código viejo) queda sin condiciones conservadas y, al pegar el paso 2,
--   se rige por el plan nuevo. Para minimizarlo: repite ESTE archivo (es seguro
--   antes del deploy) justo antes de desplegar, y pega el paso 2 en cuanto el
--   deploy termine.

--   ⛔ EJECÚTALO UNA SOLA VEZ, ANTES DEL DEPLOY. NO lo repitas después de
--   desplegar y antes del paso 2: las clínicas dadas de alta entre tanto tienen
--   "planOverrideFor" NULL a propósito (son altas nuevas) y este UPDATE les
--   regalaría las condiciones viejas. (Repetirlo ANTES del deploy sí es seguro y
--   cubre a las que se hayan registrado desde la primera vez.)
-- ════════════════════════════════════════════════════════════════════════════

-- 0) MIRA ESTO ANTES DE PEGAR EL RESTO. Es lo que se va a congelar en cada
--    clínica. Esperado hoy: BASIC 2 usuarios · PRO 6 · CLINIC NULL (ilimitados);
--    maxClinics 1 / 1 / (3 ó 4); precios 419/3264 · 689/5376 · 1719/13404.
--    Si algo no cuadra con lo que pagan las clínicas, DETENTE y avisa.
--    OJO sedes de CLINIC: el repo sembró 3 (sql/plan_configs_max_clinics.sql). Si
--    aquí sale 3 pero las Clínica actuales deben conservar 4, ajusta la fila ANTES
--    de seguir (o corrige después con la ficha de cada clínica en /admin).
--    Y cada plan de este SELECT debe existir: un plan sin fila NO se rellena.
SELECT "planId", "maxUsers", "maxClinics", "priceMxnMonthly", "priceMxnAnnual"
FROM "plan_configs"
ORDER BY "planId";

-- 1) Columnas nuevas (nullable, sin default: NULL = «sigue el plan»).
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "planOverrideFor" "Plan";
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "maxUsersOverride" integer;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "maxClinicsOverride" integer;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "priceMxnMonthlyOverride" integer;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "priceMxnAnnualOverride" integer;

-- 2) Rellenar TODAS las clínicas existentes (activas, en prueba, canceladas y
--    sedes) con las condiciones de su plan de hoy. NULL en plan_configs = ilimitado
--    → se guarda -1 (en la clínica, NULL ya significaría «sin override»).
UPDATE "clinics" AS c
SET "planOverrideFor"         = c."plan",
    "maxUsersOverride"        = COALESCE(pc."maxUsers", -1),
    "maxClinicsOverride"      = COALESCE(pc."maxClinics", -1),
    "priceMxnMonthlyOverride" = pc."priceMxnMonthly",
    "priceMxnAnnualOverride"  = pc."priceMxnAnnual"
FROM "plan_configs" AS pc
WHERE pc."planId" = c."plan"::text
  AND c."planOverrideFor" IS NULL;

-- 3) Verificación.
--    a) Clínicas por plan y lo que conservan (una fila por combinación):
SELECT "plan", "maxUsersOverride", "maxClinicsOverride",
       "priceMxnMonthlyOverride", "priceMxnAnnualOverride", count(*) AS clinicas
FROM "clinics"
GROUP BY 1, 2, 3, 4, 5
ORDER BY 1, 2, 3;
--    b) Clínicas que se quedaron SIN rellenar (esperado: 0 justo después de pegar;
--       si sale > 0, su plan no tiene fila en plan_configs: NO DESPLIEGUES hasta
--       resolverlo, porque al desplegar leerían el plan nuevo):
SELECT count(*) AS sin_rellenar FROM "clinics" WHERE "planOverrideFor" IS NULL;
