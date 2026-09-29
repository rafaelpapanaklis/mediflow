-- ============================================================================
-- ws1-t12 — Movimientos del paciente: audit_logs.patientId
-- Aplicar a MANO en Supabase (SQL editor). ADITIVO e IDEMPOTENTE: se puede
-- correr más de una vez sin daño; no borra ni modifica ninguna fila.
--
-- El código FUNCIONA sin este script: mientras la columna no exista, el paciente
-- se guarda dentro de changes->'_mov'->'after'->>'patientId' y «Movimientos» lo
-- lee de ahí (solo de los últimos 90 días, sin índice). Con la columna, las filas
-- nuevas la llevan y la lista usa el índice de abajo.
--
-- NO hay backfill por UPDATE: audit_logs es append-only por trigger (NOM-024,
-- sql/nom-audit-immutable.sql) y ese trigger frena cualquier UPDATE. Las filas de
-- antes se atribuyen al paciente EN LA CONSULTA, deduciéndolo de la tabla de su
-- entidad (cita, factura, nota, receta…); no hace falta tocarlas.
--
-- `patientId` NO va en `model AuditLog` de prisma/schema.prisma a propósito: el
-- cliente de Prisma pediría la columna en TODA lectura de la bitácora y en el
-- RETURNING de cada create, y hasta correr este SQL fallaría la bitácora entera.
-- Solo src/lib/movimientos-paciente la toca, con SQL crudo.
--
-- Sin FK a patients: la bitácora no debe bloquear ni depender del borrado de un
-- paciente (misma razón que audit_logs.actorAdminId).
-- ============================================================================

-- 1) La columna (nullable: las filas sin paciente y las de antes quedan en NULL).
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "patientId" TEXT;

-- 2) El índice de la lista de un paciente: sede + paciente + más nuevo primero.
--    CONCURRENTLY no puede ir dentro de una transacción: ejecútalo SUELTO
--    (sin BEGIN/COMMIT), después del ALTER.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_clinicId_patientId_createdAt_idx"
  ON "audit_logs" ("clinicId", "patientId", "createdAt" DESC);

-- Verificación (opcional):
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'audit_logs' AND column_name = 'patientId';
-- SELECT indexname FROM pg_indexes WHERE tablename = 'audit_logs';
