-- ============================================================================
-- SALAMANCA · ORTODONCIA — «Notas internas» del caso
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal NO toca la base.
--
-- QUÉ AGREGA (ADITIVO; no toca ni una fila ni una columna que ya exista):
--   "ortho_internal_notes"           — una fila por nota interna del caso de ortodoncia (el "caseId" es
--                                      orthodontic_treatment_plans.id): quién la escribió, cuándo y el texto vigente.
--   "ortho_internal_note_revisions"  — una fila por CORRECCIÓN: el texto que había antes, desde cuándo, y quién y
--                                      cuándo lo corrigió. Así el historial de la nota queda completo.
--
-- NOM-004 / NOM-024 (el expediente no se destruye):
--   · Una nota NO se borra: la regla "..._sin_delete" hace que un DELETE no haga nada.
--   · Una revisión no se cambia ni se borra: reglas "..._sin_update" y "..._sin_delete".
--   · Corregir = (1) guardar el texto anterior en "ortho_internal_note_revisions" y (2) actualizar el texto vigente
--     de la nota, en UNA sola sentencia del código. La nota sí admite UPDATE (es lo que cambia al corregir).
--
-- SOLO-EQUIPO: estas notas las ve el equipo de la clínica. El código no las lee desde el portal del paciente, ni
-- desde el PDF del expediente, ni desde los mensajes o el bot de WhatsApp (una prueba lo vigila).
--
-- Sin llaves foráneas a propósito (como orthodontic_case_versions): borrar o anonimizar un paciente, un caso o
-- una persona del equipo no arrastra ni borra el historial de las notas. Los ids son TEXT (en esta base no son uuid).
--
-- El código funciona SIN este SQL: sin las tablas, la sección «Notas internas» avisa que falta activarla y nada
-- más se rompe. No se declara en prisma/schema.prisma (se lee y escribe por SQL crudo, con sonda to_regclass).
--
-- IDEMPOTENTE (IF NOT EXISTS, CREATE OR REPLACE RULE): se puede pegar dos veces. CERO DROP. PLANO: sin DO ni funciones.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ortho_internal_notes" (
  "id"        text        PRIMARY KEY,
  "clinicId"  text        NOT NULL,
  "patientId" text        NOT NULL,
  "caseId"    text        NOT NULL,
  "authorId"  text        NOT NULL,
  "body"      text        NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- La lista de un caso: de la más reciente a la más antigua.
CREATE INDEX IF NOT EXISTS "ortho_internal_notes_clinic_case_created_idx"
  ON "ortho_internal_notes" ("clinicId", "caseId", "createdAt");
CREATE INDEX IF NOT EXISTS "ortho_internal_notes_clinic_patient_idx"
  ON "ortho_internal_notes" ("clinicId", "patientId");

CREATE TABLE IF NOT EXISTS "ortho_internal_note_revisions" (
  "id"           text        PRIMARY KEY,
  "clinicId"     text        NOT NULL,
  "noteId"       text        NOT NULL,
  -- El texto que había ANTES de esta corrección y desde cuándo estaba vigente.
  "previousBody" text        NOT NULL,
  "previousFrom" timestamptz NOT NULL,
  -- Quién hizo la corrección y cuándo.
  "editedById"   text        NOT NULL,
  "editedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ortho_internal_note_revisions_clinic_note_idx"
  ON "ortho_internal_note_revisions" ("clinicId", "noteId", "editedAt");

-- Nada se borra; una revisión tampoco se cambia.
CREATE OR REPLACE RULE "ortho_internal_notes_sin_delete" AS
  ON DELETE TO "ortho_internal_notes" DO INSTEAD NOTHING;
CREATE OR REPLACE RULE "ortho_internal_note_revisions_sin_update" AS
  ON UPDATE TO "ortho_internal_note_revisions" DO INSTEAD NOTHING;
CREATE OR REPLACE RULE "ortho_internal_note_revisions_sin_delete" AS
  ON DELETE TO "ortho_internal_note_revisions" DO INSTEAD NOTHING;

-- Deny-all para anon/authenticated (Prisma usa el service role y salta RLS).
ALTER TABLE "ortho_internal_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ortho_internal_note_revisions" ENABLE ROW LEVEL SECURITY;

-- Comprobación (solo lee)
SELECT table_name, column_name, data_type FROM information_schema.columns
 WHERE table_name IN ('ortho_internal_notes', 'ortho_internal_note_revisions')
 ORDER BY table_name, ordinal_position;
SELECT tablename, rulename FROM pg_rules
 WHERE tablename IN ('ortho_internal_notes', 'ortho_internal_note_revisions') ORDER BY 1, 2;
