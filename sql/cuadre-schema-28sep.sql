-- Ortodoncia — cuadre COMPLETO de schema.prisma contra la base real
-- (ws1-t8, 28-sep-2026). El SQL de ayer (sql/ortodoncia-card-patientid.sql,
-- 3 tablas) no bastó: el log de dev.108 siguió mostrando
--
--   The column `ortho_wire_steps.patientId` does not exist
--
-- Se comparó TODO schema.prisma (408 modelos, 259 enums) contra
-- information_schema/pg_catalog reales, en una transacción de SOLO
-- LECTURA (SET TRANSACTION READ ONLY) — sin escribir nada, sin
-- `prisma migrate`. Resultado: 421 tablas existen todas, los 259 enums
-- (los que de verdad respaldan un campo) existen con todos sus valores
-- — el único hueco son 13 COLUMNAS que faltan en 4 grupos de tablas.
-- Detalle completo, con qué modelo/campo pide cada una, en
-- REPORTE-ws1-t8.md de esta misma tarea.
--
-- Aditivo, idempotente, SIN bloques DO — pégalo tal cual en el SQL
-- Editor de Supabase. No toca ninguna fila existente salvo para rellenar
-- el valor por defecto de las 2 columnas que lo llevan (`appliedAt`,
-- `joinedAt` — ya tenían `@default(now())` en el schema).

-- ════════════════════════════════════════════════════════════════════
-- 1. Ortodoncia — patientId en las 6 tablas de la hoja de control que
--    quedaron fuera del script original de fase 1 (6-may-2026). Las 3
--    primeras ya iban en sql/ortodoncia-card-patientid.sql (ayer); las 3
--    últimas son las que de verdad rompían "Firmar control" hoy.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE "ortho_card_elastics" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "ortho_card_elastics" DROP CONSTRAINT IF EXISTS "ortho_card_elastics_patientId_fkey";
ALTER TABLE "ortho_card_elastics"
  ADD CONSTRAINT "ortho_card_elastics_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "ortho_card_elastics_patientId_idx" ON "ortho_card_elastics" ("patientId");

ALTER TABLE "ortho_card_ipr_points" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "ortho_card_ipr_points" DROP CONSTRAINT IF EXISTS "ortho_card_ipr_points_patientId_fkey";
ALTER TABLE "ortho_card_ipr_points"
  ADD CONSTRAINT "ortho_card_ipr_points_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "ortho_card_ipr_points_patientId_idx" ON "ortho_card_ipr_points" ("patientId");

ALTER TABLE "ortho_card_broken_brackets" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "ortho_card_broken_brackets" DROP CONSTRAINT IF EXISTS "ortho_card_broken_brackets_patientId_fkey";
ALTER TABLE "ortho_card_broken_brackets"
  ADD CONSTRAINT "ortho_card_broken_brackets_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "ortho_card_broken_brackets_patientId_idx" ON "ortho_card_broken_brackets" ("patientId");

-- Nuevas hoy (28-sep): mismo hueco del script de fase 1, mismas 3 tablas
-- que faltaban por revisar. ortho_wire_steps es la que de verdad sigue
-- rompiendo "Firmar control" ahora mismo (log de dev.108).
ALTER TABLE "ortho_wire_steps" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "ortho_wire_steps" DROP CONSTRAINT IF EXISTS "ortho_wire_steps_patientId_fkey";
ALTER TABLE "ortho_wire_steps"
  ADD CONSTRAINT "ortho_wire_steps_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "ortho_wire_steps_patientId_idx" ON "ortho_wire_steps" ("patientId");

ALTER TABLE "ortho_aux_mechanics" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "ortho_aux_mechanics" DROP CONSTRAINT IF EXISTS "ortho_aux_mechanics_patientId_fkey";
ALTER TABLE "ortho_aux_mechanics"
  ADD CONSTRAINT "ortho_aux_mechanics_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "ortho_aux_mechanics_patientId_idx" ON "ortho_aux_mechanics" ("patientId");

ALTER TABLE "ortho_phase_transitions" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "ortho_phase_transitions" DROP CONSTRAINT IF EXISTS "ortho_phase_transitions_patientId_fkey";
ALTER TABLE "ortho_phase_transitions"
  ADD CONSTRAINT "ortho_phase_transitions_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "ortho_phase_transitions_patientId_idx" ON "ortho_phase_transitions" ("patientId");

-- ════════════════════════════════════════════════════════════════════
-- 2. Belleza/spa — FormulaRecord (formula_records): fórmula de color/
--    tratamiento aplicada a un paciente. `appliedAt`/`appliedBy` están
--    en schema.prisma (modelo FormulaRecord) desde antes de esta ola —
--    deriva vieja, sin relación con el trabajo de ortodoncia de hoy.
--    `appliedAt` trae `@default(now())` en el schema: se agrega con el
--    mismo default para que las filas existentes queden con una fecha
--    válida, no NULL.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE "formula_records" ADD COLUMN IF NOT EXISTS "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT now();
ALTER TABLE "formula_records" ADD COLUMN IF NOT EXISTS "appliedBy" TEXT;

-- ════════════════════════════════════════════════════════════════════
-- 3. Belleza/spa — BodyMapAnnotation (body_map_annotations): mapa
--    corporal anotado (cuerpo completo/rostro/cuero cabelludo/pies).
--    Deriva vieja, sin relación con ortodoncia.
--
--    ⚠ `mapType` es NOT NULL en schema.prisma y SIN default — un valor
--    inventado ("full_body" a ciegas) sería un dato clínico falso en
--    cualquier fila existente. Se agrega NULLABLE (sin el NOT NULL del
--    schema) para no arriesgar romper el ALTER ni mentir un valor: es
--    la opción seguridad de las dos que pide el encargo ("nullable / con
--    default neutro") cuando no hay un default neutro de verdad que dar.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE "body_map_annotations" ADD COLUMN IF NOT EXISTS "mapType" TEXT;

-- ════════════════════════════════════════════════════════════════════
-- 4. Belleza/spa — WalkInQueue (walk_in_queue): cola de "sin cita" del
--    salón. Deriva vieja, sin relación con ortodoncia. `patientId` y
--    `assignedTo` son texto libre en schema.prisma (sin `@relation`):
--    no llevan FK. `joinedAt` trae `@default(now())`, mismo criterio
--    que `appliedAt` arriba.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE "walk_in_queue" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "walk_in_queue" ADD COLUMN IF NOT EXISTS "assignedTo" TEXT;
ALTER TABLE "walk_in_queue" ADD COLUMN IF NOT EXISTS "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT now();
ALTER TABLE "walk_in_queue" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);

-- ════════════════════════════════════════════════════════════════════
-- 5. Verificación — corre esto último. Sin filas = las 13 columnas de
--    arriba ya existen todas. Cada fila que salga es una columna que NO
--    se creó (revisa el error del ALTER correspondiente).
-- ════════════════════════════════════════════════════════════════════

SELECT wanted.table_name, wanted.column_name
FROM (VALUES
  ('ortho_card_elastics', 'patientId'),
  ('ortho_card_ipr_points', 'patientId'),
  ('ortho_card_broken_brackets', 'patientId'),
  ('ortho_wire_steps', 'patientId'),
  ('ortho_aux_mechanics', 'patientId'),
  ('ortho_phase_transitions', 'patientId'),
  ('formula_records', 'appliedAt'),
  ('formula_records', 'appliedBy'),
  ('body_map_annotations', 'mapType'),
  ('walk_in_queue', 'patientId'),
  ('walk_in_queue', 'assignedTo'),
  ('walk_in_queue', 'joinedAt'),
  ('walk_in_queue', 'startedAt')
) AS wanted(table_name, column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
  AND c.table_name = wanted.table_name
  AND c.column_name = wanted.column_name
WHERE c.column_name IS NULL;
