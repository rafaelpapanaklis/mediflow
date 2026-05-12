-- ──────────────────────────────────────────────────────────────────────────
-- Seed Ortodoncia v2 · caso demo Gabriela Hernández Ruiz · Supabase Studio
--
-- Pre-requisitos:
--   1. Migration 20260512170000_ortho_v2_rewrite YA aplicada (17 tablas v2
--      creadas, 23 tablas v1 borradas).
--   2. Paciente Gabriela existe con id 'cmouwaz1z0001v3qhqigop9nj'.
--
-- Idempotente: ON CONFLICT DO NOTHING en todos los inserts. Re-ejecutar es
-- seguro pero no re-actualiza valores (solo skip).
--
-- Variables (psql-style, reemplazar manualmente si el Studio no las soporta):
--   :patient_id   = 'cmouwaz1z0001v3qhqigop9nj'
--   :clinic_id    = derivado de la fila del paciente
--   :doctor_id    = derivado de patient.primaryDoctorId
-- ──────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_patient_id  TEXT := 'cmouwaz1z0001v3qhqigop9nj';
  v_clinic_id   TEXT;
  v_doctor_id   TEXT;
  v_case_id     TEXT := 'cmouwbz1z0001ortov2caseAB';
  v_plan_id     TEXT := 'cmouwbz1z0002ortov2planAB';
  v_fp_id       TEXT := 'cmouwbz1z0003ortov2finAB';
  v_t0_id       TEXT := 'cmouwbz1z0004ortov2t0AB';
  v_t1_id       TEXT := 'cmouwbz1z0005ortov2t1AB';
BEGIN
  -- Resolver clinicId y doctorId desde el paciente
  SELECT "clinicId", "primaryDoctorId"
    INTO v_clinic_id, v_doctor_id
    FROM patients
    WHERE id = v_patient_id;

  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Paciente Gabriela no encontrado · id %', v_patient_id;
  END IF;
  IF v_doctor_id IS NULL THEN
    RAISE EXCEPTION 'Paciente sin primaryDoctorId · asignar antes de seedear';
  END IF;

  -- 1. OrthoCase
  INSERT INTO ortho_cases (id, "clinicId", "patientId", "caseCode", status, "currentPhase",
                           "primaryDoctorId", "startedAt", "estimatedEnd",
                           "createdAt", "updatedAt")
  VALUES (v_case_id, v_clinic_id, v_patient_id, 'ORT-2026-001', 'ACTIVE', 'LEVELING',
          v_doctor_id, '2025-09-08'::date, '2027-03-15'::date,
          NOW(), NOW())
  ON CONFLICT ("patientId") DO NOTHING;

  -- 2. OrthoDiagnosis
  INSERT INTO ortho_diagnoses (id, "caseId", "angleClass", "subCaninoR", "subCaninoL",
                               "overjetMm", "overbiteMm", "openBite", "crossBite",
                               "crowdingMaxMm", "crowdingMandMm",
                               diastemas, "midlineDeviation", "facialProfile",
                               "skeletalPattern", "skeletalIssues", "tmjFindings",
                               habits, narrative, "updatedAt", "updatedBy")
  VALUES (gen_random_uuid()::text, v_case_id, 'II_DIV1', 'II_DIV1', 'II_DIV1',
          6, 4, 'NONE', 'NONE', 3, 5,
          '[{"teeth":[11,21],"mm":1.5},{"teeth":[31,41],"mm":0.8}]'::jsonb,
          -1.5, 'CONVEX', 'MESO', ARRAY['Clase II esqueletal leve'],
          '{"noise":true,"pain":false,"deflexionMm":0,"openingMm":46}'::jsonb,
          ARRAY['Respirador bucal','Bruxismo'],
          'Paciente femenino 14 años · alergia Penicilina · motivo de consulta estético. Clase II Div 1 con resalte 6mm, sobremordida 4mm.',
          NOW(), v_doctor_id)
  ON CONFLICT ("caseId") DO NOTHING;

  -- 3. OrthoTreatmentPlan
  INSERT INTO ortho_treatment_plans (id, "caseId", appliances, extractions,
                                     elastics, expanders, tads, objectives, notes,
                                     "iprPlan", "acceptedAt", "acceptedBy")
  VALUES (v_plan_id, v_case_id, ARRAY['METAL','SELF_LIG'], ARRAY[]::integer[],
          '{"class":"II","hours":"18 hrs/día","side":"Bilateral"}'::jsonb,
          '{}'::jsonb, '{}'::jsonb,
          ARRAY['Alineación completa', 'Clase II a Clase I', 'Cerrar overjet', 'Cerrar diastemas'],
          'Iniciar con .014 NiTi sup/inf, control mensual.',
          '{"15-14":0.3,"14-13":0.3,"22-23":0.2}'::jsonb,
          '2025-09-01'::date, v_doctor_id)
  ON CONFLICT ("caseId") DO NOTHING;

  -- 4. ArchPlanned (7 arcos)
  INSERT INTO ortho_arches_planned (id, "planId", "order", phase, material, gauge,
                                    "durationW", status)
  VALUES
    (gen_random_uuid()::text, v_plan_id, 1, 'ALIGNMENT', 'NITI', '.014', 6, 'PAST'),
    (gen_random_uuid()::text, v_plan_id, 2, 'ALIGNMENT', 'NITI', '.016', 8, 'PAST'),
    (gen_random_uuid()::text, v_plan_id, 3, 'LEVELING', 'NITI', '.016', 10, 'CURRENT'),
    (gen_random_uuid()::text, v_plan_id, 4, 'LEVELING', 'SS', '.018', 8, 'FUTURE'),
    (gen_random_uuid()::text, v_plan_id, 5, 'SPACE_CLOSE', 'SS', '.019 x .025', 12, 'FUTURE'),
    (gen_random_uuid()::text, v_plan_id, 6, 'DETAIL', 'TMA', '.017 x .025', 8, 'FUTURE'),
    (gen_random_uuid()::text, v_plan_id, 7, 'FINISHING', 'BETA_TI', '.019 x .025', 6, 'FUTURE')
  ON CONFLICT ("planId", "order") DO NOTHING;

  -- 5. PhotoSets T0 + T1
  INSERT INTO ortho_photo_sets (id, "caseId", "stageCode", "capturedAt", "createdAt", "createdBy")
  VALUES
    (v_t0_id, v_case_id, 'T0', '2025-06-15'::date, NOW(), v_doctor_id),
    (v_t1_id, v_case_id, 'T1', '2025-10-15'::date, NOW(), v_doctor_id)
  ON CONFLICT ("caseId", "stageCode") DO NOTHING;

  -- 6. TreatmentCards (7 cards históricas)
  INSERT INTO ortho_treatment_cards (id, "caseId", "visitDate", "visitType",
                                     activations, "elasticUse", "bracketsLost",
                                     "iprDoneDelta", soap, "homeInstr",
                                     "signedOffAt", "createdAt", "createdBy")
  VALUES
    (gen_random_uuid()::text, v_case_id, '2025-06-15'::timestamp, 'FOLLOWUP',
     ARRAY[]::text[], '{}'::jsonb, ARRAY[]::integer[], '{}'::jsonb,
     '{"s":"","o":"","a":"","p":"Primera consulta. Aceptación plan."}'::jsonb,
     'Elásticos 18 hrs', '2025-06-15'::timestamp, NOW(), v_doctor_id),
    (gen_random_uuid()::text, v_case_id, '2025-07-18'::timestamp, 'INSTALLATION',
     ARRAY[]::text[],
     '{"type":"II","prescribedHours":"18 hrs/día","reportedCompliance":88}'::jsonb,
     ARRAY[]::integer[], '{}'::jsonb,
     '{"s":"Sin molestias","o":"Higiene buena","a":"Instalación OK","p":"Instalación brackets bimaxilar"}'::jsonb,
     'Elásticos 18 hrs · cera ortodóntica', '2025-07-18'::timestamp, NOW(), v_doctor_id),
    (gen_random_uuid()::text, v_case_id, '2025-08-15'::timestamp, 'CONTROL',
     ARRAY[]::text[],
     '{"type":"II","prescribedHours":"18 hrs/día","reportedCompliance":88}'::jsonb,
     ARRAY[]::integer[], '{}'::jsonb,
     '{"s":"Sin molestias","o":"Higiene buena","a":"Progreso esperado","p":"Continuar .014 NiTi"}'::jsonb,
     'Elásticos 18 hrs', '2025-08-15'::timestamp, NOW(), v_doctor_id),
    (gen_random_uuid()::text, v_case_id, '2025-08-22'::timestamp, 'EMERGENCY',
     ARRAY[]::text[],
     '{"type":"II","prescribedHours":"18 hrs/día","reportedCompliance":78}'::jsonb,
     ARRAY[34], '{}'::jsonb,
     '{"s":"Molestia bracket 34","o":"Bracket 34 caído","a":"Recolocar","p":"Recolocado · continuar"}'::jsonb,
     'Cera ortodóntica si molestia', '2025-08-22'::timestamp, NOW(), v_doctor_id),
    (gen_random_uuid()::text, v_case_id, '2025-09-17'::timestamp, 'CONTROL',
     ARRAY[]::text[],
     '{"type":"II","prescribedHours":"18 hrs/día","reportedCompliance":78}'::jsonb,
     ARRAY[]::integer[], '{}'::jsonb,
     '{"s":"Sin molestias","o":"Higiene buena","a":"Compliance 78%","p":"Continuar .014"}'::jsonb,
     'Elásticos 18 hrs', '2025-09-17'::timestamp, NOW(), v_doctor_id),
    (gen_random_uuid()::text, v_case_id, '2025-10-15'::timestamp, 'CONTROL',
     ARRAY[]::text[],
     '{"type":"II","prescribedHours":"18 hrs/día","reportedCompliance":82}'::jsonb,
     ARRAY[24], '{}'::jsonb,
     '{"s":"Molestia leve día 3","o":"Bracket 24 caído","a":"Progreso esperado","p":"Recolocar 24 · cambio a .016 NiTi"}'::jsonb,
     'Elásticos 18 hrs · cera ortodóntica', '2025-10-15'::timestamp, NOW(), v_doctor_id);
  -- NOTA: no ON CONFLICT en treatment_cards porque no hay unique constraint; idempotencia requiere SELECT manual antes.

  -- 7. FinancialPlan
  INSERT INTO ortho_financial_plans (id, "caseId", total, "downPayment", months, monthly,
                                     "startDate", scenarios, "activeScenarioId",
                                     "signedByPatient")
  VALUES (v_fp_id, v_case_id, 50000, 8000, 18, 2333, '2025-09-01'::date,
          '[{"id":"A","label":"12 meses","mod":"plan","total":50000,"downPayment":15000,"months":12,"apr":0},{"id":"B","label":"18 meses · ACTIVO","mod":"plan","total":50000,"downPayment":8000,"months":18,"apr":0,"active":true},{"id":"C","label":"24 meses","mod":"credito","total":50000,"downPayment":5000,"months":24,"apr":12}]'::jsonb,
          'B', false)
  ON CONFLICT ("caseId") DO NOTHING;

  -- 8. Installments (18)
  INSERT INTO ortho_installments (id, "financialId", "number", amount, "dueDate", status, "paidAt")
  SELECT
    gen_random_uuid()::text,
    v_fp_id,
    n,
    2333,
    ('2025-09-01'::date + (n - 1) * INTERVAL '1 month')::timestamp,
    CASE WHEN n <= 6 THEN 'PAID'::"InstStatus"
         WHEN n = 7 THEN 'PENDING'::"InstStatus"
         ELSE 'FUTURE'::"InstStatus" END,
    CASE WHEN n <= 6 THEN ('2025-09-01'::date + (n - 1) * INTERVAL '1 month')::timestamp
         ELSE NULL END
  FROM generate_series(1, 18) AS n
  ON CONFLICT ("financialId", "number") DO NOTHING;

  -- 9. RetentionPlan
  INSERT INTO ortho_retention_plans (id, "caseId", "retUpper", "retLower", "fixedGauge",
                                     regimen, checkpoints, "checkpointsDone",
                                     "referralCode", "referralReward", "referralsCount")
  VALUES (gen_random_uuid()::text, v_case_id, 'ESSIX', 'FIXED_3_3', '.0195',
          'Año 1: 24/7. Año 2-3: nocturno. Año 4: 3x/semana. Año 5+: 2x/semana.',
          ARRAY['2026-10-18','2027-01-18','2027-07-18','2028-07-18','2029-07-18']::timestamp[],
          '{}'::jsonb, 'GABY26',
          '{"kind":"month_free","label":"1 mes gratis"}'::jsonb, 3)
  ON CONFLICT ("caseId") DO NOTHING;

  -- 10. Documents (3 consents)
  INSERT INTO ortho_documents (id, "caseId", kind, title, url, "signedAt",
                               "createdAt", "createdBy")
  VALUES
    (gen_random_uuid()::text, v_case_id, 'CONSENT', 'Consentimiento informado ortodoncia',
     'https://demo.mediflow.mx/docs/gaby/consent-ortho.pdf',
     '2025-07-18'::timestamp, NOW(), v_doctor_id),
    (gen_random_uuid()::text, v_case_id, 'CONSENT', 'Autorización fotografías clínicas',
     'https://demo.mediflow.mx/docs/gaby/photo-use.pdf',
     '2025-07-18'::timestamp, NOW(), v_doctor_id),
    (gen_random_uuid()::text, v_case_id, 'CONSENT', 'Asentimiento de menor (≥12 años)',
     'https://demo.mediflow.mx/docs/gaby/minor-assent.pdf',
     '2025-07-18'::timestamp, NOW(), v_doctor_id);
  -- NOTA: no ON CONFLICT pq no hay unique constraint.

  -- 11. CommunicationLog (5 WhatsApp samples)
  INSERT INTO ortho_communication_logs (id, "caseId", channel, direction, body, "sentAt")
  VALUES
    (gen_random_uuid()::text, v_case_id, 'whatsapp', 'OUT',
     'Hola Gabriela 👋 confirmamos tu cita mañana 10:30 con Dr. Méndez.',
     '2025-10-15 14:30:00'::timestamp),
    (gen_random_uuid()::text, v_case_id, 'whatsapp', 'IN',
     'Confirmado, ahí estaré gracias', '2025-10-15 17:42:00'::timestamp),
    (gen_random_uuid()::text, v_case_id, 'whatsapp', 'OUT',
     'Tu próxima mensualidad #8 vence el 30 oct · monto $2,333.',
     '2025-10-15 19:00:00'::timestamp),
    (gen_random_uuid()::text, v_case_id, 'whatsapp', 'OUT',
     '¿Estás usando tus elásticos las horas prescritas?',
     '2025-10-20 09:00:00'::timestamp),
    (gen_random_uuid()::text, v_case_id, 'whatsapp', 'IN',
     'A veces, se me olvidan en la noche', '2025-10-20 12:14:00'::timestamp);

  RAISE NOTICE 'Seed completo · case_id=%, fp_id=%', v_case_id, v_fp_id;
END $$;
