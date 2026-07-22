-- ═══════════════════════════════════════════════════════════════════
-- Visibilidad por paciente — patients.visibleUserIds (feat/patient-visibility)
--
-- Al crear un paciente, el creador elige qué miembros del equipo pueden
-- verlo. Semántica de la columna (ver src/lib/patient-visibility.ts):
--   '{}'     = TODOS lo ven (comportamiento histórico, intacto).
--   NO vacío = lo ven SOLO esos userIds + CUALQUIER admin (ADMIN /
--              SUPER_ADMIN). Los admins NO se guardan en la lista.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS,
-- envueltos en un DO con guarda. Seguro de re-correr. Delimitador $pv$
-- (NUNCA $$ pelado — el editor de Supabase rompe el parser con $$).
--
-- Aplicar a mano en el SQL Editor de Supabase. NO prisma migrate.
--
-- ⚠️ ORDEN DE DESPLIEGUE — APLICAR **ANTES** DE ABRIR EL PREVIEW:
-- este SQL es seguro de correr con el código viejo vivo (ADD COLUMN NO
-- rompe lecturas previas). Pero si la columna NO existe cuando el Prisma
-- Client nuevo corre, CUALQUIER lectura de patients revienta (lista,
-- detalle, búsqueda, agenda) → outage del panel. Corriéndolo primero, la
-- ventana es CERO. Misma lección que sql/health-questionnaire.sql.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Columna. camelCase entre comillas: Prisma mapea el nombre del campo
--    tal cual (sin @map). NOT NULL + DEFAULT '{}' → las filas existentes
--    quedan en "todos lo ven", que es el comportamiento de hoy.
ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "visibleUserIds" TEXT[] NOT NULL DEFAULT '{}';

-- 2) Índice GIN. El filtro de visibilidad evalúa `has` (= array @> ARRAY[id])
--    en CADA lectura de patients de un usuario no-admin; sin índice es un
--    seq scan por clínica. GIN es el tipo correcto para contención en arrays.
--    (`isEmpty` = cardinality = 0 no usa este índice — no lo necesita: es un
--    filtro barato y la mayoría de las filas caen ahí.)
CREATE INDEX IF NOT EXISTS "patients_visibleUserIds_idx"
  ON "patients" USING GIN ("visibleUserIds");

-- 3) Verificación de que quedó aplicado (no falla si ya estaba).
DO $pv$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'visibleUserIds'
  ) THEN
    RAISE EXCEPTION 'patients."visibleUserIds" NO se creó — NO deployes: la lectura de patients reventaría';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'patients'
      AND indexname  = 'patients_visibleUserIds_idx'
  ) THEN
    RAISE NOTICE 'Índice GIN ausente — funciona igual, pero revisa el rendimiento en clínicas grandes';
  END IF;

  RAISE NOTICE 'patient-visibility: columna e índice OK';
END
$pv$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación manual:
--   SELECT column_name, data_type, column_default, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'patients' AND column_name = 'visibleUserIds';
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'patients' AND indexname = 'patients_visibleUserIds_idx';
--   -- Debe dar 0 al aplicar (nadie restringido todavía):
--   SELECT count(*) FROM "patients" WHERE cardinality("visibleUserIds") > 0;
--
-- Rollback (si hiciera falta revertir la rama):
--   DROP INDEX IF EXISTS "patients_visibleUserIds_idx";
--   ALTER TABLE "patients" DROP COLUMN IF EXISTS "visibleUserIds";
-- ═══════════════════════════════════════════════════════════════════
