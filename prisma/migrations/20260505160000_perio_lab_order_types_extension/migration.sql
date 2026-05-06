-- ═══════════════════════════════════════════════════════════════════
-- Periodontics — extensión de LabOrderType
--
-- El enum base (creado por 20260505140000_clinical_shared_modules) no
-- incluye tipos perio. Se añaden 3 valores específicos:
--
--   perio_splint           — ferulización periodontal (alambre + composite)
--   perio_custom_graft     — injerto personalizado (alograft/xenograft moldeado)
--   perio_maintenance_tray — planchas de mantenimiento (gel fluoruro/clorhexidina)
--
-- ALTER TYPE ADD VALUE IF NOT EXISTS es idempotente desde PG 9.6.
-- ═══════════════════════════════════════════════════════════════════

ALTER TYPE "LabOrderType" ADD VALUE IF NOT EXISTS 'perio_splint';
ALTER TYPE "LabOrderType" ADD VALUE IF NOT EXISTS 'perio_custom_graft';
ALTER TYPE "LabOrderType" ADD VALUE IF NOT EXISTS 'perio_maintenance_tray';
