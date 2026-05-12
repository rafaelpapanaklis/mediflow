-- ═══════════════════════════════════════════════════════════════════════
-- Ortodoncia · Rediseño — Fix incremental schema drift (mayo 2026)
--
-- DEPLOY MANUAL EN SUPABASE PRODUCCIÓN.
--
-- Resuelve la deriva entre prisma/schema.prisma y los SQLs ya aplicados:
--   - apply-ortho-redesign-fase1-prod.sql   (Fase 1)
--   - apply-ortho-redesign-fase1-5-prod.sql (Fase 1.5)
--
-- Origen de la deriva: posterior al merge de Fase 1, alguien agregó arrays
-- inversos en `model Patient { ... }` (líneas 209-216 de schema.prisma) y
-- `prisma format` auto-generó las contrarrelaciones opcionales en cada hijo:
--   `Patient   Patient? @relation(fields: [patientId], references: [id])`
--   `patientId String?`
-- pero NO se creó migración. El generador de Prisma quedó con un schema más
-- nuevo que las tablas en prod, y el seed de Gabriela explota con P2021 al
-- intentar `orthoWireStep.create({ data: { patientId, ... } })`.
--
-- Este fix añade 6 columnas opcionales `patientId TEXT` y sus 6 FKs
-- (ON DELETE SET NULL ON UPDATE CASCADE — defaults Prisma para relación
-- opcional). Las columnas son nullable y se rellenan en runtime: rows
-- pre-existentes quedarán con patientId NULL y el código sigue siendo
-- válido — la relación es opcional en el schema. No hay backfill.
--
-- 100% IDEMPOTENTE: ADD COLUMN IF NOT EXISTS + ADD CONSTRAINT con DO $$
-- guard. Se puede correr N veces sin error. NO toca data ni elimina nada.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Tablas afectadas ────────────────────────────────────────────────────
--   ortho_wire_steps              — G3
--   ortho_card_elastics           — G1 child
--   ortho_card_ipr_points         — G1 child
--   ortho_card_broken_brackets    — G1 child
--   ortho_aux_mechanics           — G10
--   ortho_phase_transitions       — audit avance de fase

-- ── 1. ADD COLUMN patientId (nullable, sin default) ─────────────────────

ALTER TABLE "ortho_wire_steps"           ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "ortho_card_elastics"        ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "ortho_card_ipr_points"      ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "ortho_card_broken_brackets" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "ortho_aux_mechanics"        ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "ortho_phase_transitions"    ADD COLUMN IF NOT EXISTS "patientId" TEXT;

-- ── 2. FOREIGN KEYS (defaults Prisma para relación opcional) ────────────
-- onDelete = SetNull, onUpdate = Cascade.

DO $$ BEGIN
  ALTER TABLE "ortho_wire_steps"
    ADD CONSTRAINT "ortho_wire_steps_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_card_elastics"
    ADD CONSTRAINT "ortho_card_elastics_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_card_ipr_points"
    ADD CONSTRAINT "ortho_card_ipr_points_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_card_broken_brackets"
    ADD CONSTRAINT "ortho_card_broken_brackets_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_aux_mechanics"
    ADD CONSTRAINT "ortho_aux_mechanics_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ortho_phase_transitions"
    ADD CONSTRAINT "ortho_phase_transitions_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;

-- Verificación rápida (opcional, después del deploy):
-- SELECT table_name, column_name FROM information_schema.columns
--  WHERE table_schema='public' AND column_name='patientId'
--    AND table_name IN ('ortho_wire_steps','ortho_card_elastics','ortho_card_ipr_points',
--                       'ortho_card_broken_brackets','ortho_aux_mechanics','ortho_phase_transitions');
-- Debe devolver 6 filas.
