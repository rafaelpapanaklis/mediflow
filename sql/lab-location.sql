-- Ubicación para el módulo de laboratorios dentales.
-- Link de Google Maps de la clínica y del laboratorio, para que el mensajero
-- (recolección/entrega) y la ficha del lab puedan abrir la ubicación directa.
-- Ambas tablas YA tienen "address"; aquí solo se agrega "mapsUrl".
-- Idempotente: si la columna ya existe, no falla.

ALTER TABLE "clinics"     ADD COLUMN IF NOT EXISTS "mapsUrl" TEXT;
ALTER TABLE "dental_labs" ADD COLUMN IF NOT EXISTS "mapsUrl" TEXT;
