-- Ortodoncia — precio por control de CADA caso (ws1-t12, ticket 3 de BEVADENT, 6b). PLANO, idempotente y aditivo.
--
-- Cada técnica de Configuración → «Técnicas y precios» ya puede tener «pago inicial» y «precio por control»
-- (viven en el JSON "techniqueList", que no necesita SQL). Esta columna guarda en el CASO el precio por control
-- de su técnica, copiado al abrirlo en «Pago por control»: cada control firmado se factura con él.
--   NULL = el caso no tiene precio propio → se cobra con «Control de ortodoncia» del catálogo, como hasta hoy.
-- Los casos que ya existen quedan en NULL: NO cambian. Las facturas ya hechas no se tocan.
--
-- El código funciona sin esta columna (SQL crudo con sonda a information_schema): sin ella, todos los
-- controles se cobran con el precio del catálogo.
--
-- No es tabla nueva: hereda la RLS que ya tenga "orthodontic_treatment_plans".
ALTER TABLE "orthodontic_treatment_plans" ADD COLUMN IF NOT EXISTS "controlPriceMxn" NUMERIC(10, 2);

ALTER TABLE "orthodontic_treatment_plans" DROP CONSTRAINT IF EXISTS "orthodontic_treatment_plans_control_price_chk";
ALTER TABLE "orthodontic_treatment_plans" ADD CONSTRAINT "orthodontic_treatment_plans_control_price_chk"
  CHECK ("controlPriceMxn" IS NULL OR ("controlPriceMxn" > 0 AND "controlPriceMxn" <= 10000000));

-- Comprobación (debe devolver una fila «controlPriceMxn | numeric»):
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'orthodontic_treatment_plans' AND column_name = 'controlPriceMxn';
