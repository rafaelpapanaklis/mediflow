-- ============================================================================
-- PRECIOS v3 (landing v3, jul-2026) — tabla plan_configs
-- ============================================================================
-- Matriz oficial (MXN, IVA aparte):
--   BASIC  : $419/mes  · anual $3,264  (equiv $272/mes,  ahorra $1,764)
--   PRO    : $689/mes  · anual $5,376  (equiv $448/mes,  ahorra $2,892)
--   CLINIC : $1,719/mes · anual $13,404 (equiv $1,117/mes, ahorra $7,224)
-- Anual = 35% de descuento (antes 30%: 4192/8392/16792 sobre 499/999/1999).
-- Además: tope de pacientes del plan Básico sube de 200 → 500.
--
-- Notas:
--  * plan_configs es la fuente VIVA de precios (checkout la lee vía
--    getResolvedPlan). El fallback/seed del código ya trae estos valores
--    (src/lib/plan-shared.ts) — este SQL alinea las filas EXISTENTES.
--  * Si la tabla está vacía, los UPDATE no hacen nada y el fallback nuevo
--    aplica solo: no pasa nada malo, pero corre el SELECT final para verificar.
--  * Solo se tocan precios y el tope de pacientes de BASIC; el resto de
--    límites/casillas editados desde /admin se conservan.
--  * La promo de 1er mes ($19/$29/$39) NO vive en la BD: es un cupón "once"
--    de Stripe que crea el checkout (src/lib/billing/first-month-promo.ts).
-- ============================================================================

UPDATE plan_configs
SET "priceMxnMonthly" = 419,
    "priceMxnAnnual"  = 3264,
    "maxPatients"     = 500,
    "updatedAt"       = NOW()
WHERE "planId" = 'BASIC';

UPDATE plan_configs
SET "priceMxnMonthly" = 689,
    "priceMxnAnnual"  = 5376,
    "updatedAt"       = NOW()
WHERE "planId" = 'PRO';

UPDATE plan_configs
SET "priceMxnMonthly" = 1719,
    "priceMxnAnnual"  = 13404,
    "updatedAt"       = NOW()
WHERE "planId" = 'CLINIC';

-- Verificación: debe devolver 419/3264/500, 689/5376, 1719/13404 (o 0 filas
-- si la tabla sigue vacía y aplica el fallback del código).
SELECT "planId", "priceMxnMonthly", "priceMxnAnnual", "maxPatients", "maxUsers"
FROM plan_configs
ORDER BY "planId";
