-- MediFlow / DaleControl — Bitácora de auditoría INMUTABLE (NOM-024 §6.3.5)
-- ════════════════════════════════════════════════════════════════════════
-- APLICAR A MANO en el SQL Editor de Supabase. NO usar `prisma migrate`.
-- https://supabase.com/dashboard/project/<PROJECT>/sql/new
--
-- Cierra los gaps #7 y #8 de la auditoría NOM-024 (Área 4 AUD-2 / AUD-3):
--   1) Trigger BEFORE UPDATE OR DELETE en audit_logs → lanza excepción.
--      La bitácora queda APPEND-ONLY: solo se permite INSERT.
--   2) FK clinics→audit_logs pasa de ON DELETE CASCADE a ON DELETE RESTRICT.
--      Borrar una clínica con bitácora ahora FALLA (no se destruye el rastro;
--      hay que archivar/desligar la bitácora primero).
--
-- TODO es IDEMPOTENTE: re-correr este script no causa daño.
--
-- Alcance / límite conocido: el trigger frena UPDATE/DELETE de la ROLE de la
-- aplicación, service_role INCLUIDO (los triggers SÍ se disparan para
-- service_role, a diferencia de las policies RLS). Un superusuario/owner de
-- la BD todavía puede deshabilitar el trigger o usar
-- session_replication_role='replica'; la inmutabilidad absoluta requiere
-- separación de roles a nivel de infraestructura (fuera de este script).
-- ════════════════════════════════════════════════════════════════════════

-- ── 1) Append-only: bloquear UPDATE y DELETE ──────────────────────────────
CREATE OR REPLACE FUNCTION audit_logs_block_mutations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs es append-only (NOM-024 6.3.5): % no permitido. La bitacora de auditoria no puede modificarse ni borrarse.', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_block_mutations();

-- ── 2) FK clinics→audit_logs: CASCADE → RESTRICT ──────────────────────────
-- Quita CUALQUIER FK existente de audit_logs("clinicId") → clinics (el nombre
-- auto-generado por Postgres puede variar entre entornos) y la recrea con
-- ON DELETE RESTRICT bajo un nombre estable.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid  = 'audit_logs'::regclass
      AND c.confrelid = 'clinics'::regclass
      AND c.contype   = 'f'
  LOOP
    EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', r.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_logs_clinicId_fkey'
      AND conrelid = 'audit_logs'::regclass
  ) THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT "audit_logs_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES clinics(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

-- ── Verificación (opcional — correr a mano para confirmar) ─────────────────
-- SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass;
-- SELECT conname, confdeltype FROM pg_constraint
--   WHERE conrelid = 'audit_logs'::regclass AND contype = 'f';  -- confdeltype 'r' = RESTRICT
