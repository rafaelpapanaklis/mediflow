-- ═══════════════════════════════════════════════════════════════════
-- NOM-RLS: RLS deny-all FALTANTE — tablas sin política (gap #26)
--
-- BASE LEGAL
--   LFPDPPP art. 19 (medidas de seguridad sobre datos personales) +
--   NOM-024-SSA3-2012 §6.3.2 (control de acceso). Cierra los hallazgos
--   AC-10 y AC-14 / gap #26 de docs/compliance/NOM024_AUDIT_2026-06-17.md:
--   las credenciales del portal del paciente (passwordHash/tokenHash) y
--   las tablas del módulo de laboratorios B2B carecían de RLS, por lo que
--   una fuga del anon key las expondría vía PostgREST.
--
-- PATRÓN — idéntico a sql/rls-deny-all-policies.sql:
--   MediFlow accede a TODAS las tablas vía Prisma + service role
--   (server-side). El cliente NO hace supabase.from(<tabla>).select().
--   Esta policy RESTRICTIVE deny-all en (anon, authenticated) cierra la
--   puerta a PostgREST. El service role bypassa RLS por diseño → la app
--   sigue funcionando igual; estas policies son defense-in-depth inerte
--   para el cliente.
--
-- IDEMPOTENTE: el helper crea la policy sólo si no existe y envuelve cada
--   tabla en EXCEPTION WHEN undefined_table (deploy parcial = se salta).
--   Seguro de re-correr. Aplicar a mano en Supabase (SQL editor).
--
-- ALCANCE (16 tablas):
--   Portal del paciente: patient_accounts, patient_account_links,
--     patient_account_sessions          (def. sql/patient-portal.sql)
--   IA de recetas:       prescription_ai_checks
--                                        (def. sql/prescription-ai-check.sql)
--   Laboratorios B2B:    dental_labs + dental_lab_* (11)  (Prisma @@map)
--
--   Nota de alcance: el gap #26 nombra patient_accounts/sessions +
--   prescription_ai_check + dental_lab_*. Se añaden además
--   patient_account_links (mismo cluster de PII: mapea paciente↔clínica)
--   y el padre dental_labs (datos del lab + token MP). Ningún SQL previo
--   cubría ninguna de estas 16 — verificado contra todos los *.sql.
--   El nombre real de la tabla de IA es `prescription_ai_checks` (plural,
--   @@map en prisma/schema.prisma:2437), no `prescription_ai_check`.
-- ═══════════════════════════════════════════════════════════════════

-- Helper: aplica RLS + deny-all policy a UNA tabla. Idempotente.
-- (mismo cuerpo y mismo nombre de policy `<tabla>_deny_anon` que
--  sql/rls-deny-all-policies.sql, para mantener un único patrón.)
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

-- Aplica a las 16 tablas que hoy NO tienen RLS (gap #26 / AC-10 / AC-14)
SELECT public._apply_deny_all_rls(t) FROM unnest(ARRAY[
  -- Portal del paciente (credenciales + vínculo PII)
  'patient_accounts',
  'patient_account_links',
  'patient_account_sessions',
  -- IA de contraindicaciones al recetar (cache de resultados)
  'prescription_ai_checks',
  -- Laboratorios B2B
  'dental_labs',
  'dental_lab_users',
  'dental_lab_services',
  'dental_lab_orders',
  'dental_lab_order_events',
  'dental_lab_order_files',
  'dental_lab_traffic_history',
  'dental_lab_bank_accounts',
  'dental_lab_fiscal_data',
  'dental_lab_invoices',
  'dental_lab_chat_threads',
  'dental_lab_chat_messages'
]) AS t;

-- Limpia el helper (no es API estable, sólo para esta migración).
-- NOTA: comparte nombre con sql/rls-deny-all-policies.sql; al ser
-- CREATE OR REPLACE + DROP IF EXISTS, aplicarlos en cualquier orden es
-- seguro e idempotente.
DROP FUNCTION IF EXISTS public._apply_deny_all_rls(text);

-- ═══════════════════════════════════════════════════════════════════
-- Verificación post-aplicación: deberías ver 16 filas (una por tabla)
-- con policyname terminando en _deny_anon.
-- ═══════════════════════════════════════════════════════════════════
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public'
--   AND policyname LIKE '%_deny_anon'
--   AND tablename IN (
--     'patient_accounts','patient_account_links','patient_account_sessions',
--     'prescription_ai_checks','dental_labs','dental_lab_users',
--     'dental_lab_services','dental_lab_orders','dental_lab_order_events',
--     'dental_lab_order_files','dental_lab_traffic_history',
--     'dental_lab_bank_accounts','dental_lab_fiscal_data',
--     'dental_lab_invoices','dental_lab_chat_threads','dental_lab_chat_messages')
-- ORDER BY tablename;
