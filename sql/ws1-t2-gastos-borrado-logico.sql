-- ═══════════════════════════════════════════════════════════════════
-- GASTOS — BORRADO LÓGICO (ws1-t2, auditoría de dinero F11, 3-oct-2026)
--
-- Hoy borrar un gasto lo elimina de la base sin dejar copia: la utilidad
-- del mes sube y nadie puede saber por qué. Con estas dos columnas, borrar
-- solo marca el gasto (deja de contar en Finanzas, la lista y Sabina), y la
-- fila se conserva. La bitácora (AuditLog, entidad "expense") ya guarda la
-- copia desde el código, con o sin este SQL.
--
-- El código funciona ANTES de pegarlo: pregunta si la columna existe
-- (information_schema) y, mientras no, borra como siempre. No hay campo
-- nuevo en schema.prisma a propósito (se lee por SQL crudo).
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica datos.
-- No es tabla nueva: `expenses` ya tiene sus políticas (sql/expenses.sql).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "deletedAt"   timestamp(3);
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "deletedById" text;

-- Las lecturas piden «los borrados de esta clínica»: índice parcial chico.
CREATE INDEX IF NOT EXISTS "expenses_clinicId_deleted_idx"
  ON "expenses" ("clinicId")
  WHERE "deletedAt" IS NOT NULL;

-- Comprobación (debe devolver 2 filas):
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'expenses'
   AND column_name IN ('deletedAt', 'deletedById');
