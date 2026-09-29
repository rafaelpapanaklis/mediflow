-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T10 · ORTODONCIA, «Pago por control» no se podía guardar.
--
-- La tabla "orthodontic_treatment_plans" nació (migración 20260505000000_orthodontics_module) con
--   CHECK "orthodontic_treatment_plans_duration_chk":
--     "estimatedDurationMonths" BETWEEN 3 AND 60  AND  "totalCostMxn" > 0
-- Un caso «Pago por control» no tiene precio total (cada control se cobra aparte), así que el
-- importador de Dentalink y «Abrir caso» guardaban costo 0 y la base rechazaba la fila con
-- Postgres 23514. Por eso los casos «Pago por control» de BEVADENT no entraban.
--
-- Este SQL cambia la restricción a la regla correcta:
--   · "totalCostMxn" >= 0   → 0 = «sin total» (por control, o «lo armo después» al abrir el caso).
--     NO se exige > 0 según el modo: "billingMode" es una columna que puede no existir todavía
--     (sql/ortodoncia-modo-cobro.sql) y el alta ya admite abrir un caso sin costo en cualquier modo.
--   · "estimatedDurationMonths" BETWEEN 1 AND 120  → un tratamiento corto o uno largo no se rechaza.
--     (La pantalla sigue pidiendo 3..60; esto solo evita que la base sea más estricta que el producto.)
--
-- IDEMPOTENTE: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT; correrlo varias veces da el mismo resultado.
-- PLANO: sin bloques DO. NOT VALID: no recorre las filas existentes al crearla (todas ya cumplían la regla
-- anterior, que es más estricta); las filas nuevas y las que se editen SÍ se comprueban. El VALIDATE del
-- final la deja validada (solo lee, no bloquea escrituras).
--
-- El código NO depende de que esto esté pegado: mientras siga la restricción vieja, un caso «Pago por
-- control» sin total guarda un costo ESTIMADO > 0 (o $1 provisional si no hay ningún dato) y la duración
-- acotada a 3..60; la pantalla lo marca como estimado. Con este SQL pegado el estimado sigue siendo válido.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. La restricción, corregida ────────────────────────────────────────
ALTER TABLE "orthodontic_treatment_plans"
  DROP CONSTRAINT IF EXISTS "orthodontic_treatment_plans_duration_chk";

ALTER TABLE "orthodontic_treatment_plans"
  ADD CONSTRAINT "orthodontic_treatment_plans_duration_chk"
  CHECK ("estimatedDurationMonths" BETWEEN 1 AND 120 AND "totalCostMxn" >= 0) NOT VALID;

ALTER TABLE "orthodontic_treatment_plans"
  VALIDATE CONSTRAINT "orthodontic_treatment_plans_duration_chk";


-- ── 2. Comprobación (solo lee) ───────────────────────────────────────────
-- Debe salir UNA fila con «convalidated = true» y la definición nueva
-- (CHECK ((("estimatedDurationMonths" >= 1) AND ("estimatedDurationMonths" <= 120) AND ("totalCostMxn" >= (0)::numeric))).
SELECT conname, convalidated, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = '"orthodontic_treatment_plans"'::regclass
  AND conname = 'orthodontic_treatment_plans_duration_chk';
