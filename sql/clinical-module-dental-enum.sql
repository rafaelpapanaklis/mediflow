-- ═══════════════════════════════════════════════════════════════════════════
-- ClinicalModule += 'dental'   ·   WS1-T2 · plantillas de nota para dental
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️  ESTE ARCHIVO SE CORRE SOLO, EN SU PROPIO «Run», Y ANTES QUE NADA.
--
-- Postgres NO deja USAR un valor de enum en la misma transacción en la que se
-- añade («unsafe use of new value of enum type»), y el editor SQL de Supabase
-- envuelve cada Run en una transacción. Si pegas esto junto con cualquier otra
-- sentencia que use 'dental' (un INSERT en clinical_evolution_templates, un
-- SELECT … WHERE module = 'dental'), falla. Por eso aquí hay UNA sola
-- sentencia y no se le añade nada más: ni sembrados ni comprobaciones.
--
-- Es la misma familia de trampa que CREATE INDEX CONCURRENTLY: va aparte.
--
-- Es idempotente (IF NOT EXISTS): correrlo dos veces no hace nada.
-- No tiene vuelta atrás sencilla (Postgres no tiene DROP VALUE), pero un valor
-- de enum sin usar es inofensivo.
--
-- Qué pasa si el código se integra ANTES de correr esto: la ficha dental sigue
-- funcionando igual que hoy, solo que sin el botón «Plantillas» (el sembrado
-- falla, se registra en el log del servidor y el selector no se monta).
-- No hace falta sembrar nada a mano: las 8 plantillas de cada clínica se crean
-- solas la primera vez que alguien abre «Nueva consulta».

ALTER TYPE "ClinicalModule" ADD VALUE IF NOT EXISTS 'dental';

-- Comprobación — en OTRO Run, después de que el de arriba haya terminado:
--   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--   WHERE t.typname = 'ClinicalModule' ORDER BY e.enumsortorder;
