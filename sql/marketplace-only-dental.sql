-- ═══════════════════════════════════════════════════════════════════
-- Marketplace · Filtrar catálogo a solo módulos dentales
--
-- CONTEXTO
-- En Sprint 1 sembramos 12 módulos (6 dentales + 6 multi-especialidad)
-- pensando en multi-tipo desde el día 1. Decisión de Rafael (2026-04-30):
-- por ahora solo módulos dentales en producción. Los 6 no-dentales se
-- conservan en `modules` para reactivar cuando se lancen las otras
-- especialidades, pero quedan ocultos del marketplace.
--
-- El filtrado del catálogo en /dashboard/marketplace ya respeta
-- `is_active = true` (ver src/app/dashboard/marketplace/page.tsx:13),
-- así que setear `is_active=false` en los no-dentales los oculta sin
-- requerir cambios de código.
--
-- IDEMPOTENTE: re-correr este script no hace nada extra. Si vuelven los
-- no-dentales en el futuro, basta con un UPDATE inverso (incluido al
-- final, comentado).
-- ═══════════════════════════════════════════════════════════════════

UPDATE "modules"
SET    "is_active" = false
WHERE  "category"  != 'Dental'
  AND  "is_active" = true;

-- Verificación post-aplicación (opcional):
--   SELECT key, name, category, is_active FROM modules ORDER BY sort_order;
--   SELECT COUNT(*) FROM modules WHERE is_active = true;   -- esperar 6
--   SELECT COUNT(*) FROM modules WHERE is_active = false;  -- esperar 6

-- ── REACTIVAR (para el futuro) ─────────────────────────────────────
-- Cuando MediFlow lance las otras especialidades, descomenta la query
-- de abajo. Idempotente igual.
--
-- UPDATE "modules"
-- SET    "is_active" = true
-- WHERE  "category"  != 'Dental'
--   AND  "is_active" = false;
