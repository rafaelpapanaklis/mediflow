-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T1 · ORTODONCIA OLA 0, NÚCLEO.
--
-- Tres columnas aditivas para las cuatro decisiones de arquitectura del
-- reporte de alcance (REPORTE-ws1-t8.md):
--   1) El dinero va por la factura a plazos → el caso apunta a su factura
--      ("orthodontic_treatment_plans"."invoiceId") y a su doctor tratante
--      ("treatingDoctorId"). OrthoPaymentPlan/OrthoInstallment se ocultan
--      en el código, no se tocan aquí.
--   2) El control es una cita → "ortho_treatment_cards"."appointmentId"
--      liga la hoja de control con su Appointment de Agenda.
--
-- NO toca ni una fila que ya exista: las tres columnas nacen NULL, que es
-- exactamente "sin doctor tratante todavía" / "sin factura todavía" / "sin
-- cita de Agenda todavía" para cualquier caso ya abierto.
--
-- IDEMPOTENTE: cada bloque comprueba existencia antes de crear; correrlo
-- varias veces no da errores ni duplicados. CERO DROP de tablas o columnas.
-- PLANO: sin bloques DO (el SQL Editor de Rafael no los acepta).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
--
-- Nota sobre los nombres: camelCase ENTRECOMILLADO, como los escribe Prisma.
-- El código YA tolera que estas columnas aún no existan (P2021/P2022) — ver
-- REPORTE-ws1-t1.md — así que aplicar este SQL no es bloqueante para que
-- dev.108 siga funcionando mientras Rafael no lo pega.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Doctor tratante del caso ─────────────────────────────────────────
-- Distinto de "diagnosedById" (quien diagnosticó): el doctor que LLEVA el
-- tratamiento, para reportes y para que Cobro/Recepción sepan a quién
-- avisar. NULL = sin asignar todavía (como hoy).
ALTER TABLE "orthodontic_treatment_plans"
  ADD COLUMN IF NOT EXISTS "treatingDoctorId" TEXT;

ALTER TABLE "orthodontic_treatment_plans" DROP CONSTRAINT IF EXISTS "orthodontic_treatment_plans_treatingDoctorId_fkey";
ALTER TABLE "orthodontic_treatment_plans"
  ADD CONSTRAINT "orthodontic_treatment_plans_treatingDoctorId_fkey"
  FOREIGN KEY ("treatingDoctorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "orthodontic_treatment_plans_treatingDoctorId_idx"
  ON "orthodontic_treatment_plans" ("treatingDoctorId");


-- ── 2. Factura del tratamiento (decisión 1: el dinero va por la factura
--      a plazos, no por una tabla propia de cuotas) ─────────────────────
-- Un caso ↔ una factura del tratamiento como máximo (índice único). NULL =
-- sin factura abierta todavía (el caso existe, aún no se ha cobrado nada).
ALTER TABLE "orthodontic_treatment_plans"
  ADD COLUMN IF NOT EXISTS "invoiceId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "orthodontic_treatment_plans_invoiceId_key"
  ON "orthodontic_treatment_plans" ("invoiceId");

ALTER TABLE "orthodontic_treatment_plans" DROP CONSTRAINT IF EXISTS "orthodontic_treatment_plans_invoiceId_fkey";
ALTER TABLE "orthodontic_treatment_plans"
  ADD CONSTRAINT "orthodontic_treatment_plans_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;


-- ── 3. El control es una cita (decisión 2) ──────────────────────────────
-- Liga la hoja de control (rediseño, con SOAP) con la cita real de Agenda
-- que la originó. Distinto de "controlAppointmentId" (que liga con el
-- control LEGACY, OrthodonticControlAppointment, no con Appointment). Una
-- cita ↔ una hoja como máximo (índice único). NULL = hoja sin cita ligada
-- (como hoy, todas).
ALTER TABLE "ortho_treatment_cards"
  ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ortho_treatment_cards_appointmentId_key"
  ON "ortho_treatment_cards" ("appointmentId");

ALTER TABLE "ortho_treatment_cards" DROP CONSTRAINT IF EXISTS "ortho_treatment_cards_appointmentId_fkey";
ALTER TABLE "ortho_treatment_cards"
  ADD CONSTRAINT "ortho_treatment_cards_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;


-- ── 4. Comprobación (solo lee) ───────────────────────────────────────────
-- Debe devolver 3 filas, una por columna nueva.
SELECT table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE (table_name = 'orthodontic_treatment_plans' AND column_name IN ('treatingDoctorId', 'invoiceId'))
   OR (table_name = 'ortho_treatment_cards' AND column_name = 'appointmentId')
ORDER BY table_name, column_name;
