-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T1 · PLAN DE TRATAMIENTO, FASE 2 (C): CITAS DEL PLAN (P8).
--
-- «Agendar lo pendiente» crea una cita NORMAL de la agenda y liga a ella los
-- procedimientos del plan que se eligieron. Esta liga es UNA columna nueva en
-- "treatment_plan_items" (sql/plan-tratamiento-filas.sql, que va ANTES):
--
--   "citaAgendadaId" — la cita en la que se AGENDÓ la fila. No es "citaId"
--   (esa es la cita en la que se HIZO, la escribe «marcar hecho»). Una cita
--   cancelada o no asistida libera la fila sin tocar esta columna: el código
--   mira el estado de la cita al leer (src/lib/treatments/citas-del-plan.ts).
--   Si la cita se borra, la liga queda en NULL (ON DELETE SET NULL).
--
-- Más «agendadaEn» / «agendadaPor»: cuándo y quién la agendó (rastro).
--
-- IDEMPOTENTE: todo con IF NOT EXISTS; correrlo dos veces no falla ni duplica.
-- ADITIVO: sin DROP, sin DELETE, sin UPDATE de datos.
-- NO usa Prisma Migrate ni toca prisma/schema.prisma: el código pregunta si la
-- columna existe (information_schema, guardado en globalThis) y, mientras no
-- exista, la agenda y el plan funcionan exactamente como hoy y el botón
-- «Agendar lo pendiente» no aparece.
--
-- Si "treatment_plan_items" todavía no existe (no se ha pegado
-- sql/plan-tratamiento-filas.sql), este archivo no hace nada y lo avisa con un
-- NOTICE: se vuelve a pegar después de aquél.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════

DO $tpc$
BEGIN
  IF to_regclass('public.treatment_plan_items') IS NULL THEN
    RAISE NOTICE 'treatment_plan_items no existe: pega primero sql/plan-tratamiento-filas.sql y luego este archivo';
    RETURN;
  END IF;

  -- Con IF NOT EXISTS la columna y su llave foránea nacen juntas la primera vez;
  -- la segunda vez Postgres salta la línea entera (sin DROP CONSTRAINT).
  EXECUTE 'ALTER TABLE "treatment_plan_items"
             ADD COLUMN IF NOT EXISTS "citaAgendadaId" TEXT
             REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  EXECUTE 'ALTER TABLE "treatment_plan_items" ADD COLUMN IF NOT EXISTS "agendadaEn" TIMESTAMP(3)';
  EXECUTE 'ALTER TABLE "treatment_plan_items" ADD COLUMN IF NOT EXISTS "agendadaPor" TEXT';

  -- La agenda pregunta «¿qué filas cuelgan de esta cita?» y el seguimiento
  -- «¿qué pendientes no tienen cita?»: los dos por clínica.
  EXECUTE 'CREATE INDEX IF NOT EXISTS "treatment_plan_items_citaAgendadaId_idx"
             ON "treatment_plan_items" ("citaAgendadaId") WHERE "citaAgendadaId" IS NOT NULL';
  EXECUTE 'CREATE INDEX IF NOT EXISTS "treatment_plan_items_clinicId_estado_idx"
             ON "treatment_plan_items" ("clinicId", "estado")';
END
$tpc$;


-- ── Comprobación (solo lee) ──────────────────────────────────────────────
-- Debe salir: 3 filas (citaAgendadaId text, agendadaEn timestamp, agendadaPor text).
-- 0 filas = "treatment_plan_items" no existía (ver el NOTICE de arriba).
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'treatment_plan_items'
  AND column_name IN ('citaAgendadaId', 'agendadaEn', 'agendadaPor')
ORDER BY column_name;
