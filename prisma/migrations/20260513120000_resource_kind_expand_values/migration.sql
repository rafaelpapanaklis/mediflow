-- ═══════════════════════════════════════════════════════════════════════
-- ResourceKind enum — fase 1: agregar 6 valores nuevos.
--
-- En Postgres, ALTER TYPE ... ADD VALUE puede ejecutarse dentro de una
-- transacción (PG 11+), pero el nuevo valor NO puede USARSE en la misma
-- transacción en que se agregó. Por eso esta migration solo agrega los
-- valores; el backfill de datos + cambio de DEFAULT va en la siguiente
-- (20260513120100_resource_kind_backfill_data).
--
-- Los tres valores viejos (CHAIR/ROOM/EQUIPMENT) se mantienen — Postgres
-- ≤16 no soporta DROP VALUE sin recrear el tipo (DROP TYPE en cascada).
-- Quedan inocuos: el backfill los vacía y el código nuevo no los usa.
--
-- IDEMPOTENTE: ADD VALUE IF NOT EXISTS (soportado desde PG 9.6).
-- ═══════════════════════════════════════════════════════════════════════

ALTER TYPE "ResourceKind" ADD VALUE IF NOT EXISTS 'CONSULTORIO_DENTAL';
ALTER TYPE "ResourceKind" ADD VALUE IF NOT EXISTS 'CONSULTORIO_GENERAL';
ALTER TYPE "ResourceKind" ADD VALUE IF NOT EXISTS 'SILLA_DENTAL';
ALTER TYPE "ResourceKind" ADD VALUE IF NOT EXISTS 'SALA_DE_ESPERA';
ALTER TYPE "ResourceKind" ADD VALUE IF NOT EXISTS 'RADIOGRAFIA';
ALTER TYPE "ResourceKind" ADD VALUE IF NOT EXISTS 'LABORATORIO';
