-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T6 · ORTODONCIA OLA 1, «Alta del caso».
--
-- Cuatro columnas aditivas para tres filas nuevas del alcance
-- (REPORTE-ws1-t8.md → «Alta del caso»):
--   A11 · Responsable del pago  → "orthodontic_treatment_plans"."responsibleGuardianId"
--        reutiliza el modelo "Guardian" que ya existe para pediatría, sin
--        exigir que el paciente tenga un PediatricRecord (pediatricRecordId
--        ya es nulo en "Guardian" hoy).
--   A13 · Quién refirió al paciente → "orthodontic_diagnoses"."referredByDoctorId"
--        apunta al directorio existente "doctor_contacts" (mismo que usa la
--        carta de referencia saliente, S16, sin tocarla).
--   A12 · Pacientes en observación → "orthodontic_diagnoses"."inObservation" +
--        "nextObservationDate" (revisión periódica antes de iniciar tratamiento).
--
-- NO toca ni una fila que ya exista: las cuatro columnas nacen NULL/false, que
-- es exactamente "sin responsable de pago todavía" / "sin referente todavía" /
-- "no está en observación" para cualquier caso ya abierto.
--
-- IDEMPOTENTE: cada bloque comprueba existencia antes de crear; correrlo
-- varias veces no da errores ni duplicados. CERO DROP de tablas o columnas.
-- PLANO: sin bloques DO (el SQL Editor de Rafael no los acepta).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
--
-- El código YA tolera que estas columnas aún no existan (P2021/P2022): las
-- actions de "Alta del caso" reintentan sin el campo nuevo y avisan en la UI
-- que hace falta pegar este SQL, en vez de romper la creación del caso.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Responsable del pago (A11) ───────────────────────────────────────
-- [ws1-t1, consolidación de la ola] "Guardian" tiene @@map("ped_guardians")
-- en prisma/schema.prisma — la tabla real NO se llama "guardians" (esa no
-- existe; verificado leyendo information_schema en producción, solo lectura).
-- Sin este arreglo el ADD CONSTRAINT de abajo fallaría al pegarlo.
ALTER TABLE "orthodontic_treatment_plans"
  ADD COLUMN IF NOT EXISTS "responsibleGuardianId" TEXT;

ALTER TABLE "orthodontic_treatment_plans" DROP CONSTRAINT IF EXISTS "orthodontic_treatment_plans_responsibleGuardianId_fkey";
ALTER TABLE "orthodontic_treatment_plans"
  ADD CONSTRAINT "orthodontic_treatment_plans_responsibleGuardianId_fkey"
  FOREIGN KEY ("responsibleGuardianId") REFERENCES "ped_guardians"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "orthodontic_treatment_plans_responsibleGuardianId_idx"
  ON "orthodontic_treatment_plans" ("responsibleGuardianId");


-- ── 2. Quién refirió al paciente (A13) ───────────────────────────────────
ALTER TABLE "orthodontic_diagnoses"
  ADD COLUMN IF NOT EXISTS "referredByDoctorId" TEXT;

ALTER TABLE "orthodontic_diagnoses" DROP CONSTRAINT IF EXISTS "orthodontic_diagnoses_referredByDoctorId_fkey";
ALTER TABLE "orthodontic_diagnoses"
  ADD CONSTRAINT "orthodontic_diagnoses_referredByDoctorId_fkey"
  FOREIGN KEY ("referredByDoctorId") REFERENCES "doctor_contacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "orthodontic_diagnoses_referredByDoctorId_idx"
  ON "orthodontic_diagnoses" ("referredByDoctorId");


-- ── 3. Pacientes en observación (A12) ────────────────────────────────────
ALTER TABLE "orthodontic_diagnoses"
  ADD COLUMN IF NOT EXISTS "inObservation" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "orthodontic_diagnoses"
  ADD COLUMN IF NOT EXISTS "nextObservationDate" TIMESTAMP(3);


-- ── 4. Comprobación (solo lee) ───────────────────────────────────────────
SELECT table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE (table_name = 'orthodontic_treatment_plans' AND column_name = 'responsibleGuardianId')
   OR (table_name = 'orthodontic_diagnoses' AND column_name IN ('referredByDoctorId', 'inObservation', 'nextObservationDate'))
ORDER BY table_name, column_name;
