-- ═══════════════════════════════════════════════════════════════════
-- Compliance Fase A · Commit 2 — Antecedentes NOM-004
--
-- Agrega 2 campos TEXT a patients para cumplir el contenido mínimo
-- del expediente clínico según NOM-004-SSA3-2012:
--  - familyHistory                  → antecedentes heredofamiliares
--  - personalNonPathologicalHistory → alimentación, higiene,
--                                     alcohol, tabaco, etc.
--
-- Ambos nullable a nivel DB. UI los muestra como textareas opcionales
-- en la sección antecedentes del expediente del paciente.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "familyHistory"                  TEXT;
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "personalNonPathologicalHistory" TEXT;
