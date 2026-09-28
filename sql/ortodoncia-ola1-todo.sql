-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — ORTODONCIA, TODO EL SQL DE LA OLA (Ola 0 + Ola 1),
-- consolidado por ws1-t1 al cerrar la ola para que Rafael lo pegue UNA
-- sola vez. Es una CONCATENACIÓN, en orden, de los 7 archivos originales
-- (que siguen en sql/, sin tocar salvo lo dicho abajo) — no reescribe su
-- contenido.
--
-- ORDEN Y POR QUÉ (no hay dependencias duras de FK entre archivos: los 7
-- solo referencian tablas que YA existían antes de esta ola — verificado
-- leyendo information_schema en producción, solo lectura, el 27-sep-2026;
-- el orden de abajo es por CLARIDAD de capas, de la más central a la más
-- periférica):
--   1. ortodoncia-nucleo.sql         (Ola 0 · núcleo: doctor tratante,
--                                     factura del caso, cita↔hoja de control)
--   2. ortodoncia-alta-caso.sql      (Ola 1 · Alta del caso: responsable de
--                                     pago, quién refirió, observación)
--   3. ortodoncia-control-agenda.sql (Ola 1 · Control y agenda: activaciones
--                                     e indicaciones de la hoja)
--   4. ortodoncia-cobro.sql          (Ola 1 · Cobro: factura extra ligada al
--                                     caso, política de cobro, promesas)
--   5. ortodoncia-configuracion.sql  (Ola 1 · Acceso y permisos: config del
--                                     submenú del módulo)
--   6. ortodoncia-cefalometria.sql   (Ola 1 · Imagen y análisis: trazado
--                                     cefalométrico + FileCategory nuevo)
--   7. ortodoncia-alineadores.sql    (Ola 1 · Alineadores y cumplimiento)
--
-- REVISADO (ws1-t1, encargo "SQL de la ola"): plano (sin DO $$), idempotente
-- (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS + ADD), aditivo (cero DROP
-- COLUMN/TABLE, cero UPDATE masivo) en los 7. Verificado contra producción,
-- SOLO LECTURA (información_schema, pg_type — ninguna escritura):
--   · Las 9 tablas nuevas de esta ola NO existen todavía (limpio para
--     aplicar). orthodontic_treatment_plans y ortho_treatment_cards: 0 filas
--     (nadie ha abierto un caso de ortodoncia todavía).
--   · Las tablas que los 7 archivos referencian por FK YA EXISTEN todas,
--     con una excepción que se corrigió en el original (ver abajo).
--
-- ARREGLADO EN EL ORIGINAL (ws1-t1, con aviso — no se tocó nada más de esa
-- pantalla): sql/ortodoncia-alta-caso.sql referenciaba `REFERENCES
-- "guardians"("id")`, pero el modelo Prisma "Guardian" tiene
-- `@@map("ped_guardians")` — la tabla "guardians" NO EXISTE (verificado).
-- Sin el arreglo, el ADD CONSTRAINT de responsibleGuardianId habría fallado
-- al pegar este archivo. Ya corregido a "ped_guardians" en el original.
--
-- PENDIENTE, NO ARREGLADO AQUÍ (dueña: ws1-t8 «Imagen y análisis» /
-- «Alineadores»; no es un archivo de esta parte y el arreglo real toca su
-- prisma/schema.prisma + el código que ya usa esos enums en TypeScript):
-- schema.prisma declara 8 ENUM nativos de Postgres nuevos para las tablas de
-- ws1-t8 (OrthoCephTracingKind, OrthoCephAnalysisType, OrthoCephNormSet,
-- OrthoAlignerStatus, OrthoAlignerEventType, OrthoElasticsSource,
-- OrthoMonitoringAngle, OrthoMonitoringReviewStatus), pero NINGÚN archivo
-- SQL de esta ola tiene un CREATE TYPE para ellos — las columnas de abajo
-- (kind, analysisType, normSet, status, eventType, source, angle,
-- reviewStatus) nacen como TEXT + CHECK, no como esos tipos ENUM.
-- Verificado en producción: ninguno de los 8 nombres existe hoy en pg_type.
-- PEGAR ESTE SQL ES SEGURO (las tablas se crean bien, es DDL plano); el
-- riesgo es DESPUÉS: en cuanto el código de ws1-t8 use Prisma Client para
-- leer/escribir esos campos como el enum que declara schema.prisma, Postgres
-- va a rechazar la consulta con "type ... does not exist" (Prisma intenta
-- castear al tipo nativo que su propio schema dice que existe). Antes de que
-- esa parte dependa de esos campos en producción, alguien tiene que resolver
-- la discrepancia — la opción más barata es cambiar esos 8 `enum` de
-- schema.prisma a `String` (para que coincida con el TEXT + CHECK real),
-- que es además el patrón que ya usan el resto de columnas "tipo enum"
-- añadidas a mano en esta ola (nunca declaradas como `enum` de Postgres).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar TODO → Run, una sola vez.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- ORIGEN: sql/ortodoncia-nucleo.sql
-- ═══════════════════════════════════════════════════════════════════════

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


-- ═══════════════════════════════════════════════════════════════════════
-- ORIGEN: sql/ortodoncia-alta-caso.sql
-- ═══════════════════════════════════════════════════════════════════════

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


-- ═══════════════════════════════════════════════════════════════════════
-- ORIGEN: sql/ortodoncia-control-agenda.sql
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T4 · ORTODONCIA OLA 1, «CONTROL Y AGENDA».
--
-- Dos columnas aditivas en "ortho_treatment_cards", pedidas por el
-- documento de alcance (REPORTE-ws1-t8.md):
--   C2) "activationsNote" — activaciones de la visita (vueltas de
--       expansor, resortes, arcos auxiliares). Texto libre, por visita.
--   C3) "indications"     — indicaciones para el paciente de esa visita
--       (elásticos, higiene, qué no comer, qué hacer si se despega un
--       bracket), separadas de la nota SOAP.P.
--
-- NO toca ni una fila que ya exista: las dos columnas nacen NULL, que es
-- "sin activaciones anotadas todavía" / "sin indicaciones propias todavía"
-- para cualquier hoja ya guardada.
--
-- IDEMPOTENTE: el bloque comprueba existencia antes de crear; correrlo
-- varias veces no da errores ni duplicados. CERO DROP de tablas o columnas.
-- PLANO: sin bloques DO (el SQL Editor de Rafael no los acepta).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
--
-- El código YA tolera que estas columnas aún no existan (P2021/P2022,
-- mismo patrón que sql/ortodoncia-nucleo.sql y cobranza-db.ts) — pegar
-- este SQL no es bloqueante para que dev.108 siga funcionando mientras
-- no se pega.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "ortho_treatment_cards"
  ADD COLUMN IF NOT EXISTS "activationsNote" TEXT;

ALTER TABLE "ortho_treatment_cards"
  ADD COLUMN IF NOT EXISTS "indications" TEXT;


-- ── Comprobación (solo lee) ───────────────────────────────────────────
-- Debe devolver 2 filas.
SELECT table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'ortho_treatment_cards'
  AND column_name IN ('activationsNote', 'indications')
ORDER BY column_name;


-- ═══════════════════════════════════════════════════════════════════════
-- ORIGEN: sql/ortodoncia-cobro.sql
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T1 · ORTODONCIA OLA 1, parte «Cobro» (F1-F13).
--
-- Cuatro piezas aditivas, todas nuevas (nada existente se toca):
--   1) "invoices"."orthodonticTreatmentPlanId" — liga una factura EXTRA
--      (F5: reposición, retenedor, microtornillo…) de vuelta al caso. La
--      factura PRINCIPAL del tratamiento sigue enlazada al revés, por
--      "orthodontic_treatment_plans"."invoiceId" (Ola 0, ya aplicado).
--   2) "orthodontic_billing_configs" — política de cobro POR CLÍNICA:
--      recargo por atraso (F10, apagado por default) y catálogo de reglas
--      de descuento (F9: contado/hermanos/pago puntual).
--   3) "orthodontic_case_billing" — datos financieros POR CASO que no le
--      tocan a "Alta del caso": cuántas reposiciones incluye el plan y
--      cuántas ya se usaron (F11), qué descuento se le aplicó (F9).
--   4) "orthodontic_payment_promises" — promesas de pago (F12).
--
-- PLANO: sin bloques DO (el SQL Editor de Rafael no los acepta).
-- IDEMPOTENTE: todo con IF NOT EXISTS; correrlo varias veces no falla.
-- NO usa Prisma Migrate ni toca prisma/schema.prisma a propósito: mismo
-- patrón que sql/factura-condiciones-pago.sql
-- (src/lib/invoices/condiciones-pago-db.ts) — SQL crudo + sonda
-- `to_regclass` en el código, así que ESTE archivo puede pegarse en
-- cualquier momento sin coordinarse con las otras pantallas que sí editan
-- schema.prisma en esta misma ola (Acceso y permisos, Alta del caso,
-- Control y agenda). El código YA tolera que estas tablas/columnas no
-- existan (P2021/P2022 / "no existe la tabla") — no tumba dev.108.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Factura extra del caso (F5) ──────────────────────────────────────
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "orthodonticTreatmentPlanId" TEXT;

CREATE INDEX IF NOT EXISTS "invoices_orthodonticTreatmentPlanId_idx"
  ON "invoices" ("orthodonticTreatmentPlanId");

ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_orthodonticTreatmentPlanId_fkey";
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_orthodonticTreatmentPlanId_fkey"
  FOREIGN KEY ("orthodonticTreatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;


-- ── 2. Política de cobro por clínica (F9 reglas de descuento, F10 recargo) ─
CREATE TABLE IF NOT EXISTS "orthodontic_billing_configs" (
  "clinicId"         TEXT PRIMARY KEY,
  "lateFeeEnabled"   BOOLEAN NOT NULL DEFAULT false,
  "lateFeeType"      TEXT NOT NULL DEFAULT 'PCT',
  "lateFeeValue"     NUMERIC NOT NULL DEFAULT 0,
  "lateFeeGraceDays" INTEGER NOT NULL DEFAULT 5,
  "discountRules"    JSONB NOT NULL DEFAULT '[]',
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "orthodontic_billing_configs" DROP CONSTRAINT IF EXISTS "orthodontic_billing_configs_clinicId_fkey";
ALTER TABLE "orthodontic_billing_configs"
  ADD CONSTRAINT "orthodontic_billing_configs_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


-- ── 3. Datos financieros del caso (F9 descuento elegido, F11 reposiciones) ─
CREATE TABLE IF NOT EXISTS "orthodontic_case_billing" (
  "treatmentPlanId"           TEXT PRIMARY KEY,
  "clinicId"                  TEXT NOT NULL,
  "includedReplacementsTotal" INTEGER NOT NULL DEFAULT 2,
  "includedReplacementsUsed"  INTEGER NOT NULL DEFAULT 0,
  "discountRuleId"            TEXT,
  "discountLabel"             TEXT,
  "discountPct"               NUMERIC,
  "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "orthodontic_case_billing" DROP CONSTRAINT IF EXISTS "orthodontic_case_billing_treatmentPlanId_fkey";
ALTER TABLE "orthodontic_case_billing"
  ADD CONSTRAINT "orthodontic_case_billing_treatmentPlanId_fkey"
  FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "orthodontic_case_billing_clinicId_idx"
  ON "orthodontic_case_billing" ("clinicId");


-- ── 4. Promesas de pago (F12) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "orthodontic_payment_promises" (
  "id"              TEXT PRIMARY KEY,
  "treatmentPlanId" TEXT NOT NULL,
  "clinicId"        TEXT NOT NULL,
  "amount"          NUMERIC NOT NULL,
  "promisedDate"    DATE NOT NULL,
  "note"            TEXT,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fulfilledAt"     TIMESTAMP(3),
  "cancelledAt"     TIMESTAMP(3)
);

ALTER TABLE "orthodontic_payment_promises" DROP CONSTRAINT IF EXISTS "orthodontic_payment_promises_treatmentPlanId_fkey";
ALTER TABLE "orthodontic_payment_promises"
  ADD CONSTRAINT "orthodontic_payment_promises_treatmentPlanId_fkey"
  FOREIGN KEY ("treatmentPlanId") REFERENCES "orthodontic_treatment_plans"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "orthodontic_payment_promises_treatmentPlanId_idx"
  ON "orthodontic_payment_promises" ("treatmentPlanId");
CREATE INDEX IF NOT EXISTS "orthodontic_payment_promises_clinicId_idx"
  ON "orthodontic_payment_promises" ("clinicId");


-- ── 5. Comprobación (solo lee) ───────────────────────────────────────────
SELECT table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE (table_name = 'invoices' AND column_name = 'orthodonticTreatmentPlanId')
   OR (table_name = 'orthodontic_billing_configs')
   OR (table_name = 'orthodontic_case_billing')
   OR (table_name = 'orthodontic_payment_promises')
ORDER BY table_name, column_name;


-- ═══════════════════════════════════════════════════════════════════════
-- ORIGEN: sql/ortodoncia-configuracion.sql
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T3 · ORTODONCIA OLA 1, «Acceso y permisos».
--
-- Tabla nueva, una fila por clínica: configuración del submenú
-- "Configuración" del módulo (doctor tratante por defecto, catálogo propio
-- de tipos de cita — C7 — y plantillas de mensaje).
--
-- IDEMPOTENTE: CREATE TABLE IF NOT EXISTS; correrlo varias veces no da
-- errores ni duplicados. ADITIVO: no toca ninguna tabla existente.
-- PLANO: sin bloques DO (el SQL Editor de Rafael no los acepta).
--
-- El código (src/lib/orthodontics/clinic-settings-db.ts) tolera que esta
-- tabla aún no exista (P2021) y devuelve los defaults del módulo — pegar
-- este SQL no es bloqueante para que dev.108 siga funcionando.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "orthodontics_clinic_settings" (
  "clinicId"                TEXT PRIMARY KEY,
  "defaultTreatingDoctorId" TEXT,
  "appointmentTypes"        JSONB,
  "messageTemplates"        JSONB,
  "updatedBy"               TEXT,
  "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT now()
);

-- Sin FK a "clinics"/"users" a propósito (mismo criterio que
-- "clinic_bank_accounts"): esos modelos los tocan varias pantallas a la vez
-- en esta ola. La corrección de "clinicId" la da la sesión (nunca el
-- cliente), igual que en el resto del panel.

-- ── Comprobación (solo lee) ───────────────────────────────────────────
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'orthodontics_clinic_settings'
ORDER BY ordinal_position;


-- ═══════════════════════════════════════════════════════════════════════
-- ORIGEN: sql/ortodoncia-cefalometria.sql
-- ═══════════════════════════════════════════════════════════════════════

-- Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026).
-- H1 cefalometría manual, H3 superposición antes/después, H4 normas
-- mexicanas. Aditivo e idempotente. SIN bloques DO (el editor SQL de
-- Rafael no los acepta). Pégalo tal cual en Supabase → SQL Editor.
--
-- NO lo aplica la terminal. El código tolera que esta tabla/columna todavía
-- no exista (P2021/P2022): mientras no se pegue, los paneles de H1/H3
-- muestran "aún no configurado" en vez de romper la ficha del paciente.

-- 1) Nueva categoría de archivo: radiografía lateral de cráneo. Distinta de
--    CEPH_ANALYSIS_PDF (que ya existe, para el PDF de trazado que entrega
--    el centro radiológico).
ALTER TYPE "FileCategory" ADD VALUE IF NOT EXISTS 'XRAY_CEPHALOMETRIC';

-- 2) Tabla de análisis cefalométricos. Un caso puede tener varios (inicial,
--    progreso, final) para la superposición de H3.
CREATE TABLE IF NOT EXISTS "orthodontic_cephalometry_analyses" (
  "id" TEXT PRIMARY KEY,
  "treatmentPlanId" TEXT NOT NULL REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE,
  "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL DEFAULT 'INITIAL',
  "analysisType" TEXT NOT NULL DEFAULT 'STEINER',
  "normSet" TEXT NOT NULL DEFAULT 'STANDARD',
  "points" JSONB NOT NULL DEFAULT '{}',
  "measurements" JSONB NOT NULL DEFAULT '{}',
  "calibrationMmPerPixel" DOUBLE PRECISION,
  "lateralXrayFileId" TEXT REFERENCES "patient_files"("id") ON DELETE SET NULL,
  "tracingPdfFileId" TEXT REFERENCES "patient_files"("id") ON DELETE SET NULL,
  "createdByUserId" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "orthodontic_cephalometry_analyses_treatmentPlanId_idx"
  ON "orthodontic_cephalometry_analyses" ("treatmentPlanId");
CREATE INDEX IF NOT EXISTS "orthodontic_cephalometry_analyses_clinicId_idx"
  ON "orthodontic_cephalometry_analyses" ("clinicId");
CREATE INDEX IF NOT EXISTS "orthodontic_cephalometry_analyses_patientId_idx"
  ON "orthodontic_cephalometry_analyses" ("patientId");

-- 3) Restricciones de valor (CHECK), idempotentes vía DROP + ADD.
ALTER TABLE "orthodontic_cephalometry_analyses"
  DROP CONSTRAINT IF EXISTS "orthodontic_cephalometry_analyses_kind_check";
ALTER TABLE "orthodontic_cephalometry_analyses"
  ADD CONSTRAINT "orthodontic_cephalometry_analyses_kind_check"
  CHECK ("kind" IN ('INITIAL', 'PROGRESS', 'FINAL'));

ALTER TABLE "orthodontic_cephalometry_analyses"
  DROP CONSTRAINT IF EXISTS "orthodontic_cephalometry_analyses_analysisType_check";
ALTER TABLE "orthodontic_cephalometry_analyses"
  ADD CONSTRAINT "orthodontic_cephalometry_analyses_analysisType_check"
  CHECK ("analysisType" IN ('STEINER', 'RICKETTS', 'MCNAMARA'));

ALTER TABLE "orthodontic_cephalometry_analyses"
  DROP CONSTRAINT IF EXISTS "orthodontic_cephalometry_analyses_normSet_check";
ALTER TABLE "orthodontic_cephalometry_analyses"
  ADD CONSTRAINT "orthodontic_cephalometry_analyses_normSet_check"
  CHECK ("normSet" IN ('STANDARD', 'MEXICAN'));


-- ═══════════════════════════════════════════════════════════════════════
-- ORIGEN: sql/ortodoncia-alineadores.sql
-- ═══════════════════════════════════════════════════════════════════════

-- Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026).
-- H12 seguimiento de alineadores, H14 cumplimiento de elásticos/horas de
-- uso, H15 monitoreo a distancia con fotos del paciente. Aditivo e
-- idempotente. SIN bloques DO. Pégalo tal cual en Supabase → SQL Editor.
--
-- NO lo aplica la terminal. El código tolera que estas tablas todavía no
-- existan (P2021/P2022): los paneles muestran "aún no configurado" en vez
-- de romper la ficha o el portal del paciente.

-- 1) Caso de alineadores: número actual/total, intervalo de cambio,
--    attachments, refinamientos.
CREATE TABLE IF NOT EXISTS "orthodontic_aligners" (
  "id" TEXT PRIMARY KEY,
  "treatmentPlanId" TEXT NOT NULL UNIQUE REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE,
  "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "systemName" TEXT,
  "totalTrays" INTEGER NOT NULL,
  "currentTray" INTEGER NOT NULL DEFAULT 1,
  "changeIntervalDays" INTEGER NOT NULL DEFAULT 14,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "attachmentsPlaced" INTEGER,
  "attachmentsLost" INTEGER NOT NULL DEFAULT 0,
  "refinementCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "orthodontic_aligners_clinicId_idx" ON "orthodontic_aligners" ("clinicId");
ALTER TABLE "orthodontic_aligners" DROP CONSTRAINT IF EXISTS "orthodontic_aligners_status_check";
ALTER TABLE "orthodontic_aligners" ADD CONSTRAINT "orthodontic_aligners_status_check"
  CHECK ("status" IN ('ACTIVE', 'PAUSED', 'FINISHED'));

-- 2) Bitácora de eventos del caso de alineadores (entregas, refinamientos,
--    cambios manuales, attachments).
CREATE TABLE IF NOT EXISTS "orthodontic_aligner_events" (
  "id" TEXT PRIMARY KEY,
  "alignerId" TEXT NOT NULL REFERENCES "orthodontic_aligners"("id") ON DELETE CASCADE,
  "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "eventType" TEXT NOT NULL,
  "trayNumber" INTEGER,
  "quantity" INTEGER,
  "notes" TEXT,
  "createdByUserId" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "orthodontic_aligner_events_alignerId_idx" ON "orthodontic_aligner_events" ("alignerId");
ALTER TABLE "orthodontic_aligner_events" DROP CONSTRAINT IF EXISTS "orthodontic_aligner_events_eventType_check";
ALTER TABLE "orthodontic_aligner_events" ADD CONSTRAINT "orthodontic_aligner_events_eventType_check"
  CHECK ("eventType" IN ('DELIVERY', 'REFINEMENT', 'TRAY_CHANGE', 'ATTACHMENT_PLACED', 'ATTACHMENT_LOST', 'PAUSE', 'RESUME'));

-- 3) Registro diario de cumplimiento de elásticos/alineador (H14). Un
--    registro por día — upsert desde el portal del paciente o captura
--    manual de recepción si el paciente no usa el portal.
CREATE TABLE IF NOT EXISTS "orthodontic_elastics_logs" (
  "id" TEXT PRIMARY KEY,
  "treatmentPlanId" TEXT NOT NULL REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE,
  "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "logDate" DATE NOT NULL,
  "wornHours" DOUBLE PRECISION,
  "usedElastics" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL DEFAULT 'PATIENT_PORTAL',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  UNIQUE ("treatmentPlanId", "logDate")
);
CREATE INDEX IF NOT EXISTS "orthodontic_elastics_logs_treatmentPlanId_idx" ON "orthodontic_elastics_logs" ("treatmentPlanId");
ALTER TABLE "orthodontic_elastics_logs" DROP CONSTRAINT IF EXISTS "orthodontic_elastics_logs_source_check";
ALTER TABLE "orthodontic_elastics_logs" ADD CONSTRAINT "orthodontic_elastics_logs_source_check"
  CHECK ("source" IN ('PATIENT_PORTAL', 'CLINIC_MANUAL'));

-- 4) Fotos de monitoreo remoto que el paciente sube desde el portal (H15).
--    Sin análisis de IA (fuera de alcance de esta ola): solo captura +
--    revisión humana. Guarda su propio storageKey (mismo patrón que
--    patient_uploads), no reusa patient_files (esa es de subida clínica).
CREATE TABLE IF NOT EXISTS "orthodontic_monitoring_photos" (
  "id" TEXT PRIMARY KEY,
  "treatmentPlanId" TEXT NOT NULL REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE,
  "patientId" TEXT NOT NULL REFERENCES "patients"("id") ON DELETE CASCADE,
  "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "angle" TEXT NOT NULL DEFAULT 'OTHER',
  "patientNote" TEXT,
  "doctorNote" TEXT,
  "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedByUserId" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "orthodontic_monitoring_photos_treatmentPlanId_idx" ON "orthodontic_monitoring_photos" ("treatmentPlanId");
CREATE INDEX IF NOT EXISTS "orthodontic_monitoring_photos_clinicId_reviewStatus_idx" ON "orthodontic_monitoring_photos" ("clinicId", "reviewStatus");
ALTER TABLE "orthodontic_monitoring_photos" DROP CONSTRAINT IF EXISTS "orthodontic_monitoring_photos_angle_check";
ALTER TABLE "orthodontic_monitoring_photos" ADD CONSTRAINT "orthodontic_monitoring_photos_angle_check"
  CHECK ("angle" IN ('FRONTAL', 'LATERAL', 'SMILE', 'INTRAORAL', 'OTHER'));
ALTER TABLE "orthodontic_monitoring_photos" DROP CONSTRAINT IF EXISTS "orthodontic_monitoring_photos_reviewStatus_check";
ALTER TABLE "orthodontic_monitoring_photos" ADD CONSTRAINT "orthodontic_monitoring_photos_reviewStatus_check"
  CHECK ("reviewStatus" IN ('PENDING', 'REVIEWED', 'FLAGGED'));


-- ═══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN FINAL (solo lee) — corre esto último para confirmar que
-- todo quedó aplicado. Cada fila de "esperado" debería aparecer.
-- ═══════════════════════════════════════════════════════════════════════
SELECT 'tabla' AS tipo, table_name AS nombre
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN (
  'orthodontic_billing_configs', 'orthodontic_case_billing', 'orthodontic_payment_promises',
  'orthodontics_clinic_settings', 'orthodontic_cephalometry_analyses', 'orthodontic_aligners',
  'orthodontic_aligner_events', 'orthodontic_elastics_logs', 'orthodontic_monitoring_photos'
)
UNION ALL
SELECT 'columna', table_name || '.' || column_name
FROM information_schema.columns
WHERE (table_name = 'orthodontic_treatment_plans' AND column_name IN ('treatingDoctorId', 'invoiceId', 'responsibleGuardianId'))
   OR (table_name = 'ortho_treatment_cards' AND column_name IN ('appointmentId', 'activationsNote', 'indications'))
   OR (table_name = 'orthodontic_diagnoses' AND column_name IN ('referredByDoctorId', 'inObservation', 'nextObservationDate'))
   OR (table_name = 'invoices' AND column_name = 'orthodonticTreatmentPlanId')
UNION ALL
SELECT 'enum_value', 'FileCategory.XRAY_CEPHALOMETRIC'
FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'FileCategory' AND e.enumlabel = 'XRAY_CEPHALOMETRIC'
ORDER BY 1, 2;
