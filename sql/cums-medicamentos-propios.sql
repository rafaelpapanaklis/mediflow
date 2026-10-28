-- ═══════════════════════════════════════════════════════════════════
-- Recetas · «Agregar medicamento que no está» (ws1-t10, 28-oct-2026)
-- Idempotente: se puede pegar más de una vez.
--
-- La lista PROPIA de cada clínica vive en la misma tabla `cums_items`:
--   clinicId NULL  → catálogo global (CUMS / seed), como hasta hoy
--   clinicId = X   → medicamento que la clínica X agregó a mano
-- Así `prescription_items.cumsKey` (FK obligatoria a cums_items.clave) y
-- todo lo que lee de ahí (receta, PDF, firma, QR público, CDA, portal del
-- paciente, Sabina) siguen funcionando sin cambios.
--
-- Sin pegar este SQL todo sigue como hoy: el código pregunta a
-- information_schema si existe la columna y, mientras no, ni consulta por
-- ella ni enseña el botón de agregar.
--
-- No se añade FK de clinicId → clinics a propósito: con ON DELETE SET NULL
-- una fila propia pasaría a ser global al borrar la clínica, y con CASCADE
-- chocaría con la FK RESTRICT de prescription_items. La fila huérfana no
-- sale en ninguna búsqueda (siempre se filtra por la clínica de la sesión).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "cums_items" ADD COLUMN IF NOT EXISTS "clinicId"  TEXT;
ALTER TABLE "cums_items" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "cums_items" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "cums_items_clinicId_idx" ON "cums_items" ("clinicId");
