-- ════════════════════════════════════════════════════════════════════════════
-- PLANES NUEVOS · PASO 1b — las altas del 26-sep pasan al plan NUEVO
--
--   Decisión de Rafael: las clínicas dadas de alta EN/DESPUÉS del corte de IVA
--   (26-sep-2026 00:00 hora de México = 06:00 UTC) y ANTES de que se pegara el
--   paso 1 quedaron con las condiciones conservadas (usuarios / sedes / precio
--   del plan VIEJO) y, a la vez, pagan IVA. Este archivo les QUITA lo conservado:
--   pasan a las condiciones del plan nuevo (las que dejará el paso 2).
--
-- QUÉ HACE
--   1) SELECT: lista qué clínicas se van a tocar (revísalas antes de seguir).
--   2) UPDATE: pone planOverrideFor y los cuatro *Override en NULL SOLO en las
--      clínicas creadas en/después del corte y que hoy tienen condiciones
--      conservadas. No toca plan, estado, precios negociados (monthlyPrice) ni nada más.
--   3) SELECT de verificación: debe salir 0 filas.
--
-- ORDEN Y SEGURIDAD
--   · Va DESPUÉS del paso 1 (necesita las columnas). Antes de eso falla con
--     «column does not exist» y no cambia nada.
--   · Da IGUAL pegarlo antes o después del deploy del código: el código viejo no lee
--     estas columnas, y el nuevo las lee solo si "planOverrideFor" tiene valor. Después del
--     deploy, hasta que se pegue, esas clínicas se rigen por lo conservado; con el paso 2 y
--     este archivo aplicados se rigen por el plan nuevo.
--   · Si repites el paso 1 (es válido ANTES del deploy, para cubrir altas de la ventana),
--     pega ESTE archivo DESPUÉS de la última repetición: el paso 1 vuelve a congelar a
--     cualquier clínica con "planOverrideFor" NULL, incluidas estas.
--   · Puedes repetirlo cuando quieras: es idempotente (la segunda vez no encuentra filas).
--   · SQL plano, sin bloques DO $$.
--   · El corte es el mismo del código (IVA_FECHA_CORTE en src/lib/billing/iva-cobro.ts).
--     "createdAt" se guarda en UTC sin zona; por eso el literal va en UTC.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) MIRA ESTO ANTES: las clínicas que dejarán de conservar condiciones.
SELECT "id", "name", "createdAt", "plan",
       "maxUsersOverride", "maxClinicsOverride", "priceMxnMonthlyOverride", "priceMxnAnnualOverride"
FROM "clinics"
WHERE "createdAt" >= '2026-09-26T06:00:00Z'
  AND "planOverrideFor" IS NOT NULL
ORDER BY "createdAt";

-- 2) Quitarles las condiciones conservadas.
UPDATE "clinics"
SET "planOverrideFor"         = NULL,
    "maxUsersOverride"        = NULL,
    "maxClinicsOverride"      = NULL,
    "priceMxnMonthlyOverride" = NULL,
    "priceMxnAnnualOverride"  = NULL
WHERE "createdAt" >= '2026-09-26T06:00:00Z'
  AND "planOverrideFor" IS NOT NULL;

-- 3) Verificación: debe salir 0 en las dos columnas.
SELECT count(*) FILTER (WHERE "planOverrideFor" IS NOT NULL) AS altas_del_26_con_condiciones_conservadas,
       count(*)                                              AS altas_del_26_en_total
FROM "clinics"
WHERE "createdAt" >= '2026-09-26T06:00:00Z';
