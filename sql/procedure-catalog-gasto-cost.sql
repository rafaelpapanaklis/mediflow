-- Gasto por procedimiento (WS1-T1, 2026-09-19).
-- Lo que a la clínica le cuesta hacer el procedimiento (materiales, laboratorio).
-- Nullable a propósito: NULL = «no lo hemos medido», 0 = «no cuesta nada».
-- SQL plano e idempotente. La columna "code" NO se toca: es la llave ODO_* del odontograma.
ALTER TABLE "procedure_catalog" ADD COLUMN IF NOT EXISTS "cost" DOUBLE PRECISION;
