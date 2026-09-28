-- Ortodoncia — el responsable de pago (tutor) con datos fiscales (ws1-t10, punto 9).
-- Un menor no factura: la factura del caso sale a nombre de su tutor. Estas
-- columnas guardan el RFC, la razón social, el régimen y el CP del tutor para
-- precargar el CFDI. PLANO, idempotente y aditivo (sin bloques DO). Las cuatro
-- son opcionales: el código funciona sin ellas (lee y escribe por SQL con una
-- sonda de columna) y solo deja de precargar los datos del tutor hasta que existan.
ALTER TABLE "ped_guardians" ADD COLUMN IF NOT EXISTS "rfcFiscal" VARCHAR(13);
ALTER TABLE "ped_guardians" ADD COLUMN IF NOT EXISTS "razonSocialFiscal" TEXT;
ALTER TABLE "ped_guardians" ADD COLUMN IF NOT EXISTS "regimenFiscal" VARCHAR(10);
ALTER TABLE "ped_guardians" ADD COLUMN IF NOT EXISTS "cpFiscal" VARCHAR(5);
