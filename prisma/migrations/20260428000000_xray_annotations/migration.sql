-- Anotaciones del visor de radiografías (regla, ángulo, lápiz).
-- Array JSONB de { id, type, points: [{x,y}], label?, color? } con coords 0..1
-- relativas al rect natural de la imagen.

ALTER TABLE "patient_files"
  ADD COLUMN IF NOT EXISTS "annotations" JSONB;
