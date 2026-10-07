-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — ws1-t3 · «SE AGENDA POR WHATSAPP» en el catálogo.
--
-- La clínica elige qué procedimientos ofrece el bot al agendar. Si no marca
-- ninguno, el bot ofrece el menú corto de fábrica (Consulta o valoración ·
-- Limpieza · Urgencia o dolor · Control de ortodoncia · Otro tratamiento).
--
-- Contenido: UNA columna nueva en "procedure_catalog":
--   "botBookable" BOOLEAN NOT NULL DEFAULT false
-- Postgres la llena con false en las filas que ya existen. Sin UPDATE, sin
-- backfill: ninguna clínica cambia de comportamiento hasta que marque algo.
--
-- No se declara en prisma/schema.prisma a propósito (procedure_catalog se lee
-- sin `select` en media app; con la columna declarada y el SQL sin pegar
-- tiraría P2022). El código la lee y escribe por SQL crudo con su sonda y,
-- mientras esto no se pegue, usa el menú de fábrica sin errores.
--
-- ORDEN: da igual. RLS: la tabla ya la tiene; una columna nueva la hereda.
-- IDEMPOTENTE: correrlo varias veces no da errores ni cambia nada. CERO DROP.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.procedure_catalog
  ADD COLUMN IF NOT EXISTS "botBookable" BOOLEAN NOT NULL DEFAULT false;

-- Comprobación 1 (solo lee): boolean, NOT NULL, DEFAULT false.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'procedure_catalog'
  AND column_name = 'botBookable';

-- Comprobación 2 (solo lee): RLS encendido. Debe salir rls = true.
SELECT relrowsecurity AS rls FROM pg_class
WHERE relname = 'procedure_catalog' AND relnamespace = 'public'::regnamespace;

-- Comprobación 3 (solo lee): nadie quedó marcado. Debe salir 0.
SELECT count(*) FILTER (WHERE "botBookable") AS marcados FROM public.procedure_catalog;
