-- Ortodoncia — precio por TÉCNICA (ws1-t10, decisión 2 de Rafael). La clínica define
-- cuánto cuesta un tratamiento con brackets metálicos, estéticos, autoligado,
-- alineadores… en Configuración de Ortodoncia, y el alta del caso propone ese
-- precio al elegir la técnica (editable por paciente). PLANO, idempotente y
-- aditivo (sin bloques DO). Una columna JSONB nullable: { "METAL_BRACKETS": 25000, ... }.
-- El código funciona sin ella (lee/escribe por SQL con una sonda de columna): sin
-- esta columna la tarjeta de Configuración avisa que falta pegar el SQL.
ALTER TABLE "orthodontics_clinic_settings" ADD COLUMN IF NOT EXISTS "techniquePrices" JSONB;
