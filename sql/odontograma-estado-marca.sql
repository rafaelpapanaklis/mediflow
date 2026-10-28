-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T6 · ODONTOGRAMA: ROJO = POR HACER, AZUL = REALIZADO.
--
-- Una columna nueva en "odontogram_entries" (la tabla de sql/odontogram-v2.sql):
--   "estado" TEXT, NULL por defecto — el estado de una marca de PROCEDIMIENTO:
--     'por_hacer' → se pinta en ROJO y sale en el plan nuevo con el precio de la clínica;
--     'hecho'     → se pinta en AZUL (realizado; no quiere decir pagado);
--     'previo'    → AZUL con la nota «previo»: el paciente lo trae hecho de otra clínica.
--   NULL = lo que ya estaba guardado antes de esto: se lee y se pinta COMO HOY
--   (color de la especialidad). Este archivo NO reescribe ni borra ninguna fila.
-- Y una segunda columna (v6):
--   "estadoDesde" TIMESTAMP(3), NULL por defecto — desde cuándo la marca tiene su estado (para una
--   ROJA: cuándo pasó a «por hacer»). «Nuevo plan» la usa para no tapar el «rehacer» de un trabajo
--   viejo. La escribe el código al cambiar el estado; lo de antes queda NULL.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS y la restricción solo si falta; correrlo dos veces no
--   falla ni duplica.
-- ADITIVO: sin DROP, sin DELETE, sin UPDATE de datos.
-- NO usa Prisma Migrate ni toca prisma/schema.prisma: el código pregunta antes si la columna
-- existe (information_schema, src/lib/odontogram/estado-db.ts). Sin ella, el odontograma
-- funciona como hoy y no enseña el selector «Por hacer / Realizado».
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "odontogram_entries" ADD COLUMN IF NOT EXISTS "estado" TEXT;
ALTER TABLE "odontogram_entries" ADD COLUMN IF NOT EXISTS "estadoDesde" TIMESTAMP(3);

DO $estado$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'odontogram_entries_estado_check'
       AND conrelid = 'public.odontogram_entries'::regclass
  ) THEN
    -- NOT VALID: no recorre la tabla con el candado fuerte; la validación va abajo, aparte.
    ALTER TABLE "odontogram_entries"
      ADD CONSTRAINT "odontogram_entries_estado_check"
      CHECK ("estado" IS NULL OR "estado" IN ('por_hacer', 'hecho', 'previo')) NOT VALID;
  END IF;
END
$estado$;

-- Valida lo que ya hay (todo NULL: la columna es nueva) con un candado que no frena lecturas ni
-- escrituras. Repetirlo no falla. Si quieres el candado corto de verdad, pega esta línea sola
-- después del resto: el SQL Editor corre el archivo entero en UNA transacción.
ALTER TABLE "odontogram_entries" VALIDATE CONSTRAINT "odontogram_entries_estado_check";


-- ── Comprobación (solo lee) ──────────────────────────────────────────────
-- Deben salir 2 filas: odontogram_entries | estado | text | YES  y  … | estadoDesde | timestamp without time zone | YES
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'odontogram_entries' AND column_name IN ('estado', 'estadoDesde')
ORDER BY column_name;
