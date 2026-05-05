-- ═══════════════════════════════════════════════════════════════════
-- CLEANUP — migración Orto 20260505000000 (parcial / fallida)
--
-- Contexto: la migración original `migration.sql` falló parcialmente con
-- `ERROR: 42P01: relation "v_paid" does not exist` durante la creación del
-- trigger `recalc_payment_plan_status`. El SQL Editor de Supabase parsea
-- el cuerpo de la función con dollar-quote `$$` inconsistentemente
-- después de los 71 bloques `DO $$ ... END $$;` previos en la misma
-- migración, lo que fragmenta el cuerpo y deja la migración a medias.
--
-- Este script BORRA todo lo que la migración alcanzó a crear, sin tocar
-- migraciones previas (Pedi/Endo/Perio/Implant ya están OK en producción).
--
-- TOLERANTE: cada DROP usa IF EXISTS y los DROP TRIGGER van guardados
-- en DO blocks que primero verifican que la tabla existe. La migración
-- pudo morir en CUALQUIER punto — el script corre completo aun si nada
-- llegó a crearse, o si parcialmente se crearon enums sin tablas, etc.
--
-- IDEMPOTENTE: re-corrible cualquier número de veces sin error.
--
-- ORDEN DE EJECUCIÓN (post-cleanup):
--   1. Corre este script en SQL Editor.
--   2. Verifica que las queries de validación al final reportan 0 tablas
--      ortho restantes y 0 enums Ortho restantes.
--   3. Aplica `migration.fixed.sql` (mismo directorio, dollar-quote tagged).
--
-- LIMITACIÓN PG ≤ 16:
--   ALTER TYPE … DROP VALUE no existe — los 6 valores ortho añadidos a
--   `FileCategory` (ORTHO_PHOTO_T0/T1/T2/CONTROL, CEPH_ANALYSIS_PDF,
--   SCAN_STL) NO se pueden remover. Son inocuos: si re-corres
--   `migration.fixed.sql`, los `ALTER TYPE … ADD VALUE IF NOT EXISTS` los
--   detectan y no fallan.
-- ═══════════════════════════════════════════════════════════════════


-- ── 1. Trigger + función del trigger ─────────────────────────────────
-- Estrategia: DROP FUNCTION … CASCADE elimina automáticamente cualquier
-- trigger que dependa de la función. Si la tabla `ortho_installments` no
-- existe (migración murió antes), el trigger tampoco existe y no hay
-- nada que cascadear; IF EXISTS hace el DROP no-op para la función.
--
-- El DO block previo es defensivo: si por alguna razón hubiera quedado
-- un trigger huérfano apuntando a OTRA función, lo limpiamos primero.
DO $cleanup_trigger$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'ortho_installments'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS recalc_payment_plan_status ON "ortho_installments"';
  END IF;
END $cleanup_trigger$;

DROP FUNCTION IF EXISTS ortho_recalc_payment_plan_status() CASCADE;


-- ── 2. Tablas en orden inverso de dependencias FK ────────────────────
-- DROP TABLE IF EXISTS … CASCADE no falla si la tabla no existe.
-- CASCADE arrastra constraints, indexes, RLS policies y FKs entrantes.
DROP TABLE IF EXISTS "orthodontic_consents"             CASCADE;
DROP TABLE IF EXISTS "orthodontic_digital_records"      CASCADE;
DROP TABLE IF EXISTS "orthodontic_control_appointments" CASCADE;
DROP TABLE IF EXISTS "orthodontic_phases"               CASCADE;
DROP TABLE IF EXISTS "ortho_installments"               CASCADE;
DROP TABLE IF EXISTS "ortho_payment_plans"              CASCADE;
DROP TABLE IF EXISTS "ortho_photo_sets"                 CASCADE;
DROP TABLE IF EXISTS "orthodontic_treatment_plans"      CASCADE;
DROP TABLE IF EXISTS "orthodontic_diagnoses"            CASCADE;


-- ── 3. Enums (18) ────────────────────────────────────────────────────
-- DROP TYPE IF EXISTS no falla si el tipo no existe.
-- CASCADE elimina cualquier columna que use el tipo (ya no existen
-- porque las tablas ya cayeron).
--
-- NOTA: los 18 nombres deben coincidir EXACTAMENTE con los CREATE TYPE
-- de migration.sql. La migración original tiene 7 enums prefijados con
-- "Ortho" + 11 enums con nombres genéricos (HabitType, DentalPhase, etc.)
-- que solo se usan en el módulo ortodóntico — el grep de prisma/schema
-- y de las otras migraciones lo confirma.
DROP TYPE IF EXISTS "AngleClass"           CASCADE;
DROP TYPE IF EXISTS "OrthoTechnique"       CASCADE;
DROP TYPE IF EXISTS "AnchorageType"        CASCADE;
DROP TYPE IF EXISTS "OrthoPhaseKey"        CASCADE;
DROP TYPE IF EXISTS "OrthoPhaseStatus"     CASCADE;
DROP TYPE IF EXISTS "OrthoTreatmentStatus" CASCADE;
DROP TYPE IF EXISTS "OrthoPaymentStatus"   CASCADE;
DROP TYPE IF EXISTS "InstallmentStatus"    CASCADE;
DROP TYPE IF EXISTS "OrthoPhotoSetType"    CASCADE;
DROP TYPE IF EXISTS "OrthoPhotoView"       CASCADE;
DROP TYPE IF EXISTS "HabitType"            CASCADE;
DROP TYPE IF EXISTS "DentalPhase"          CASCADE;
DROP TYPE IF EXISTS "TreatmentObjective"   CASCADE;
DROP TYPE IF EXISTS "OrthoConsentType"     CASCADE;
DROP TYPE IF EXISTS "ControlAttendance"    CASCADE;
DROP TYPE IF EXISTS "AdjustmentType"       CASCADE;
DROP TYPE IF EXISTS "OrthoPaymentMethod"   CASCADE;
DROP TYPE IF EXISTS "DigitalRecordType"    CASCADE;


-- ── 4. Validación post-cleanup ───────────────────────────────────────
-- Debe reportar 0 tablas + 0 enums restantes. Si reporta >0, hubo algo
-- que el cleanup no alcanzó — investigar antes de aplicar la fixed.
-- La 4ª query reporta los valores de FileCategory que NO se pueden
-- quitar en PG ≤ 16; se espera 0–6 según hasta dónde llegó la migración.

SELECT
  'tablas_ortho_restantes' AS check_name,
  count(*)::int            AS count,
  string_agg(tablename, ', ') AS detalle
FROM pg_tables
WHERE schemaname = 'public'
  AND (tablename LIKE 'ortho%' OR tablename LIKE 'orthodontic_%')

UNION ALL

SELECT
  'enums_ortho_restantes',
  count(*)::int,
  string_agg(typname, ', ')
FROM pg_type t
JOIN pg_namespace ns ON ns.oid = t.typnamespace
WHERE ns.nspname = 'public'
  AND t.typtype = 'e'
  AND t.typname IN (
    'AngleClass', 'OrthoTechnique', 'AnchorageType', 'OrthoPhaseKey',
    'OrthoPhaseStatus', 'OrthoTreatmentStatus', 'OrthoPaymentStatus',
    'InstallmentStatus', 'OrthoPhotoSetType', 'OrthoPhotoView',
    'HabitType', 'DentalPhase', 'TreatmentObjective', 'OrthoConsentType',
    'ControlAttendance', 'AdjustmentType', 'OrthoPaymentMethod',
    'DigitalRecordType'
  )

UNION ALL

SELECT
  'trigger_funcion_restante',
  count(*)::int,
  string_agg(proname, ', ')
FROM pg_proc p
JOIN pg_namespace ns ON ns.oid = p.pronamespace
WHERE ns.nspname = 'public'
  AND p.proname = 'ortho_recalc_payment_plan_status'

UNION ALL

SELECT
  'valores_FileCategory_ortho_NO_removibles',
  count(*)::int,
  string_agg(enumlabel, ', ')
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'FileCategory'
  AND e.enumlabel IN (
    'ORTHO_PHOTO_T0', 'ORTHO_PHOTO_T1', 'ORTHO_PHOTO_T2',
    'ORTHO_PHOTO_CONTROL', 'CEPH_ANALYSIS_PDF', 'SCAN_STL'
  );
