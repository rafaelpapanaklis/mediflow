-- ═══════════════════════════════════════════════════════════════════
-- Defense-in-depth: RLS deny-all para anon y authenticated
--
-- CONTEXTO
-- MediFlow accede a TODAS las tablas vía Prisma + service role
-- (server-side). El cliente NO usa supabase.from(<tabla>).select() para
-- nada — sólo Auth (signIn/signOut) se hace desde el browser. El audit
-- (grep en src/components y src/app) confirmó cero accesos directos.
--
-- Esta policy RESTRICTIVE deny-all en (anon, authenticated) cierra
-- completamente la puerta a accesos accidentales vía PostgREST si en
-- algún momento se filtra el anon key, o si alguien deja un select del
-- cliente por accidente. El service role bypassa RLS por diseño.
--
-- IDEMPOTENTE: cada policy se crea sólo si no existe (DO $$ block).
-- Seguro de re-correr.
--
-- IMPORTANTE: Antes de aplicar, ejecuta `ALTER TABLE <t> ENABLE ROW LEVEL
-- SECURITY` para cada tabla. Esto está incluido al final del bloque por
-- tabla. Si una tabla no existe (deploy parcial), el statement falla
-- silenciosamente porque está envuelto en EXCEPTION WHEN undefined_table.
-- ═══════════════════════════════════════════════════════════════════

-- Helper: aplica RLS + deny-all policy a UNA tabla. Idempotente.
CREATE OR REPLACE FUNCTION public._apply_deny_all_rls(p_table text)
RETURNS void AS $$
DECLARE
  v_policy_name text := p_table || '_deny_anon';
BEGIN
  -- Habilita RLS si no está
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', p_table);

  -- Crea la policy sólo si no existe
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = p_table
      AND policyname = v_policy_name
  ) THEN
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      v_policy_name, p_table
    );
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'tabla % no existe — saltada', p_table;
END;
$$ LANGUAGE plpgsql;

-- Aplica a las 58 tablas reportadas por bug-audit
SELECT public._apply_deny_all_rls(t) FROM unnest(ARRAY[
  'Resource',
  'WaitlistEntry',
  'admin_announcements',
  'admin_clinic_notes',
  'appointment_timelines',
  'appointments',
  'arco_requests',
  'audit_logs',
  'before_after_photos',
  'body_map_annotations',
  'cfdi_records',
  'cie10_codes',
  'cie9_codes',
  'clinic_layouts',
  'clinic_schedules',
  'clinics',
  'consent_forms',
  'coupons',
  'cums_items',
  'dental_charts',
  'doctor_signature_certs',
  'formula_records',
  'inbox_messages',
  'inbox_threads',
  'inventory_history',
  'inventory_items',
  'invoices',
  'medical_record_diagnoses',
  'medical_records',
  'no_show_predictions',
  'odontogram_entries',
  'odontogram_snapshots',
  'package_redemptions',
  'patient_files',
  'patient_satisfactions',
  'patients',
  'payment_plans',
  'payments',
  'periodontal_records',
  'plan_payments',
  'prescription_items',
  'prescriptions',
  'procedure_catalog',
  'referrals',
  'reminders',
  'resource_bookings',
  'resource_costs',
  'service_packages',
  'signed_documents',
  'subscription_invoices',
  'treatment_plans',
  'treatment_sessions',
  'tv_displays',
  'users',
  'walk_in_queue',
  'weekly_insights',
  'whatsapp_reminders',
  'xray_analyses'
]) AS t;

-- Limpia el helper (no es API estable, sólo para esta migración)
DROP FUNCTION IF EXISTS public._apply_deny_all_rls(text);

-- ═══════════════════════════════════════════════════════════════════
-- Verificación post-aplicación: deberías ver 58 filas (una por tabla)
-- con policyname terminando en _deny_anon.
-- ═══════════════════════════════════════════════════════════════════
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public' AND policyname LIKE '%_deny_anon'
-- ORDER BY tablename;
