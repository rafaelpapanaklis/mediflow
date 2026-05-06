-- ═══════════════════════════════════════════════════════════════════
-- Periodontics — extensión de ClinicalPhotoType
--
-- El enum base (creado por 20260505140000_clinical_shared_modules)
-- incluye 3 valores perio: 'perio_initial', 'perio_postsrp', 'perio_surgery'.
--
-- Periodoncia necesita granularidad adicional para capturar:
--   - Estado pre-SRP (distinto de "initial" del expediente).
--   - Pre vs post quirúrgico explícito (en lugar de un único 'perio_surgery').
--   - Retiro de suturas (control 7-14 días post-cirugía).
--   - Foto de mantenimiento (cada recall 3/6 meses).
--   - Baseline de recesión gingival (clasificación Cairo).
--
-- ALTER TYPE ADD VALUE IF NOT EXISTS es idempotente desde PG 9.6.
-- No requiere transacción separada porque solo añade valores nuevos.
-- ═══════════════════════════════════════════════════════════════════

ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'perio_pre_srp';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'perio_pre_surgery';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'perio_post_surgery';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'perio_suture_removal';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'perio_maintenance_check';
ALTER TYPE "ClinicalPhotoType" ADD VALUE IF NOT EXISTS 'perio_recession_baseline';
