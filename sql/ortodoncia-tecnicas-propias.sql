-- Ortodoncia — técnicas PROPIAS de cada clínica (ws1-t10). PLANO, idempotente y aditivo (sin bloques DO).
-- 1) La lista de técnicas de la clínica (JSONB nullable): [{ "id", "nombre", "base", "precio", "activa" }, ...].
--    NULL = la clínica aún no la editó: se ofrecen las 7 de siempre con lo que haya en "techniquePrices".
-- 2) El nombre propio de cada caso (p. ej. «Brackets de zafiro»). El tipo base sigue en "technique" (enum).
--    NULL = se muestra el nombre del tipo base.
-- El código funciona sin estas columnas (SQL crudo con sonda): sin la 1.ª, Configuración avisa que falta
-- pegar el SQL; sin la 2.ª, los casos muestran el nombre de su tipo base.
ALTER TABLE "orthodontics_clinic_settings" ADD COLUMN IF NOT EXISTS "techniqueList" JSONB;
ALTER TABLE "orthodontic_treatment_plans" ADD COLUMN IF NOT EXISTS "techniqueLabel" TEXT;
