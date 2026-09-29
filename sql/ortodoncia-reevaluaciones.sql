-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T8 · ORTODONCIA, REEVALUACIONES del caso (versiones fechadas e inmutables).
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal NO toca la base.
--
-- QUÉ AGREGA (ADITIVO; no toca ni una fila que ya exista):
--   "orthodontic_case_versions": una fila por versión CERRADA del caso. «Nueva reevaluación» guarda aquí la
--   foto del diagnóstico y del plan de tratamiento completos tal como estaban (columnas de siempre en
--   "diagnostico"/"plan" + los JSON "diagnosticoDetalle"/"planDetalle"), con quién, cuándo y el motivo; a
--   partir de ahí se edita la versión nueva en la pestaña. La versión 0 es la «Inicial».
--
-- INMUTABLE (NOM-004): las dos reglas de abajo hacen que un UPDATE o un DELETE sobre esta tabla no haga nada.
-- Sin llaves foráneas a propósito: borrar o anonimizar un paciente o un caso no arrastra su historial.
--
-- El código funciona SIN este SQL: sin la tabla, la línea de tiempo no se pinta y «Nueva reevaluación» avisa
-- que falta pegarlo. No se declara en prisma/schema.prisma (se lee y escribe por SQL crudo con sonda).
--
-- IDEMPOTENTE (IF NOT EXISTS, CREATE OR REPLACE RULE): se puede pegar dos veces. CERO DROP de tablas o
-- columnas. PLANO: sin bloques DO ni funciones.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "orthodontic_case_versions" (
  "id" TEXT PRIMARY KEY,
  "clinicId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "treatmentPlanId" TEXT NOT NULL,
  "diagnosisId" TEXT NOT NULL,
  "numero" INTEGER NOT NULL,
  "iniciadaEl" TIMESTAMP(3) NOT NULL,
  "cerradaEl" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "motivo" TEXT NOT NULL,
  "cerradaPorUserId" TEXT,
  "diagnostico" JSONB NOT NULL,
  "diagnosticoDetalle" JSONB,
  "plan" JSONB NOT NULL,
  "planDetalle" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "orthodontic_case_versions_plan_numero_key"
  ON "orthodontic_case_versions" ("treatmentPlanId", "numero");
CREATE INDEX IF NOT EXISTS "orthodontic_case_versions_clinicId_idx"
  ON "orthodontic_case_versions" ("clinicId");
CREATE INDEX IF NOT EXISTS "orthodontic_case_versions_patientId_idx"
  ON "orthodontic_case_versions" ("patientId");

-- Una versión cerrada no se cambia ni se borra.
CREATE OR REPLACE RULE "orthodontic_case_versions_sin_update" AS
  ON UPDATE TO "orthodontic_case_versions" DO INSTEAD NOTHING;
CREATE OR REPLACE RULE "orthodontic_case_versions_sin_delete" AS
  ON DELETE TO "orthodontic_case_versions" DO INSTEAD NOTHING;

-- Comprobación (solo lee)
SELECT table_name, column_name, data_type FROM information_schema.columns
 WHERE table_name = 'orthodontic_case_versions' ORDER BY ordinal_position;
SELECT rulename FROM pg_rules WHERE tablename = 'orthodontic_case_versions';
