-- ============================================================================
-- ws1-t12 — Movimientos del paciente: lo que hace quien NO es del equipo
-- (el propio paciente en su portal, la reserva web pública, el bot de WhatsApp,
-- la firma pública de un consentimiento).
-- Aplicar a MANO en Supabase (SQL editor). ADITIVO e IDEMPOTENTE: se puede correr
-- más de una vez sin daño; no borra ni modifica ninguna fila.
--
-- POR QUÉ: audit_logs."userId" es NOT NULL con FK a users, y esas acciones no
-- tienen usuario del equipo. Las alternativas eran peores: inventar un «usuario
-- fantasma» por clínica (saldría en Equipo, en permisos y en los conteos) o una
-- segunda tabla de bitácora (dos fuentes de verdad, UNION en cada lectura).
--
-- QUÉ HACE: 1) deja "userId" aceptar NULL (la FK se conserva: un id que venga
-- tiene que existir); 2) un CHECK para que NULL solo sea válido con un actor
-- externo declarado en "actorType" ('patient' | 'public' | 'bot'). Una fila del
-- equipo sigue exigiendo su usuario. "actorType" ya existe (default 'staff').
--
-- NOM-024 §6.3.5: el trigger trg_audit_logs_immutable (sql/nom-audit-immutable.sql)
-- frena UPDATE y DELETE. Este script no hace ninguno de los dos —solo cambia la
-- definición de la columna y añade una restricción—, así que la bitácora sigue
-- siendo append-only.
--
-- El código FUNCIONA sin este script: mientras "userId" siga NOT NULL, esas filas
-- no se escriben (se anota un aviso en logs y se deja de intentar 2 min); nada
-- falla ni se reintenta a cada petición. Con el script, empiezan a registrarse.
-- Va bien con sql/audit-logs-patient-id.sql (la columna "patientId"), pero no
-- depende de él.
-- ============================================================================

-- 1) "userId" acepta NULL (idempotente: si ya lo acepta, no pasa nada).
ALTER TABLE "audit_logs" ALTER COLUMN "userId" DROP NOT NULL;

-- 2) NULL solo con un actor externo declarado. NOT VALID: se aplica a las filas
--    NUEVAS sin recorrer la tabla (las existentes tienen usuario, así que cumplen).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_logs_actor_externo_check'
      AND conrelid = 'audit_logs'::regclass
  ) THEN
    ALTER TABLE "audit_logs"
      ADD CONSTRAINT "audit_logs_actor_externo_check"
      CHECK ("userId" IS NOT NULL OR "actorType" IN ('patient', 'public', 'bot'))
      NOT VALID;
  END IF;
END
$$;

-- Verificación (opcional):
-- SELECT is_nullable FROM information_schema.columns
--   WHERE table_name = 'audit_logs' AND column_name = 'userId';          -- YES
-- SELECT conname, convalidated FROM pg_constraint
--   WHERE conrelid = 'audit_logs'::regclass AND conname = 'audit_logs_actor_externo_check';
