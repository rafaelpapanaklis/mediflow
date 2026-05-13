-- ═══════════════════════════════════════════════════════════════════════
-- ResourceKind enum — fase 2: backfill de datos + cambio de DEFAULT.
--
-- Mapeo:
--   CHAIR     → SILLA_DENTAL          (sillón dental)
--   ROOM      → CONSULTORIO_GENERAL   (sala genérica de atención)
--   EQUIPMENT → LABORATORIO           (equipo / laboratorio)
--
-- Requisito: los valores nuevos deben existir como enum (los agrega la
-- migration 20260513120000_resource_kind_expand_values, que corre antes).
-- En PG no se puede usar un enum value en la misma transacción en que se
-- creó, por eso el split en dos migrations.
--
-- IDEMPOTENTE: las UPDATE filtran por kind viejo; rerun encuentra 0 rows.
-- ALTER TABLE ... SET DEFAULT es idempotente (poner el mismo default es
-- no-op).
-- ═══════════════════════════════════════════════════════════════════════

UPDATE "Resource" SET "kind" = 'SILLA_DENTAL'        WHERE "kind" = 'CHAIR';
UPDATE "Resource" SET "kind" = 'CONSULTORIO_GENERAL' WHERE "kind" = 'ROOM';
UPDATE "Resource" SET "kind" = 'LABORATORIO'         WHERE "kind" = 'EQUIPMENT';

ALTER TABLE "Resource" ALTER COLUMN "kind" SET DEFAULT 'SILLA_DENTAL'::"ResourceKind";
