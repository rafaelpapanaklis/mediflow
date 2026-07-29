-- CFDI · Live — IVA por clínica + Live Secret Key de la organización
--
-- "cfdiTaxMode"      con qué impuestos se pre-llena el timbrado de la clínica:
--                    "exempt" (servicios médicos/dentales exentos, art. 15 LIVA)
--                    | "iva16". El modal de timbrado lo sobreescribe por factura.
-- "facturApiLiveKey" Live Secret Key de su organización en Facturapi. Hay que
--                    guardarla porque la API solo la devuelve completa al
--                    crearla (PUT /apikeys/live); el GET lista metadatos
--                    (first_12), nunca la llave usable. Cifrada con el envelope
--                    AES-256-GCM si DATA_ENCRYPTION_KEY está configurada.
--
-- Aditivo y no destructivo (IF NOT EXISTS). Aplicar en Supabase → SQL Editor.
--
-- Nombres de columna en camelCase citado porque el modelo Prisma Clinic no usa
-- @map en estos campos (igual que "facturApiEnabled").

ALTER TABLE "clinics"
  ADD COLUMN IF NOT EXISTS "cfdiTaxMode"      TEXT NOT NULL DEFAULT 'exempt',
  ADD COLUMN IF NOT EXISTS "facturApiLiveKey" TEXT;
