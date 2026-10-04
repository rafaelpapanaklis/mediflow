-- ws1-t4 · vuelta 2 · F-11 y F-08 — clave SAT e IVA del CFDI por procedimiento.
--
-- POR QUÉ: todo concepto se timbraba como 85121502 («Servicios de consulta de
-- médicos de atención primaria») y con un solo IVA para toda la factura. Cada
-- procedimiento del catálogo puede llevar ahora:
--   · "claveSat": su clave del catálogo c_ClaveProdServ del SAT (8 dígitos).
--     Vacía = la de su categoría: ortodoncia 85122005, cirugía/implantes
--     85122004, lo demás 85122001 (85122002 de higienista solo si la clínica
--     la elige a mano).
--   · "ivaCfdi": 'exento' | 'iva16'. Vacío = el IVA de la factura (lo de hoy).
--
-- Se leen y escriben por SQL crudo (no están en prisma/schema.prisma a
-- propósito). Sin este SQL el timbrado usa la clave por defecto de la
-- categoría y el IVA de la factura, y el formulario avisa que no se guardó.
--
-- Idempotente. Sin DROP ni UPDATE: ninguna fila cambia al pegarlo.

ALTER TABLE "procedure_catalog" ADD COLUMN IF NOT EXISTS "claveSat" VARCHAR(8);
ALTER TABLE "procedure_catalog" ADD COLUMN IF NOT EXISTS "ivaCfdi" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procedure_catalog_claveSat_8_digitos') THEN
    ALTER TABLE "procedure_catalog"
      ADD CONSTRAINT "procedure_catalog_claveSat_8_digitos"
      CHECK ("claveSat" IS NULL OR "claveSat" ~ '^[0-9]{8}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procedure_catalog_ivaCfdi_valores') THEN
    ALTER TABLE "procedure_catalog"
      ADD CONSTRAINT "procedure_catalog_ivaCfdi_valores"
      CHECK ("ivaCfdi" IS NULL OR "ivaCfdi" IN ('exento', 'iva16'));
  END IF;
END $$;
