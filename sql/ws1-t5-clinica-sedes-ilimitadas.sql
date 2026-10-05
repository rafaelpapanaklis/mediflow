-- ════════════════════════════════════════════════════════════════════════════
-- PLAN CLÍNICA · SEDES ILIMITADAS (ws1-t5, encargo 8 · decisión de Rafael, 5-oct-2026)
--
--   «El plan Clínica tiene sedes ilimitadas: solo lo limita el almacenamiento de 75 GB.»
--
-- QUÉ HACE (solo dos columnas; nada de precios, usuarios ni otros overrides)
--   1) plan_configs.maxClinics de CLINIC → NULL (= ilimitadas). La portada ya pinta
--      «Ilimitadas» con NULL y el cupo de sucursales (src/lib/branches.ts) deja crear
--      sin tope con NULL.
--   2) clinics.maxClinicsOverride → NULL en las clínicas que conservan condiciones del
--      plan Clínica ("planOverrideFor" = 'CLINIC') y tienen un tope propio de sedes
--      (hoy: 5 clínicas con 4). NULL = «sin override»: siguen el plan → ilimitadas.
--      Las sucursales de esas clínicas heredaron el mismo override al crearse, así que
--      el mismo WHERE las cubre.
--
-- ORDEN
--   Se puede pegar antes o después del deploy del código de ws1-t5 (encargo 8): el
--   código ya trata NULL como ilimitado. Lo único que cambia el código es el RESPALDO
--   (lo que se usa si plan_configs no se puede leer), que pasa de 3 a ilimitado.
--
-- SEGURIDAD
--   · Idempotente: los dos UPDATE solo tocan filas que todavía no están en NULL;
--     repetirlo no cambia nada (0 filas la segunda vez).
--   · Sin DROP, sin columnas nuevas, sin bloques DO $$ (el editor de Supabase no los digiere).
--   · Pégalo por bloques: 0 (mirar), 1-2 (cambiar), 3 (comprobar).
-- ════════════════════════════════════════════════════════════════════════════

-- 0) ANTES. Esperado hoy: CLINIC con maxClinics 3 (BASIC y PRO en 1), y 5 clínicas
--    CLINIC con maxClinicsOverride 4. Si algo no cuadra, DETENTE y avisa.
SELECT "planId", "maxClinics" FROM "plan_configs" ORDER BY "planId";

SELECT "maxClinicsOverride", count(*) AS clinicas
FROM "clinics"
WHERE "planOverrideFor" = 'CLINIC'
GROUP BY "maxClinicsOverride"
ORDER BY "maxClinicsOverride" NULLS FIRST;

-- 1) El plan Clínica sin tope de sedes.
UPDATE "plan_configs"
SET "maxClinics" = NULL
WHERE "planId" = 'CLINIC'
  AND "maxClinics" IS NOT NULL;

-- 2) Las clínicas Clínica con tope propio de sedes vuelven a seguir el plan (ilimitadas).
--    SOLO la columna de sedes: usuarios, precios y "planOverrideFor" no se tocan.
UPDATE "clinics"
SET "maxClinicsOverride" = NULL
WHERE "planOverrideFor" = 'CLINIC'
  AND "maxClinicsOverride" IS NOT NULL;

-- 3) DESPUÉS. Esperado: CLINIC → NULL (BASIC y PRO siguen en 1), y ninguna clínica
--    CLINIC con override de sedes (la consulta de abajo da 0).
SELECT "planId", "maxClinics" FROM "plan_configs" ORDER BY "planId";

SELECT count(*) AS clinica_con_tope_de_sedes
FROM "clinics"
WHERE "planOverrideFor" = 'CLINIC'
  AND "maxClinicsOverride" IS NOT NULL;

-- Nota: el código guarda en memoria la configuración de planes 60 s. Tras pegar esto,
-- en un minuto como mucho todas las pantallas leen «Sedes ilimitadas».
