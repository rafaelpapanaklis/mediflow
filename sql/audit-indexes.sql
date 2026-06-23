-- ============================================================================
-- WS-SEG · T3 — Índices para el panel de auditoría
-- Aplicar a MANO en Supabase (SQL editor). Acompaña a los @@index agregados en
-- prisma/schema.prisma (model AuditLog). `prisma generate` NO crea índices en BD.
--
-- CONCURRENTLY = no bloquea escrituras de audit_logs mientras construye.
-- IMPORTANTE: CREATE INDEX CONCURRENTLY no puede ir dentro de una transacción;
-- ejecuta cada sentencia SUELTA (sin BEGIN/COMMIT).
--
-- Los nombres coinciden con los que generaría Prisma, así un futuro
-- `prisma migrate`/`db push` los detecta como existentes y no los duplica.
-- Las columnas son camelCase (sin @map) → van entre comillas dobles.
-- ============================================================================

-- Orden/filtro global por fecha (vista "todas las clínicas" del super admin).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_createdAt_idx"
  ON "audit_logs" ("createdAt");

-- Filtro por usuario + orden por fecha.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_userId_createdAt_idx"
  ON "audit_logs" ("userId", "createdAt");

-- Nota: el índice ([clinicId, createdAt]) ya existía — no se recrea.
