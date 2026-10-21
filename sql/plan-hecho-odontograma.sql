-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T5 · PLAN DE TRATAMIENTO, FASE 2 (B):
-- «HECHO» → ODONTOGRAMA, CON DESHACER.
--
-- Una columna nueva en "treatment_plan_items" (la tabla de sql/plan-tratamiento-filas.sql):
--   "odontogramaHecho" JSONB — lo que el último «hecho» de esa fila escribió en el
--   odontograma: las marcas que puso (con su id), las que quitó (con su nota) y el
--   estado al que vuelve la fila con «Deshacer». Sirve para dos cosas:
--     1) que «Deshacer» devuelva el odontograma EXACTO sin pisar lo que se cambió después;
--     2) que «Completar consulta» NO vuelva a proponer cobrar («Tratamientos detectados»)
--        lo que ya cobra la nota del plan.
--
-- ⚠️ ORDEN: pégalo DESPUÉS de sql/plan-tratamiento-filas.sql. Si la tabla aún no existe,
--   este archivo no hace nada (avisa con un NOTICE) y hay que volver a pegarlo después.
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS; correrlo dos veces no falla ni duplica.
-- ADITIVO: sin DROP, sin DELETE, sin UPDATE de datos.
-- NO usa Prisma Migrate ni toca prisma/schema.prisma: el código pregunta antes si la columna
-- existe (information_schema, src/lib/treatments/aplicar-hecho-db.ts). Sin ella, «hecho» marca
-- la fila y NO toca el odontograma.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════

DO $hecho$
BEGIN
  IF to_regclass('public.treatment_plan_items') IS NULL THEN
    RAISE NOTICE 'treatment_plan_items no existe: pega antes sql/plan-tratamiento-filas.sql y vuelve a pegar este';
  ELSE
    EXECUTE 'ALTER TABLE "treatment_plan_items" ADD COLUMN IF NOT EXISTS "odontogramaHecho" JSONB';
  END IF;
END
$hecho$;


-- ── Comprobación (solo lee) ──────────────────────────────────────────────
-- Debe salir 1 fila: treatment_plan_items | odontogramaHecho | jsonb | YES
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'treatment_plan_items' AND column_name = 'odontogramaHecho';
