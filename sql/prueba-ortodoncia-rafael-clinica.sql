-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T2 · ORTODONCIA, PACIENTES DE PRUEBA para
-- «Rafael Clinica» (id cmn6soeaw0000t17xgljxc2iq).
--
-- Pedido de Rafael: "generame unos pacientes de ortodoncia de prueba para
-- ver en rafael clinica". Los 8 pacientes de abajo cubren cada estado y
-- pantalla del módulo — el mapa paciente → pantalla está en
-- REPORTE-ws1-t2.md, no aquí (este archivo es solo el SQL).
--
-- SEGURO DE WHATSAPP: "phone"/"email" quedan NULL en los 8 pacientes.
-- Verificado leyendo el código: src/lib/reminders/enqueue.ts:287
-- (`if (appt.patient.phone)`) y src/lib/whatsapp/cobranza/core.ts:227-228
-- descartan cualquier recordatorio sin teléfono ANTES de encolar nada; y el
-- envío automático propio del módulo de ortodoncia está apagado por completo
-- (`ORTHO_WHATSAPP_ENQUEUE_ENABLED = false`, src/lib/orthodontics/whatsapp-queue.ts).
-- Ningún pago usa Mercado Pago/Stripe (todos "cash"/manuales) y "cfdiUuid"
-- de las 7 facturas queda NULL — el timbrado es un endpoint aparte
-- (/api/cfdi) que nada de este SQL invoca.
--
-- Doctores REALES de "Rafael Clinica" (leídos en solo lectura, SET
-- TRANSACTION READ ONLY, el 28-sep-2026 — ver REPORTE-ws1-t2.md):
--   Jorge Garcia   → cmp3e6l1x0003rp6e9lda5fxe (DOCTOR)
--   Jorge Martinez → cmrf8vfvq000sorq8ut1pdz08 (DOCTOR)
-- Módulo de ortodoncia YA activo en esta clínica (clinic_modules, status
-- active hasta 2099) — este SQL no lo toca.
--
-- IDEMPOTENTE: todos los ids llevan el prefijo 'prueba-orto-' e insertan con
-- ON CONFLICT DO NOTHING — pegarlo dos veces no duplica nada. ADITIVO: cero
-- UPDATE/DELETE de cualquier fila que no sea la de este propio SQL. PLANO:
-- sin bloques DO $$. Probado antes de entregarlo contra una base local con
-- el esquema real (ver REPORTE-ws1-t2.md, "Cómo se probó").
--
-- Orden de inserción: pacientes → responsable de pago → diagnósticos →
-- facturas + condiciones de pago → planes de tratamiento (referencian la
-- factura) → arcos → citas de Agenda → hojas de control (referencian arcos
-- y citas) → pagos → promesa de pago → alineadores → cefalometría.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Pacientes (8) — SIN teléfono ni correo real a propósito ─────────
INSERT INTO "patients" ("id", "clinicId", "patientNumber", "firstName", "lastName", "email", "phone", "dob", "gender", "status", "isChild", "notes", "visibleUserIds", "createdAt", "updatedAt")
VALUES
  ('prueba-orto-pac-01', 'cmn6soeaw0000t17xgljxc2iq', 'PRUEBA-ORTO-01', 'PRUEBA Orto – Sofía', 'Martínez', NULL, NULL, '1998-03-14', 'F', 'ACTIVE', false, 'Paciente de PRUEBA para revisar el módulo de Ortodoncia (ws1-t2, sep-2026). Sin teléfono/correo real a propósito.', '{}', NOW(), NOW()),
  ('prueba-orto-pac-02', 'cmn6soeaw0000t17xgljxc2iq', 'PRUEBA-ORTO-02', 'PRUEBA Orto – Diego', 'Hernández', NULL, NULL, '1995-07-02', 'M', 'ACTIVE', false, 'Paciente de PRUEBA para revisar el módulo de Ortodoncia (ws1-t2, sep-2026). Sin teléfono/correo real a propósito.', '{}', NOW(), NOW()),
  ('prueba-orto-pac-03', 'cmn6soeaw0000t17xgljxc2iq', 'PRUEBA-ORTO-03', 'PRUEBA Orto – Camila', 'Torres', NULL, NULL, '2001-11-20', 'F', 'ACTIVE', false, 'Paciente de PRUEBA para revisar el módulo de Ortodoncia (ws1-t2, sep-2026). Sin teléfono/correo real a propósito.', '{}', NOW(), NOW()),
  ('prueba-orto-pac-04', 'cmn6soeaw0000t17xgljxc2iq', 'PRUEBA-ORTO-04', 'PRUEBA Orto – Mateo', 'López', NULL, NULL, '1993-05-09', 'M', 'ACTIVE', false, 'Paciente de PRUEBA para revisar el módulo de Ortodoncia (ws1-t2, sep-2026). Sin teléfono/correo real a propósito.', '{}', NOW(), NOW()),
  ('prueba-orto-pac-05', 'cmn6soeaw0000t17xgljxc2iq', 'PRUEBA-ORTO-05', 'PRUEBA Orto – Valentina', 'Ramírez', NULL, NULL, '1990-01-30', 'F', 'ACTIVE', false, 'Paciente de PRUEBA para revisar el módulo de Ortodoncia (ws1-t2, sep-2026). Sin teléfono/correo real a propósito.', '{}', NOW(), NOW()),
  ('prueba-orto-pac-06', 'cmn6soeaw0000t17xgljxc2iq', 'PRUEBA-ORTO-06', 'PRUEBA Orto – Emiliano', 'Cruz', NULL, NULL, '1988-09-12', 'M', 'ACTIVE', false, 'Paciente de PRUEBA para revisar el módulo de Ortodoncia (ws1-t2, sep-2026). Sin teléfono/correo real a propósito.', '{}', NOW(), NOW()),
  ('prueba-orto-pac-07', 'cmn6soeaw0000t17xgljxc2iq', 'PRUEBA-ORTO-07', 'PRUEBA Orto – Isabella', 'Flores', NULL, NULL, '1997-04-25', 'F', 'ACTIVE', false, 'Paciente de PRUEBA para revisar el módulo de Ortodoncia (ws1-t2, sep-2026). Sin teléfono/correo real a propósito.', '{}', NOW(), NOW()),
  ('prueba-orto-pac-08', 'cmn6soeaw0000t17xgljxc2iq', 'PRUEBA-ORTO-08', 'PRUEBA Orto – Benjamín', 'Ortiz', NULL, NULL, '2016-03-10', 'M', 'ACTIVE', false, 'Paciente de PRUEBA para revisar el módulo de Ortodoncia (ws1-t2, sep-2026). Sin teléfono/correo real a propósito.', '{}', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- ── 2. Responsable de pago del menor (Guardian / ped_guardians) ────────
INSERT INTO "ped_guardians" ("id", "clinicId", "patientId", "fullName", "parentesco", "birthDate", "phone", "email", "esResponsableLegal", "principal", "createdBy", "createdAt", "updatedAt")
VALUES
  ('prueba-orto-guardian-08', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-08', 'PRUEBA Orto – Responsable de Benjamín (madre)', 'madre', '1988-06-01', '0000000000', NULL, true, true, 'cmp3e6l1x0003rp6e9lda5fxe', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- ── 3. Diagnósticos (8) — orthodontic_diagnoses ─────────────────────────
INSERT INTO "orthodontic_diagnoses" ("id", "patientId", "clinicId", "diagnosedById", "diagnosedAt", "angleClassRight", "angleClassLeft", "overbiteMm", "overbitePercentage", "overjetMm", "crossbite", "openBite", "crowdingUpperMm", "crowdingLowerMm", "etiologySkeletal", "etiologyDental", "etiologyFunctional", "habits", "habitsDescription", "dentalPhase", "skeletalPattern", "tmjPainPresent", "tmjClickingPresent", "clinicalSummary", "inObservation", "nextObservationDate", "createdAt", "updatedAt")
VALUES
  ('prueba-orto-dx-01', 'prueba-orto-pac-01', 'cmn6soeaw0000t17xgljxc2iq', 'cmp3e6l1x0003rp6e9lda5fxe', '2026-09-20', 'CLASS_I', 'CLASS_I', 3, 30, 2.5, false, false, NULL, NULL, false, false, false, '{}', NULL, 'PERMANENT', 'MESOFACIAL', false, false, 'Paciente en valoración inicial. Mordida clase I leve, sin apiñamiento significativo. Se decide observación periódica antes de indicar aparatología.', true, '2026-11-15', '2026-09-20', NOW()),
  ('prueba-orto-dx-02', 'prueba-orto-pac-02', 'cmn6soeaw0000t17xgljxc2iq', 'cmp3e6l1x0003rp6e9lda5fxe', '2026-09-20', 'CLASS_II_DIV_1', 'CLASS_II_DIV_1', 5, 60, 6, false, false, 3, 2, false, false, false, '{}', NULL, 'PERMANENT', 'MESOFACIAL', false, false, 'Clase II división 1 con resalte aumentado y apiñamiento leve bimaxilar. Se indica tratamiento con brackets metálicos.', false, NULL, '2026-09-20', NOW()),
  ('prueba-orto-dx-03', 'prueba-orto-pac-03', 'cmn6soeaw0000t17xgljxc2iq', 'cmp3e6l1x0003rp6e9lda5fxe', '2026-02-10', 'CLASS_I', 'CLASS_I', 2, 20, 2, false, false, 4, 3, false, false, false, '{}', NULL, 'PERMANENT', 'MESOFACIAL', false, false, 'Apiñamiento moderado bimaxilar sin discrepancia esquelética. Tratamiento con brackets autoligado metálico.', false, NULL, '2026-02-10', NOW()),
  ('prueba-orto-dx-04', 'prueba-orto-pac-04', 'cmn6soeaw0000t17xgljxc2iq', 'cmrf8vfvq000sorq8ut1pdz08', '2026-05-15', 'CLASS_II_DIV_2', 'CLASS_II_DIV_1', 6, 70, 3, false, false, 1, 1, false, false, false, '{}', NULL, 'PERMANENT', 'BRAQUIFACIAL', false, false, 'Clase II asimétrica (subdivisión) con sobremordida profunda. Preferencia estética del paciente: tratamiento con alineadores transparentes.', false, NULL, '2026-05-15', NOW()),
  ('prueba-orto-dx-05', 'prueba-orto-pac-05', 'cmn6soeaw0000t17xgljxc2iq', 'cmp3e6l1x0003rp6e9lda5fxe', '2025-01-10', 'CLASS_III', 'CLASS_III', 1, 10, -1, false, false, NULL, NULL, false, false, false, '{}', NULL, 'PERMANENT', 'DOLICOFACIAL', false, false, 'Clase III dentoalveolar compensada ortodóncicamente. Aparatología ya retirada; actualmente en fase de retención.', false, NULL, '2025-01-10', NOW()),
  ('prueba-orto-dx-06', 'prueba-orto-pac-06', 'cmn6soeaw0000t17xgljxc2iq', 'cmp3e6l1x0003rp6e9lda5fxe', '2024-09-15', 'CLASS_I', 'CLASS_I', 2.5, 25, 2, false, false, 2, 2, false, false, false, '{}', NULL, 'PERMANENT', 'MESOFACIAL', false, false, 'Apiñamiento leve bimaxilar, resuelto. Tratamiento concluido satisfactoriamente este mes.', false, NULL, '2024-09-15', NOW()),
  ('prueba-orto-dx-07', 'prueba-orto-pac-07', 'cmn6soeaw0000t17xgljxc2iq', 'cmrf8vfvq000sorq8ut1pdz08', '2026-04-15', 'CLASS_II_DIV_1', 'CLASS_I', 4, 45, 4.5, false, false, 2, 1, false, false, false, '{}', NULL, 'PERMANENT', 'MESOFACIAL', false, false, 'Clase II subdivisión derecha. Tratamiento en pausa temporal solicitada por la paciente (viaje prolongado).', false, NULL, '2026-04-15', NOW()),
  ('prueba-orto-dx-08', 'prueba-orto-pac-08', 'cmn6soeaw0000t17xgljxc2iq', 'cmp3e6l1x0003rp6e9lda5fxe', '2026-07-20', 'CLASS_I', 'CLASS_I', 3.5, 35, 3, false, false, NULL, NULL, false, false, false, '{DIGITAL_SUCKING}', 'Succión digital residual, frecuencia en disminución según refiere la madre.', 'MIXED_LATE', 'MESOFACIAL', false, false, 'Paciente pediátrico en dentición mixta tardía. Succión digital residual en disminución. Tratamiento interceptivo con brackets parciales, responsable de pago: madre.', false, NULL, '2026-07-20', NOW())
ON CONFLICT ("id") DO NOTHING;

-- ── 4. Facturas del tratamiento (invoices) — SIN Mercado Pago/Stripe ────
-- "cfdiUuid" queda NULL en las 7: nada de este SQL timbra nada.
INSERT INTO "invoices" ("id", "clinicId", "patientId", "invoiceNumber", "items", "subtotal", "discount", "total", "paid", "balance", "status", "paymentMethod", "notes", "doctorId", "taxRate", "taxIncluded", "cfdiUuid", "paidAt", "createdAt", "updatedAt")
VALUES
  ('prueba-orto-inv-02', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-02', 'PRUEBA-ORTO-0002', '[{"description":"Tratamiento de ortodoncia — brackets metálicos","quantity":1,"unitPrice":35000,"total":35000}]'::jsonb, 35000, 0, 35000, 10000, 25000, 'PARTIAL', 'cash', 'Factura de PRUEBA (ws1-t2) — pagos manuales en efectivo, sin CFDI.', 'cmp3e6l1x0003rp6e9lda5fxe', 16, true, NULL, NULL, '2026-09-23', NOW()),
  ('prueba-orto-inv-03', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-03', 'PRUEBA-ORTO-0003', '[{"description":"Tratamiento de ortodoncia — brackets autoligado metálico","quantity":1,"unitPrice":38000,"total":38000}]'::jsonb, 38000, 0, 38000, 20000, 18000, 'PARTIAL', 'cash', 'Factura de PRUEBA (ws1-t2) — pagos manuales en efectivo, sin CFDI.', 'cmp3e6l1x0003rp6e9lda5fxe', 16, true, NULL, NULL, '2026-02-28', NOW()),
  ('prueba-orto-inv-04', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-04', 'PRUEBA-ORTO-0004', '[{"description":"Tratamiento de ortodoncia — alineadores transparentes","quantity":1,"unitPrice":45000,"total":45000}]'::jsonb, 45000, 0, 45000, 18000, 27000, 'PARTIAL', 'cash', 'Factura de PRUEBA (ws1-t2) — pagos manuales en efectivo, sin CFDI.', 'cmrf8vfvq000sorq8ut1pdz08', 16, true, NULL, NULL, '2026-05-28', NOW()),
  ('prueba-orto-inv-05', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-05', 'PRUEBA-ORTO-0005', '[{"description":"Tratamiento de ortodoncia — brackets metálicos","quantity":1,"unitPrice":40000,"total":40000}]'::jsonb, 40000, 0, 40000, 36000, 4000, 'PARTIAL', 'cash', 'Factura de PRUEBA (ws1-t2) — pagos manuales en efectivo, sin CFDI.', 'cmp3e6l1x0003rp6e9lda5fxe', 16, true, NULL, NULL, '2025-01-28', NOW()),
  ('prueba-orto-inv-06', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-06', 'PRUEBA-ORTO-0006', '[{"description":"Tratamiento de ortodoncia — brackets cerámicos","quantity":1,"unitPrice":36000,"total":36000}]'::jsonb, 36000, 0, 36000, 36000, 0, 'PAID', 'cash', 'Factura de PRUEBA (ws1-t2) — pagos manuales en efectivo, sin CFDI.', 'cmp3e6l1x0003rp6e9lda5fxe', 16, true, NULL, '2024-09-28', '2024-09-28', NOW()),
  ('prueba-orto-inv-07', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-07', 'PRUEBA-ORTO-0007', '[{"description":"Tratamiento de ortodoncia — brackets metálicos","quantity":1,"unitPrice":32000,"total":32000}]'::jsonb, 32000, 0, 32000, 24000, 8000, 'PARTIAL', 'cash', 'Factura de PRUEBA (ws1-t2) — pagos manuales en efectivo, sin CFDI.', 'cmrf8vfvq000sorq8ut1pdz08', 16, true, NULL, NULL, '2026-04-28', NOW()),
  ('prueba-orto-inv-08', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-08', 'PRUEBA-ORTO-0008', '[{"description":"Tratamiento de ortodoncia — brackets metálicos (interceptivo)","quantity":1,"unitPrice":30000,"total":30000}]'::jsonb, 30000, 0, 30000, 10000, 20000, 'PARTIAL', 'cash', 'Factura de PRUEBA (ws1-t2) — pagos manuales en efectivo, sin CFDI.', 'cmp3e6l1x0003rp6e9lda5fxe', 16, true, NULL, NULL, '2026-07-28', NOW())
ON CONFLICT ("id") DO NOTHING;

-- ── 5. Condiciones de pago a plazos (invoice_payment_terms) ─────────────
-- El estado "vencida"/"al corriente" NO se guarda: lo deriva
-- src/lib/invoices/plan-de-pagos.ts de esto + "payments" en cada lectura.
INSERT INTO "invoice_payment_terms" ("invoiceId", "modo", "metodo", "enganche", "numPagos", "frecuencia", "primerPago", "difiereConSuBanco", "createdAt", "updatedAt")
VALUES
  ('prueba-orto-inv-02', 'plazos', 'cash', 10000, 10, 'MONTHLY', '2026-09-23', false, '2026-09-23', NOW()),
  ('prueba-orto-inv-03', 'plazos', 'cash', 8000, 15, 'MONTHLY', '2026-02-28', false, '2026-02-28', NOW()),
  ('prueba-orto-inv-04', 'plazos', 'cash', 15000, 10, 'MONTHLY', '2026-05-28', false, '2026-05-28', NOW()),
  ('prueba-orto-inv-05', 'plazos', 'cash', 10000, 15, 'MONTHLY', '2025-01-28', false, '2025-01-28', NOW()),
  ('prueba-orto-inv-06', 'plazos', 'cash', 6000, 15, 'MONTHLY', '2024-09-28', false, '2024-09-28', NOW()),
  ('prueba-orto-inv-07', 'plazos', 'cash', 6000, 13, 'MONTHLY', '2026-04-28', false, '2026-04-28', NOW()),
  ('prueba-orto-inv-08', 'plazos', 'cash', 8000, 11, 'MONTHLY', '2026-07-28', false, '2026-07-28', NOW())
ON CONFLICT ("invoiceId") DO NOTHING;

-- ── 6. Planes de tratamiento (7) — orthodontic_treatment_plans ──────────
INSERT INTO "orthodontic_treatment_plans" ("id", "diagnosisId", "patientId", "clinicId", "technique", "estimatedDurationMonths", "startDate", "installedAt", "totalCostMxn", "anchorageType", "extractionsRequired", "extractionsTeethFdi", "iprRequired", "tadsRequired", "treatmentObjectives", "retentionPlanText", "status", "statusUpdatedAt", "onHoldReason", "onHoldStartedAt", "treatingDoctorId", "invoiceId", "responsibleGuardianId", "createdAt", "updatedAt")
VALUES
  ('prueba-orto-plan-02', 'prueba-orto-dx-02', 'prueba-orto-pac-02', 'cmn6soeaw0000t17xgljxc2iq', 'METAL_BRACKETS', 24, '2026-09-23', NULL, 35000, 'MODERATE', false, '{}', false, false, 'AESTHETIC_AND_FUNCTIONAL', 'Retenedores fijos 3-3 + Essix superior/inferior nocturno al finalizar fase activa.', 'PLANNED', '2026-09-23', NULL, NULL, 'cmp3e6l1x0003rp6e9lda5fxe', 'prueba-orto-inv-02', NULL, '2026-09-23', NOW()),
  ('prueba-orto-plan-03', 'prueba-orto-dx-03', 'prueba-orto-pac-03', 'cmn6soeaw0000t17xgljxc2iq', 'SELF_LIGATING_METAL', 18, '2026-02-15', '2026-02-28', 38000, 'MODERATE', false, '{}', false, false, 'AESTHETIC_AND_FUNCTIONAL', 'Retenedores Essix superior e inferior, uso nocturno indefinido.', 'IN_PROGRESS', '2026-02-28', NULL, NULL, 'cmp3e6l1x0003rp6e9lda5fxe', 'prueba-orto-inv-03', NULL, '2026-02-15', NOW()),
  ('prueba-orto-plan-04', 'prueba-orto-dx-04', 'prueba-orto-pac-04', 'cmn6soeaw0000t17xgljxc2iq', 'CLEAR_ALIGNERS', 14, '2026-05-20', '2026-05-28', 45000, 'MINIMUM', false, '{}', false, false, 'AESTHETIC_ONLY', 'Alineador de retención nocturno indefinido tras terminar la serie activa.', 'IN_PROGRESS', '2026-05-28', NULL, NULL, 'cmrf8vfvq000sorq8ut1pdz08', 'prueba-orto-inv-04', NULL, '2026-05-20', NOW()),
  ('prueba-orto-plan-05', 'prueba-orto-dx-05', 'prueba-orto-pac-05', 'cmn6soeaw0000t17xgljxc2iq', 'METAL_BRACKETS', 18, '2025-01-15', '2025-01-28', 40000, 'MAXIMUM', false, '{}', false, false, 'AESTHETIC_AND_FUNCTIONAL', 'Retenedor fijo 3-3 inferior + Essix superior nocturno por 12 meses.', 'RETENTION', '2026-06-01', NULL, NULL, 'cmp3e6l1x0003rp6e9lda5fxe', 'prueba-orto-inv-05', NULL, '2025-01-15', NOW()),
  ('prueba-orto-plan-06', 'prueba-orto-dx-06', 'prueba-orto-pac-06', 'cmn6soeaw0000t17xgljxc2iq', 'CERAMIC_BRACKETS', 24, '2024-09-20', '2024-09-28', 36000, 'MODERATE', false, '{}', false, false, 'AESTHETIC_AND_FUNCTIONAL', 'Retenedores Essix superior e inferior, uso nocturno indefinido.', 'COMPLETED', '2026-09-15', NULL, NULL, 'cmp3e6l1x0003rp6e9lda5fxe', 'prueba-orto-inv-06', NULL, '2024-09-20', NOW()),
  ('prueba-orto-plan-07', 'prueba-orto-dx-07', 'prueba-orto-pac-07', 'cmn6soeaw0000t17xgljxc2iq', 'METAL_BRACKETS', 20, '2026-04-20', '2026-04-28', 32000, 'MODERATE', false, '{}', false, false, 'AESTHETIC_AND_FUNCTIONAL', 'Por definir al reanudar el tratamiento.', 'ON_HOLD', '2026-08-28', 'Paciente solicitó pausa por viaje prolongado; retoma en cuanto regrese.', '2026-08-28', 'cmrf8vfvq000sorq8ut1pdz08', 'prueba-orto-inv-07', NULL, '2026-04-20', NOW()),
  ('prueba-orto-plan-08', 'prueba-orto-dx-08', 'prueba-orto-pac-08', 'cmn6soeaw0000t17xgljxc2iq', 'METAL_BRACKETS', 10, '2026-07-25', '2026-07-28', 30000, 'MODERATE', false, '{}', false, false, 'FUNCTIONAL_ONLY', 'Reevaluación al completar la erupción de los permanentes.', 'IN_PROGRESS', '2026-07-28', NULL, NULL, 'cmp3e6l1x0003rp6e9lda5fxe', 'prueba-orto-inv-08', 'prueba-orto-guardian-08', '2026-07-25', NOW())
ON CONFLICT ("id") DO NOTHING;

-- ── 7. Arcos / secuencia de wires (ortho_wire_steps) — para "arco actual" ─
INSERT INTO "ortho_wire_steps" ("id", "treatmentPlanId", "clinicId", "orderIndex", "phaseKey", "material", "shape", "gauge", "archUpper", "archLower", "durationWeeks", "auxiliaries", "status", "plannedDate", "appliedDate", "completedDate", "createdAt", "updatedAt")
VALUES
  ('prueba-orto-wire-03-01', 'prueba-orto-plan-03', 'cmn6soeaw0000t17xgljxc2iq', 1, 'ALIGNMENT', 'NITI', 'ROUND', '0.014', true, true, 8, '{}', 'COMPLETED', '2026-02-28', '2026-02-28', '2026-04-28', '2026-02-28', NOW()),
  ('prueba-orto-wire-03-02', 'prueba-orto-plan-03', 'cmn6soeaw0000t17xgljxc2iq', 2, 'ALIGNMENT', 'NITI', 'ROUND', '0.016', true, true, 8, '{}', 'COMPLETED', '2026-04-28', '2026-04-28', '2026-06-28', '2026-04-28', NOW()),
  ('prueba-orto-wire-03-03', 'prueba-orto-plan-03', 'cmn6soeaw0000t17xgljxc2iq', 3, 'LEVELING', 'SS', 'RECT', '16x22', true, true, 8, '{}', 'COMPLETED', '2026-06-28', '2026-06-28', '2026-08-28', '2026-06-28', NOW()),
  ('prueba-orto-wire-03-04', 'prueba-orto-plan-03', 'cmn6soeaw0000t17xgljxc2iq', 4, 'LEVELING', 'SS', 'RECT', '19x25', true, true, 10, '{}', 'ACTIVE', '2026-08-28', '2026-08-28', NULL, '2026-08-28', NOW()),
  ('prueba-orto-wire-07-01', 'prueba-orto-plan-07', 'cmn6soeaw0000t17xgljxc2iq', 1, 'ALIGNMENT', 'NITI', 'ROUND', '0.016', true, true, 8, '{}', 'ACTIVE', '2026-08-28', '2026-08-28', NULL, '2026-08-28', NOW()),
  ('prueba-orto-wire-08-01', 'prueba-orto-plan-08', 'cmn6soeaw0000t17xgljxc2iq', 1, 'ALIGNMENT', 'NITI', 'ROUND', '0.014', true, true, 8, '{}', 'ACTIVE', '2026-07-28', '2026-07-28', NULL, '2026-07-28', NOW())
ON CONFLICT ("id") DO NOTHING;

-- ── 8. Citas de Agenda tipo "Control de ortodoncia" (decisión 2) ────────
-- HOY (paciente 03), futuras (02/04/05/08), no-show pasado (04), y el
-- paciente 07 se deja SIN cita futura a propósito (alerta L2).
INSERT INTO "appointments" ("id", "clinicId", "patientId", "doctorId", "type", "startsAt", "endsAt", "status", "notes", "createdAt", "updatedAt")
VALUES
  ('prueba-orto-appt-03-01', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-03', 'cmp3e6l1x0003rp6e9lda5fxe', 'Control de ortodoncia', '2026-04-28T15:00:00-06:00', '2026-04-28T15:30:00-06:00', 'COMPLETED', 'Cita de PRUEBA (ws1-t2) — paciente sin teléfono, no dispara recordatorios.', NOW(), NOW()),
  ('prueba-orto-appt-03-02', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-03', 'cmp3e6l1x0003rp6e9lda5fxe', 'Control de ortodoncia', '2026-06-28T15:00:00-06:00', '2026-06-28T15:30:00-06:00', 'COMPLETED', 'Cita de PRUEBA (ws1-t2) — paciente sin teléfono, no dispara recordatorios.', NOW(), NOW()),
  ('prueba-orto-appt-03-03', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-03', 'cmp3e6l1x0003rp6e9lda5fxe', 'Control de ortodoncia', '2026-08-28T15:00:00-06:00', '2026-08-28T15:30:00-06:00', 'COMPLETED', 'Cita de PRUEBA (ws1-t2) — paciente sin teléfono, no dispara recordatorios.', NOW(), NOW()),
  ('prueba-orto-appt-03-hoy', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-03', 'cmp3e6l1x0003rp6e9lda5fxe', 'Control de ortodoncia', '2026-09-28T16:00:00-06:00', '2026-09-28T16:30:00-06:00', 'CONFIRMED', 'Cita de PRUEBA (ws1-t2) — paciente sin teléfono, no dispara recordatorios.', NOW(), NOW()),
  ('prueba-orto-appt-02-futura', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-02', 'cmp3e6l1x0003rp6e9lda5fxe', 'Control de ortodoncia', '2026-10-23T13:00:00-06:00', '2026-10-23T13:30:00-06:00', 'SCHEDULED', 'Cita de PRUEBA (ws1-t2) — paciente sin teléfono, no dispara recordatorios.', NOW(), NOW()),
  ('prueba-orto-appt-04-noshow', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-04', 'cmrf8vfvq000sorq8ut1pdz08', 'Control de ortodoncia', '2026-09-10T12:00:00-06:00', '2026-09-10T12:30:00-06:00', 'NO_SHOW', 'Cita de PRUEBA (ws1-t2) — paciente sin teléfono, no dispara recordatorios.', NOW(), NOW()),
  ('prueba-orto-appt-04-futura', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-04', 'cmrf8vfvq000sorq8ut1pdz08', 'Control de ortodoncia', '2026-10-05T12:00:00-06:00', '2026-10-05T12:30:00-06:00', 'SCHEDULED', 'Cita de PRUEBA (ws1-t2) — paciente sin teléfono, no dispara recordatorios.', NOW(), NOW()),
  ('prueba-orto-appt-05-futura', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-05', 'cmp3e6l1x0003rp6e9lda5fxe', 'Control de ortodoncia', '2026-11-10T11:00:00-06:00', '2026-11-10T11:30:00-06:00', 'SCHEDULED', 'Cita de PRUEBA (ws1-t2) — paciente sin teléfono, no dispara recordatorios.', NOW(), NOW()),
  ('prueba-orto-appt-06-final', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-06', 'cmp3e6l1x0003rp6e9lda5fxe', 'Control de ortodoncia', '2026-09-15T10:00:00-06:00', '2026-09-15T10:30:00-06:00', 'COMPLETED', 'Cita de PRUEBA (ws1-t2) — paciente sin teléfono, no dispara recordatorios.', NOW(), NOW()),
  ('prueba-orto-appt-07-pasada', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-07', 'cmrf8vfvq000sorq8ut1pdz08', 'Control de ortodoncia', '2026-07-15T09:00:00-06:00', '2026-07-15T09:30:00-06:00', 'COMPLETED', 'Cita de PRUEBA (ws1-t2) — paciente sin teléfono, no dispara recordatorios.', NOW(), NOW()),
  ('prueba-orto-appt-08-futura', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-pac-08', 'cmp3e6l1x0003rp6e9lda5fxe', 'Control de ortodoncia', '2026-10-15T10:00:00-06:00', '2026-10-15T10:30:00-06:00', 'SCHEDULED', 'Cita de PRUEBA (ws1-t2) — paciente sin teléfono, no dispara recordatorios.', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- ── 9. Hojas de control firmadas (ortho_treatment_cards) — higiene ──────
INSERT INTO "ortho_treatment_cards" ("id", "treatmentPlanId", "patientId", "clinicId", "appointmentId", "cardNumber", "visitDate", "durationMin", "phaseKey", "monthAt", "wireFromId", "wireToId", "soapS", "soapO", "soapA", "soapP", "hygienePlaquePct", "hygieneGingivitis", "hygieneWhiteSpots", "hasProgressPhoto", "status", "signedAt", "signedById", "createdAt", "updatedAt")
VALUES
  ('prueba-orto-card-03-01', 'prueba-orto-plan-03', 'prueba-orto-pac-03', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-appt-03-01', 1, '2026-04-28', 30, 'ALIGNMENT', 2, 'prueba-orto-wire-03-01', 'prueba-orto-wire-03-02', 'Paciente refiere buena tolerancia, sin dolor.', 'Higiene con 45% de placa visible. Encía con inflamación leve.', 'Evolución conforme a lo planeado para esta fase.', 'Continuar secuencia de arcos. Reforzar técnica de cepillado.', 45, 'LEVE', false, false, 'SIGNED', '2026-04-28', 'cmp3e6l1x0003rp6e9lda5fxe', '2026-04-28', '2026-04-28'),
  ('prueba-orto-card-03-02', 'prueba-orto-plan-03', 'prueba-orto-pac-03', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-appt-03-02', 2, '2026-06-28', 30, 'LEVELING', 4, 'prueba-orto-wire-03-02', 'prueba-orto-wire-03-03', 'Paciente refiere buena tolerancia, sin dolor.', 'Higiene con 32% de placa visible. Encía con inflamación leve.', 'Evolución conforme a lo planeado para esta fase.', 'Continuar secuencia de arcos. Reforzar técnica de cepillado.', 32, 'LEVE', false, false, 'SIGNED', '2026-06-28', 'cmp3e6l1x0003rp6e9lda5fxe', '2026-06-28', '2026-06-28'),
  ('prueba-orto-card-03-03', 'prueba-orto-plan-03', 'prueba-orto-pac-03', 'cmn6soeaw0000t17xgljxc2iq', 'prueba-orto-appt-03-03', 3, '2026-08-28', 30, 'LEVELING', 6, 'prueba-orto-wire-03-03', 'prueba-orto-wire-03-04', 'Paciente refiere buena tolerancia, sin dolor.', 'Higiene con 22% de placa visible. Encía sin inflamación.', 'Evolución conforme a lo planeado para esta fase.', 'Continuar secuencia de arcos. Reforzar técnica de cepillado.', 22, 'AUSENTE', false, false, 'SIGNED', '2026-08-28', 'cmp3e6l1x0003rp6e9lda5fxe', '2026-08-28', '2026-08-28')
ON CONFLICT ("id") DO NOTHING;

-- ── 10. Pagos (payments) — todos "cash", ninguno Mercado Pago/Stripe ────
INSERT INTO "payments" ("id", "invoiceId", "amount", "method", "reference", "notes", "paidAt")
VALUES
  ('prueba-orto-pay-02-01', 'prueba-orto-inv-02', 10000, 'cash', NULL, 'Enganche en efectivo — caso recién abierto.', '2026-09-23'),
  ('prueba-orto-pay-03-01', 'prueba-orto-inv-03', 8000, 'cash', NULL, 'Enganche en efectivo.', '2026-02-28'),
  ('prueba-orto-pay-03-02', 'prueba-orto-inv-03', 12000, 'cash', NULL, 'Mensualidades marzo-agosto (6 meses) pagadas en efectivo. Al corriente.', '2026-08-28'),
  ('prueba-orto-pay-04-01', 'prueba-orto-inv-04', 15000, 'cash', NULL, 'Enganche en efectivo.', '2026-05-28'),
  ('prueba-orto-pay-04-02', 'prueba-orto-inv-04', 3000, 'cash', NULL, 'Mensualidad de junio.', '2026-06-28'),
  ('prueba-orto-pay-05-01', 'prueba-orto-inv-05', 10000, 'cash', NULL, 'Enganche en efectivo.', '2025-01-28'),
  ('prueba-orto-pay-05-02', 'prueba-orto-inv-05', 26000, 'cash', NULL, 'Mensualidades acumuladas (13 meses) pagadas en efectivo durante el tratamiento activo.', '2026-02-28'),
  ('prueba-orto-pay-06-01', 'prueba-orto-inv-06', 6000, 'cash', NULL, 'Enganche en efectivo.', '2024-09-28'),
  ('prueba-orto-pay-06-02', 'prueba-orto-inv-06', 30000, 'cash', NULL, 'Liquidación total del tratamiento (15 mensualidades) en efectivo.', '2026-09-10'),
  ('prueba-orto-pay-07-01', 'prueba-orto-inv-07', 6000, 'cash', NULL, 'Enganche en efectivo.', '2026-04-28'),
  ('prueba-orto-pay-07-02', 'prueba-orto-inv-07', 8000, 'cash', NULL, 'Mensualidades abril-agosto (4 meses) pagadas en efectivo.', '2026-08-28'),
  ('prueba-orto-pay-07-03', 'prueba-orto-inv-07', 10000, 'cash', NULL, 'Abono extraordinario en efectivo — adelanto de mensualidades futuras antes de su viaje.', '2026-09-20'),
  ('prueba-orto-pay-08-01', 'prueba-orto-inv-08', 8000, 'cash', NULL, 'Enganche en efectivo, pagado por la madre (responsable de pago).', '2026-07-28'),
  ('prueba-orto-pay-08-02', 'prueba-orto-inv-08', 2000, 'cash', NULL, 'Mensualidad de agosto.', '2026-08-28')
ON CONFLICT ("id") DO NOTHING;

-- ── 11. Promesa de pago (orthodontic_payment_promises) ──────────────────
INSERT INTO "orthodontic_payment_promises" ("id", "treatmentPlanId", "clinicId", "amount", "promisedDate", "note", "createdByUserId", "createdAt")
VALUES
  ('prueba-orto-promise-05', 'prueba-orto-plan-05', 'cmn6soeaw0000t17xgljxc2iq', 4000, '2026-10-03', 'La paciente promete liquidar las 2 mensualidades pendientes en su próxima cita de control de retención.', 'cmp3e6l1x0003rp6e9lda5fxe', NOW())
ON CONFLICT ("id") DO NOTHING;

-- ── 12. Alineadores (orthodontic_aligners + _aligner_events) — Mateo ────
INSERT INTO "orthodontic_aligners" ("id", "treatmentPlanId", "patientId", "clinicId", "systemName", "totalTrays", "currentTray", "changeIntervalDays", "startedAt", "attachmentsPlaced", "attachmentsLost", "refinementCount", "status", "notes", "createdAt", "updatedAt")
VALUES
  ('prueba-orto-align-04', 'prueba-orto-plan-04', 'prueba-orto-pac-04', 'cmn6soeaw0000t17xgljxc2iq', 'ClearAlign Pro', 24, 10, 14, '2026-05-28', 6, 1, 0, 'ACTIVE', NULL, '2026-05-28', NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "orthodontic_aligner_events" ("id", "alignerId", "clinicId", "eventType", "trayNumber", "quantity", "notes", "createdByUserId", "createdAt")
VALUES
  ('prueba-orto-alignevt-04-01', 'prueba-orto-align-04', 'cmn6soeaw0000t17xgljxc2iq', 'DELIVERY', 1, 5, 'Entrega de alineadores 1 a 5.', 'cmrf8vfvq000sorq8ut1pdz08', '2026-05-28'),
  ('prueba-orto-alignevt-04-02', 'prueba-orto-align-04', 'cmn6soeaw0000t17xgljxc2iq', 'TRAY_CHANGE', 6, NULL, NULL, 'cmrf8vfvq000sorq8ut1pdz08', '2026-06-25'),
  ('prueba-orto-alignevt-04-03', 'prueba-orto-align-04', 'cmn6soeaw0000t17xgljxc2iq', 'ATTACHMENT_LOST', 8, NULL, 'Attachment del diente 14 se despegó; se reforzó.', 'cmrf8vfvq000sorq8ut1pdz08', '2026-08-10'),
  ('prueba-orto-alignevt-04-04', 'prueba-orto-align-04', 'cmn6soeaw0000t17xgljxc2iq', 'TRAY_CHANGE', 10, NULL, NULL, 'cmrf8vfvq000sorq8ut1pdz08', '2026-09-15')
ON CONFLICT ("id") DO NOTHING;

-- ── 13. Cefalometría manual, sin imagen (orthodontic_cephalometry_analyses) ─
INSERT INTO "orthodontic_cephalometry_analyses" ("id", "treatmentPlanId", "patientId", "clinicId", "kind", "analysisType", "normSet", "points", "measurements", "calibrationMmPerPixel", "lateralXrayFileId", "tracingPdfFileId", "createdByUserId", "createdAt", "updatedAt")
VALUES
  ('prueba-orto-ceph-03', 'prueba-orto-plan-03', 'prueba-orto-pac-03', 'cmn6soeaw0000t17xgljxc2iq', 'INITIAL', 'STEINER', 'MEXICAN', '{}'::jsonb, '{"SNA":82,"SNB":78,"ANB":4,"FMA":25,"1_NA_mm":4}'::jsonb, NULL, NULL, NULL, 'cmp3e6l1x0003rp6e9lda5fxe', '2026-02-10', NOW())
ON CONFLICT ("id") DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- Comprobación (solo lee) — debe devolver 8 filas con conteos > 0 salvo
-- Sofía (fila 1: solo diagnóstico, sin plan/factura, a propósito).
-- ═══════════════════════════════════════════════════════════════════════
SELECT
  p."patientNumber", p."firstName", p."lastName",
  d."inObservation",
  tp."status" AS plan_status, tp."technique",
  inv."total" AS factura_total, inv."paid" AS factura_pagado
FROM "patients" p
LEFT JOIN "orthodontic_diagnoses" d ON d."patientId" = p."id"
LEFT JOIN "orthodontic_treatment_plans" tp ON tp."patientId" = p."id"
LEFT JOIN "invoices" inv ON inv."id" = tp."invoiceId"
WHERE p."clinicId" = 'cmn6soeaw0000t17xgljxc2iq' AND p."id" LIKE 'prueba-orto-%'
ORDER BY p."patientNumber";

COMMIT;

