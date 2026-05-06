-- ═══════════════════════════════════════════════════════════════════
-- Periodontics — extensión de ClinicalReminderType para mantenimiento
--
-- El enum base solo incluye perio_maintenance_3m. Berna (Lang & Tonetti)
-- recomienda recall por categoría de riesgo:
--   ALTO     → 3 meses (perio_maintenance_3m, ya existe)
--   MODERADO → 4 meses (perio_maintenance_4m, NUEVO)
--   BAJO     → 6 meses (perio_maintenance_6m, NUEVO)
--
-- ALTER TYPE ADD VALUE IF NOT EXISTS es idempotente desde PG 9.6.
-- ═══════════════════════════════════════════════════════════════════

ALTER TYPE "ClinicalReminderType" ADD VALUE IF NOT EXISTS 'perio_maintenance_4m';
ALTER TYPE "ClinicalReminderType" ADD VALUE IF NOT EXISTS 'perio_maintenance_6m';
