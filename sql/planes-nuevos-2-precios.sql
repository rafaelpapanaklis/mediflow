-- ════════════════════════════════════════════════════════════════════════════
-- PLANES NUEVOS · PASO 2 de 2 — PRECIOS Y LÍMITES de las ALTAS NUEVAS
--
--   ⚠️  ESTE ARCHIVO SE PEGA DESPUÉS de que el código de feat/planes-nuevos esté
--   EN PRODUCCIÓN, y DESPUÉS de haber pegado sql/planes-nuevos-1-conservar.sql.
--   Si se pega antes, las clínicas actuales pierden sus límites y su precio (el
--   código viejo no sabe conservarlos). Orden: SQL 1 → deploy → SQL 2.
--
-- QUÉ HACE (solo la tabla plan_configs, que lee la web, el checkout y el panel)
--   Usuarios : Básico 3 · Profesional 5 · Clínica ilimitados (NULL)
--   Sedes    : Básico 1 · Profesional 1 · Clínica 3
--   Clínica  : $1,489/mes  (antes $1,719) y $11,614/año (antes $13,404). + IVA.
--
--   Anual de Clínica (confirmado por Rafael, 26-sep-2026): 35% de descuento sobre
--   12 meses: 1,489 × 12 = 17,868 × 0.65 = 11,614.20 → 11614 (la columna
--   "priceMxnAnnual" es entera; los centavos no caben).
--   Los anuales de Básico (3,264) y Profesional (5,376) NO se tocan.
--
--   NO se toca nada más: precios de Básico/Profesional, pacientes, almacenamiento,
--   tokens de IA, CFDI (25/50/150 y excedentes) ni módulos.
--   Las clínicas ya registradas siguen con lo suyo (columnas *Override de
--   "clinics", rellenadas por el paso 1).
--
-- SEGURIDAD
--   · La primera sentencia falla (y aborta todo) si el paso 1 no se pegó: lee las
--     columnas nuevas de "clinics". Cada UPDATE, además, solo actúa si el paso 1
--     ya dejó clínicas conservadas.
--   · Idempotente: son valores fijos, re-ejecutar deja lo mismo.
--   · SQL plano, sin bloques DO $$.
-- ════════════════════════════════════════════════════════════════════════════

-- 0) Guarda: debe salir un número > 0 (clínicas con condiciones conservadas). Si da
--    error de «column does not exist», falta el paso 1: DETENTE.
SELECT count(*) AS clinicas_conservadas FROM "clinics" WHERE "planOverrideFor" IS NOT NULL;

UPDATE "plan_configs"
SET "maxUsers"   = 3,
    "maxClinics" = 1,
    "updatedAt"  = NOW()
WHERE "planId" = 'BASIC'
  AND EXISTS (SELECT 1 FROM "clinics" WHERE "planOverrideFor" IS NOT NULL);

UPDATE "plan_configs"
SET "maxUsers"   = 5,
    "maxClinics" = 1,
    "updatedAt"  = NOW()
WHERE "planId" = 'PRO'
  AND EXISTS (SELECT 1 FROM "clinics" WHERE "planOverrideFor" IS NOT NULL);

UPDATE "plan_configs"
SET "maxUsers"        = NULL,
    "maxClinics"      = 3,
    "priceMxnMonthly" = 1489,
    "priceMxnAnnual"  = 11614,
    "updatedAt"       = NOW()
WHERE "planId" = 'CLINIC'
  AND EXISTS (SELECT 1 FROM "clinics" WHERE "planOverrideFor" IS NOT NULL);

-- Verificación. Debe devolver:
--   BASIC  3 · 1 · 419  · 3264
--   CLINIC NULL · 3 · 1489 · 11614
--   PRO    5 · 1 · 689  · 5376
SELECT "planId", "maxUsers", "maxClinics", "priceMxnMonthly", "priceMxnAnnual"
FROM "plan_configs"
ORDER BY "planId";
