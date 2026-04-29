-- ═══════════════════════════════════════════════════════════════════
-- Compliance Fase A · Commit 1 — Identificación NOM-024
--
-- Agrega:
--  - CurpStatus enum
--  - patients.curp / curpStatus / passportNo
--  - clinics.clues (CLUES Sector Salud, 11 chars)
--  - users.cedulaProfesional / especialidad / cedulaEspecialidad
--
-- Todo nullable a nivel DB (validación en UI + endpoint). Pacientes
-- legacy quedan curpStatus=PENDING al migrar.
-- ═══════════════════════════════════════════════════════════════════

-- ── Enum CurpStatus (idempotente vía DO block) ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CurpStatus') THEN
    CREATE TYPE "CurpStatus" AS ENUM ('COMPLETE', 'PENDING', 'FOREIGN');
  END IF;
END$$;

-- ── patients: CURP + status + pasaporte ─────────────────────────────
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "curp"        VARCHAR(18);
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "curpStatus"  "CurpStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "passportNo"  VARCHAR(20);

-- ── clinics: CLUES ──────────────────────────────────────────────────
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "clues" VARCHAR(11);

-- ── users: cédulas y especialidad (médicos) ─────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cedulaProfesional"  VARCHAR(15);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "especialidad"       VARCHAR(100);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cedulaEspecialidad" VARCHAR(15);
