-- ═══════════════════════════════════════════════════════════════════════
-- Pre go-live backup — Sprint Cierre Dental
-- ═══════════════════════════════════════════════════════════════════════
--
-- Para clínicas en plan Free de Supabase (sin backups automáticos), corre
-- este script en el SQL Editor inmediatamente antes de iniciar el go-live.
--
-- Crea un schema `backup_pre_godo_20260505` con copia 1:1 de TODAS las
-- tablas de `public` mediante `CREATE TABLE … AS SELECT`. Solo copia datos
-- (ni constraints, ni indexes, ni FKs, ni triggers) — el objetivo es
-- recuperar filas por si una migración o seed daña producción.
--
-- IDEMPOTENTE: el primer paso hace `DROP SCHEMA IF EXISTS … CASCADE`. Si ya
-- corriste el script y necesitas re-correrlo, lo hace limpio.
--
-- COSTO en Supabase Free: el backup ocupa ~ el mismo espacio que las tablas
-- originales. Si tu BD tiene N MB usados, espera ~2N tras el backup.
--
-- TIEMPO estimado: 30 s – 5 min según volumen. La mayor parte del costo es
-- en `audit_logs`, `whatsapp_reminders`, `appointments` y `xray_analyses`.
--
-- ROLLBACK desde el backup (si algo sale mal):
--   TRUNCATE public.<tabla> CASCADE;  -- ojo con FKs
--   INSERT INTO public.<tabla> SELECT * FROM backup_pre_godo_20260505.<tabla>;
--
-- TABLAS BACKED UP (esperadas, ~107):
--   Core             clinics, users, patients, clinic_schedules, clinic_layouts
--   Scheduling       appointments, appointment_timelines, no_show_predictions,
--                    reminders, walk_in_queue, "Resource", "WaitlistEntry",
--                    resource_bookings, resource_costs
--   Clinical         medical_records, medical_record_diagnoses, cie10_codes,
--                    cie9_codes, treatment_plans, treatment_sessions,
--                    prescriptions, prescription_items, body_map_annotations,
--                    formula_records, procedure_catalog
--   Radiografías     patient_files, xray_analyses, odontogram_entries,
--                    odontogram_snapshots, before_after_photos
--   Billing          invoices, payments, payment_plans, plan_payments,
--                    cfdi_records, cums_items
--   Marketplace      modules, clinic_modules, module_usage_logs,
--                    subscription_invoices, orders, carts, coupons,
--                    service_packages, package_redemptions
--   Inventario       inventory_items, inventory_history
--   Comunicación     whatsapp_reminders, inbox_messages, inbox_threads,
--                    consent_forms, signed_documents, doctor_signature_certs
--   Legal            referrals, arco_requests
--   Operaciones      audit_logs, weekly_insights, patient_satisfactions,
--                    tv_displays, bug_audit_runs, bug_audit_dismissed,
--                    admin_announcements, admin_clinic_notes
--   Pediatría (1/5)  pediatric_records, ped_endodontic_treatments,
--                    ped_behavior_assessments, ped_caries_risk, ped_consents,
--                    ped_eruption_records, ped_fluoride_applications,
--                    ped_guardians, ped_oral_habits, ped_sealants,
--                    ped_space_maintainers
--   Endodoncia (2/5) endodontic_diagnoses, vitality_tests,
--                    endodontic_treatments, root_canals,
--                    intracanal_medications, endodontic_follow_ups,
--                    endodontic_retreatment_info, apical_surgeries
--   Periodoncia (3/5) periodontal_records, periodontal_classifications,
--                    gingival_recessions, periodontal_treatment_plans,
--                    srp_sessions, periodontal_reevaluations,
--                    periodontal_risk_assessments, periodontal_surgeries,
--                    peri_implant_assessments
--   Implantes (4/5)  implants, implant_surgical_records,
--                    implant_healing_phases, implant_second_stage_surgeries,
--                    implant_prosthetic_phases, implant_complications,
--                    implant_follow_ups, implant_consents, implant_passports
--   Ortodoncia (5/5) orthodontic_diagnoses, orthodontic_treatment_plans,
--                    orthodontic_phases, ortho_payment_plans,
--                    ortho_installments, ortho_photo_sets,
--                    orthodontic_control_appointments,
--                    orthodontic_digital_records, orthodontic_consents
--
-- El loop dinámico de §2 captura TODAS las tablas existentes en public, así
-- que si Postgres tiene tablas extra (futuras o legacy) también se respaldan.
-- ═══════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- 1. Reset del schema de backup
-- ─────────────────────────────────────────────────────────────────────
DROP SCHEMA IF EXISTS backup_pre_godo_20260505 CASCADE;
CREATE SCHEMA backup_pre_godo_20260505;

COMMENT ON SCHEMA backup_pre_godo_20260505 IS
  'Backup pre go-live Sprint Dental. Generado por scripts/pre-go-live-backup.sql el 2026-05-05. Borrar tras 30 días de operación estable.';


-- ─────────────────────────────────────────────────────────────────────
-- 2. Copia 1:1 de todas las tablas de public.
--    Loop dinámico para tolerar tablas que aún no existen (por ejemplo,
--    si esta BD aún no tiene aplicada alguna migración) y para incluir
--    tablas extra que el listado del header no contemple.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  rec RECORD;
  copied INT := 0;
BEGIN
  FOR rec IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  LOOP
    EXECUTE format(
      'CREATE TABLE backup_pre_godo_20260505.%I AS SELECT * FROM public.%I',
      rec.tablename, rec.tablename
    );
    copied := copied + 1;
  END LOOP;
  RAISE NOTICE 'Tablas respaldadas: %', copied;
END $$;


-- ─────────────────────────────────────────────────────────────────────
-- 3. Sanity check — todas las tablas esperadas están en el backup.
--    El listado de abajo se debe mantener sincronizado con prisma/schema.prisma.
--    Si una tabla esperada no se respaldó (porque no existe en public en
--    esta BD), se emite WARNING — el operador decide si proceder.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  expected TEXT[] := ARRAY[
    -- Core
    'clinics', 'users', 'patients', 'clinic_schedules', 'clinic_layouts',
    -- Scheduling
    'appointments', 'appointment_timelines', 'no_show_predictions',
    'reminders', 'walk_in_queue', 'Resource', 'WaitlistEntry',
    'resource_bookings', 'resource_costs',
    -- Clinical
    'medical_records', 'medical_record_diagnoses', 'cie10_codes', 'cie9_codes',
    'treatment_plans', 'treatment_sessions', 'prescriptions',
    'prescription_items', 'body_map_annotations', 'formula_records',
    'procedure_catalog',
    -- Radiografías + odontograma
    'patient_files', 'xray_analyses', 'odontogram_entries',
    'odontogram_snapshots', 'before_after_photos',
    -- Billing
    'invoices', 'payments', 'payment_plans', 'plan_payments',
    'cfdi_records', 'cums_items',
    -- Marketplace
    'modules', 'clinic_modules', 'module_usage_logs',
    'subscription_invoices', 'orders', 'carts', 'coupons',
    'service_packages', 'package_redemptions',
    -- Inventario
    'inventory_items', 'inventory_history',
    -- Comunicación
    'whatsapp_reminders', 'inbox_messages', 'inbox_threads',
    'consent_forms', 'signed_documents', 'doctor_signature_certs',
    -- Legal
    'referrals', 'arco_requests',
    -- Operaciones
    'audit_logs', 'weekly_insights', 'patient_satisfactions', 'tv_displays',
    'bug_audit_runs', 'bug_audit_dismissed', 'admin_announcements',
    'admin_clinic_notes',
    -- Pediatría
    'pediatric_records', 'ped_endodontic_treatments',
    'ped_behavior_assessments', 'ped_caries_risk', 'ped_consents',
    'ped_eruption_records', 'ped_fluoride_applications', 'ped_guardians',
    'ped_oral_habits', 'ped_sealants', 'ped_space_maintainers',
    -- Endodoncia
    'endodontic_diagnoses', 'vitality_tests', 'endodontic_treatments',
    'root_canals', 'intracanal_medications', 'endodontic_follow_ups',
    'endodontic_retreatment_info', 'apical_surgeries',
    -- Periodoncia
    'periodontal_records', 'periodontal_classifications', 'gingival_recessions',
    'periodontal_treatment_plans', 'srp_sessions', 'periodontal_reevaluations',
    'periodontal_risk_assessments', 'periodontal_surgeries',
    'peri_implant_assessments',
    -- Implantes
    'implants', 'implant_surgical_records', 'implant_healing_phases',
    'implant_second_stage_surgeries', 'implant_prosthetic_phases',
    'implant_complications', 'implant_follow_ups', 'implant_consents',
    'implant_passports',
    -- Ortodoncia
    'orthodontic_diagnoses', 'orthodontic_treatment_plans', 'orthodontic_phases',
    'ortho_payment_plans', 'ortho_installments', 'ortho_photo_sets',
    'orthodontic_control_appointments', 'orthodontic_digital_records',
    'orthodontic_consents'
  ];
  t TEXT;
  missing INT := 0;
BEGIN
  FOREACH t IN ARRAY expected LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'backup_pre_godo_20260505' AND tablename = t
    ) THEN
      missing := missing + 1;
      RAISE WARNING 'Tabla esperada no respaldada (no existía en public): %', t;
    END IF;
  END LOOP;
  IF missing = 0 THEN
    RAISE NOTICE 'OK — las % tabla(s) esperadas del listado fueron respaldadas.', array_length(expected, 1);
  ELSE
    RAISE WARNING 'Faltan % tabla(s) esperadas. Confirma que es porque migraciones específicas no están aplicadas — si NO es ese caso, NO procedas con el go-live.', missing;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────
-- 4. Verificación de row_count: backup vs public por cada tabla copiada.
--    Aborta con EXCEPTION si encuentra cualquier mismatch.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  rec RECORD;
  pub_count BIGINT;
  bak_count BIGINT;
  mismatches INT := 0;
  total_tables INT := 0;
  total_rows BIGINT := 0;
BEGIN
  RAISE NOTICE '────────────────────────────────────────────────────────────────';
  RAISE NOTICE '%-50s | %10s | %10s | %s', 'TABLA', 'PUBLIC', 'BACKUP', 'STATUS';
  RAISE NOTICE '────────────────────────────────────────────────────────────────';
  FOR rec IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'backup_pre_godo_20260505'
    ORDER BY tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I',                   rec.tablename) INTO pub_count;
    EXECUTE format('SELECT count(*) FROM backup_pre_godo_20260505.%I', rec.tablename) INTO bak_count;
    total_tables := total_tables + 1;
    total_rows := total_rows + bak_count;
    IF pub_count = bak_count THEN
      RAISE NOTICE '%-50s | %10s | %10s | OK', rec.tablename, pub_count, bak_count;
    ELSE
      mismatches := mismatches + 1;
      RAISE WARNING '%-50s | %10s | %10s | MISMATCH', rec.tablename, pub_count, bak_count;
    END IF;
  END LOOP;
  RAISE NOTICE '────────────────────────────────────────────────────────────────';
  RAISE NOTICE 'Total: % tabla(s), % filas respaldadas, % mismatch(es)', total_tables, total_rows, mismatches;

  IF mismatches > 0 THEN
    RAISE EXCEPTION 'Backup INCOMPLETO — % tabla(s) con row_count diferente. NO procedas con el go-live.', mismatches;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────
-- 5. Tabla temporal con resumen para visualización tabular.
-- ─────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS pg_temp.backup_summary;
CREATE TEMP TABLE backup_summary (
  table_name  TEXT PRIMARY KEY,
  backup_rows BIGINT,
  public_rows BIGINT,
  size_bytes  BIGINT
);

DO $$
DECLARE
  rec RECORD;
  bak_count BIGINT;
  pub_count BIGINT;
  bytes BIGINT;
BEGIN
  FOR rec IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'backup_pre_godo_20260505'
    ORDER BY tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM backup_pre_godo_20260505.%I', rec.tablename) INTO bak_count;
    EXECUTE format('SELECT count(*) FROM public.%I',                   rec.tablename) INTO pub_count;
    bytes := pg_total_relation_size(format('backup_pre_godo_20260505.%I', rec.tablename)::regclass);
    INSERT INTO backup_summary (table_name, backup_rows, public_rows, size_bytes)
    VALUES (rec.tablename, bak_count, pub_count, bytes);
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────────
-- 6. Resumen tabular final — visible en la pestaña Results del SQL Editor.
--    Si la columna `status` muestra cualquier 'MISMATCH', el §4 ya habría
--    abortado — esta vista es informativa.
-- ─────────────────────────────────────────────────────────────────────
SELECT
  table_name,
  backup_rows,
  public_rows,
  CASE WHEN backup_rows = public_rows THEN 'OK' ELSE 'MISMATCH' END AS status,
  pg_size_pretty(size_bytes) AS backup_size
FROM backup_summary
ORDER BY size_bytes DESC, table_name;
