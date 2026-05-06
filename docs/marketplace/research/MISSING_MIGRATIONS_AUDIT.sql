-- ═══════════════════════════════════════════════════════════════════════
-- MISSING MIGRATIONS AUDIT — Sprint Cierre Dental
-- ═══════════════════════════════════════════════════════════════════════
--
-- URGENTE: producción reportó que la tabla `endodontic_treatments` no
-- existe — la migración de Endodoncia nunca corrió pese a que el GO_LIVE
-- documentaba lo contrario. Este script verifica TODAS las tablas que
-- los 5 módulos dentales esperan + reporta cuáles faltan.
--
-- USO
-- Pega este script en Supabase SQL Editor (project producción). El último
-- SELECT devuelve un listado en la pestaña Results.
--
-- INTERPRETACIÓN
--   status = 'OK'      → la tabla existe en public, el módulo funciona
--   status = 'MISSING' → la tabla NO existe → la migración del módulo
--                        nunca se aplicó. Aplica el archivo correspondiente
--                        de la columna `migration_file`.
--
-- ARCHIVOS DE MIGRACIÓN APLICABLES (en este repo, listos para copy/paste):
--   prisma/migrations/20260430160000_pediatrics_module/migration.sql
--   prisma/migrations/20260504100000_endodontics_module/migration.sql
--   prisma/migrations/20260504160000_periodontics_module/migration.sql
--   prisma/migrations/20260504200000_implants_module/migration.sql
--   prisma/migrations/20260504210000_drop_implant_traceability_trigger/migration.sql
--   prisma/migrations/20260505000000_orthodontics_module/migration.fixed.sql  -- ⚠️ usa la FIXED, no la original
--   prisma/migrations/20260505100000_dental_cross_modules/migration.sql
-- ═══════════════════════════════════════════════════════════════════════


WITH expected_tables(module_name, table_name, migration_file) AS (
  VALUES
  -- ── Pediatría (módulo 1/5) ─────────────────────────────────────────
  ('pediatrics', 'pediatric_records',          '20260430160000_pediatrics_module'),
  ('pediatrics', 'ped_endodontic_treatments',  '20260430160000_pediatrics_module'),
  ('pediatrics', 'ped_behavior_assessments',   '20260430160000_pediatrics_module'),
  ('pediatrics', 'ped_caries_risk',            '20260430160000_pediatrics_module'),
  ('pediatrics', 'ped_consents',               '20260430160000_pediatrics_module'),
  ('pediatrics', 'ped_eruption_records',       '20260430160000_pediatrics_module'),
  ('pediatrics', 'ped_fluoride_applications',  '20260430160000_pediatrics_module'),
  ('pediatrics', 'ped_guardians',              '20260430160000_pediatrics_module'),
  ('pediatrics', 'ped_oral_habits',            '20260430160000_pediatrics_module'),
  ('pediatrics', 'ped_sealants',               '20260430160000_pediatrics_module'),
  ('pediatrics', 'ped_space_maintainers',      '20260430160000_pediatrics_module'),

  -- ── Endodoncia (módulo 2/5) ────────────────────────────────────────
  ('endodontics', 'endodontic_diagnoses',        '20260504100000_endodontics_module'),
  ('endodontics', 'vitality_tests',              '20260504100000_endodontics_module'),
  ('endodontics', 'endodontic_treatments',       '20260504100000_endodontics_module'),
  ('endodontics', 'root_canals',                 '20260504100000_endodontics_module'),
  ('endodontics', 'intracanal_medications',      '20260504100000_endodontics_module'),
  ('endodontics', 'endodontic_follow_ups',       '20260504100000_endodontics_module'),
  ('endodontics', 'endodontic_retreatment_info', '20260504100000_endodontics_module'),
  ('endodontics', 'apical_surgeries',            '20260504100000_endodontics_module'),

  -- ── Periodoncia (módulo 3/5) ───────────────────────────────────────
  ('periodontics', 'periodontal_records',          '20260504160000_periodontics_module'),
  ('periodontics', 'periodontal_classifications',  '20260504160000_periodontics_module'),
  ('periodontics', 'gingival_recessions',          '20260504160000_periodontics_module'),
  ('periodontics', 'periodontal_treatment_plans',  '20260504160000_periodontics_module'),
  ('periodontics', 'srp_sessions',                 '20260504160000_periodontics_module'),
  ('periodontics', 'periodontal_reevaluations',    '20260504160000_periodontics_module'),
  ('periodontics', 'periodontal_risk_assessments', '20260504160000_periodontics_module'),
  ('periodontics', 'periodontal_surgeries',        '20260504160000_periodontics_module'),
  ('periodontics', 'peri_implant_assessments',     '20260504160000_periodontics_module'),

  -- ── Implantología (módulo 4/5) ─────────────────────────────────────
  ('implants', 'implants',                         '20260504200000_implants_module'),
  ('implants', 'implant_surgical_records',         '20260504200000_implants_module'),
  ('implants', 'implant_healing_phases',           '20260504200000_implants_module'),
  ('implants', 'implant_second_stage_surgeries',   '20260504200000_implants_module'),
  ('implants', 'implant_prosthetic_phases',        '20260504200000_implants_module'),
  ('implants', 'implant_complications',            '20260504200000_implants_module'),
  ('implants', 'implant_follow_ups',               '20260504200000_implants_module'),
  ('implants', 'implant_consents',                 '20260504200000_implants_module'),
  ('implants', 'implant_passports',                '20260504200000_implants_module'),

  -- ── Ortodoncia (módulo 5/5) ────────────────────────────────────────
  ('orthodontics', 'orthodontic_diagnoses',             '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'orthodontic_treatment_plans',       '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'orthodontic_phases',                '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'ortho_payment_plans',               '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'ortho_installments',                '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'ortho_photo_sets',                  '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'orthodontic_control_appointments',  '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'orthodontic_digital_records',       '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'orthodontic_consents',              '20260505000000_orthodontics_module/migration.fixed.sql')
)
SELECT
  e.module_name,
  e.table_name,
  CASE WHEN t.tablename IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status,
  e.migration_file
FROM expected_tables e
LEFT JOIN pg_tables t
  ON t.schemaname = 'public' AND t.tablename = e.table_name
ORDER BY status DESC, e.module_name, e.table_name;


-- ─────────────────────────────────────────────────────────────────────
-- Summary view: módulos con tablas faltantes (más útil para triage)
-- ─────────────────────────────────────────────────────────────────────
WITH expected_tables(module_name, table_name, migration_file) AS (
  VALUES
  ('pediatrics',   'pediatric_records',          '20260430160000_pediatrics_module'),
  ('pediatrics',   'ped_endodontic_treatments',  '20260430160000_pediatrics_module'),
  ('pediatrics',   'ped_behavior_assessments',   '20260430160000_pediatrics_module'),
  ('pediatrics',   'ped_caries_risk',            '20260430160000_pediatrics_module'),
  ('pediatrics',   'ped_consents',               '20260430160000_pediatrics_module'),
  ('pediatrics',   'ped_eruption_records',       '20260430160000_pediatrics_module'),
  ('pediatrics',   'ped_fluoride_applications',  '20260430160000_pediatrics_module'),
  ('pediatrics',   'ped_guardians',              '20260430160000_pediatrics_module'),
  ('pediatrics',   'ped_oral_habits',            '20260430160000_pediatrics_module'),
  ('pediatrics',   'ped_sealants',               '20260430160000_pediatrics_module'),
  ('pediatrics',   'ped_space_maintainers',      '20260430160000_pediatrics_module'),
  ('endodontics',  'endodontic_diagnoses',        '20260504100000_endodontics_module'),
  ('endodontics',  'vitality_tests',              '20260504100000_endodontics_module'),
  ('endodontics',  'endodontic_treatments',       '20260504100000_endodontics_module'),
  ('endodontics',  'root_canals',                 '20260504100000_endodontics_module'),
  ('endodontics',  'intracanal_medications',      '20260504100000_endodontics_module'),
  ('endodontics',  'endodontic_follow_ups',       '20260504100000_endodontics_module'),
  ('endodontics',  'endodontic_retreatment_info', '20260504100000_endodontics_module'),
  ('endodontics',  'apical_surgeries',            '20260504100000_endodontics_module'),
  ('periodontics', 'periodontal_records',          '20260504160000_periodontics_module'),
  ('periodontics', 'periodontal_classifications',  '20260504160000_periodontics_module'),
  ('periodontics', 'gingival_recessions',          '20260504160000_periodontics_module'),
  ('periodontics', 'periodontal_treatment_plans',  '20260504160000_periodontics_module'),
  ('periodontics', 'srp_sessions',                 '20260504160000_periodontics_module'),
  ('periodontics', 'periodontal_reevaluations',    '20260504160000_periodontics_module'),
  ('periodontics', 'periodontal_risk_assessments', '20260504160000_periodontics_module'),
  ('periodontics', 'periodontal_surgeries',        '20260504160000_periodontics_module'),
  ('periodontics', 'peri_implant_assessments',     '20260504160000_periodontics_module'),
  ('implants',     'implants',                         '20260504200000_implants_module'),
  ('implants',     'implant_surgical_records',         '20260504200000_implants_module'),
  ('implants',     'implant_healing_phases',           '20260504200000_implants_module'),
  ('implants',     'implant_second_stage_surgeries',   '20260504200000_implants_module'),
  ('implants',     'implant_prosthetic_phases',        '20260504200000_implants_module'),
  ('implants',     'implant_complications',            '20260504200000_implants_module'),
  ('implants',     'implant_follow_ups',               '20260504200000_implants_module'),
  ('implants',     'implant_consents',                 '20260504200000_implants_module'),
  ('implants',     'implant_passports',                '20260504200000_implants_module'),
  ('orthodontics', 'orthodontic_diagnoses',             '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'orthodontic_treatment_plans',       '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'orthodontic_phases',                '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'ortho_payment_plans',               '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'ortho_installments',                '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'ortho_photo_sets',                  '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'orthodontic_control_appointments',  '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'orthodontic_digital_records',       '20260505000000_orthodontics_module/migration.fixed.sql'),
  ('orthodontics', 'orthodontic_consents',              '20260505000000_orthodontics_module/migration.fixed.sql')
)
SELECT
  e.module_name,
  count(*) FILTER (WHERE t.tablename IS NOT NULL) AS ok,
  count(*) FILTER (WHERE t.tablename IS NULL)     AS missing,
  count(*)                                         AS total,
  CASE
    WHEN count(*) FILTER (WHERE t.tablename IS NULL) = 0 THEN 'COMPLETE'
    WHEN count(*) FILTER (WHERE t.tablename IS NOT NULL) = 0 THEN 'NOT APPLIED'
    ELSE 'PARTIAL'
  END AS module_status,
  max(e.migration_file) AS migration_to_apply
FROM expected_tables e
LEFT JOIN pg_tables t
  ON t.schemaname = 'public' AND t.tablename = e.table_name
GROUP BY e.module_name
ORDER BY missing DESC, e.module_name;
