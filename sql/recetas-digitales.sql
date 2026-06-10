-- ═══════════════════════════════════════════════════════════════════
-- Recetas digitales (WS1-T2, 2026-06-10)
-- Idempotente: se puede correr más de una vez sin efectos secundarios.
--
-- Único cambio de schema: diagnóstico opcional en la receta.
-- (El resto del feature reutiliza prescriptions / prescription_items /
--  cums_items que ya existen en producción.)
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS diagnosis TEXT;
