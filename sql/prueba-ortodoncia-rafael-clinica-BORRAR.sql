-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T2 · BORRA los pacientes de prueba de ortodoncia
-- de «Rafael Clinica» (id cmn6soeaw0000t17xgljxc2iq) creados por
-- sql/prueba-ortodoncia-rafael-clinica.sql.
--
-- Filtra SIEMPRE por el prefijo 'prueba-orto-' + esa clínica. No toca
-- ninguna otra fila. Hijas primero (mismo orden que las FK con
-- ON DELETE CASCADE, aunque casi todas ya cascadean solas al borrar el
-- paciente/plan — se listan explícitas para que el orden sea legible y no
-- dependa de qué cascada exista hoy).
--
-- PLANO (sin DO $$), una sola transacción. Verificado localmente:
-- crear → verificar → borrar → verificar 0 filas (ver REPORTE-ws1-t2.md).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DELETE FROM "orthodontic_aligner_events"   WHERE "id" LIKE 'prueba-orto-%';
DELETE FROM "orthodontic_aligners"         WHERE "id" LIKE 'prueba-orto-%';
DELETE FROM "orthodontic_cephalometry_analyses" WHERE "id" LIKE 'prueba-orto-%';
DELETE FROM "orthodontic_payment_promises" WHERE "id" LIKE 'prueba-orto-%';
DELETE FROM "ortho_treatment_cards"        WHERE "id" LIKE 'prueba-orto-%';
DELETE FROM "ortho_wire_steps"             WHERE "id" LIKE 'prueba-orto-%';
DELETE FROM "payments"                     WHERE "id" LIKE 'prueba-orto-%';
DELETE FROM "invoice_payment_terms"        WHERE "invoiceId" LIKE 'prueba-orto-%';
DELETE FROM "appointments"                 WHERE "id" LIKE 'prueba-orto-%';
DELETE FROM "orthodontic_treatment_plans"  WHERE "id" LIKE 'prueba-orto-%';
DELETE FROM "invoices"                     WHERE "id" LIKE 'prueba-orto-%';
DELETE FROM "orthodontic_diagnoses"        WHERE "id" LIKE 'prueba-orto-%';
DELETE FROM "ped_guardians"                WHERE "id" LIKE 'prueba-orto-%';
DELETE FROM "patients"                     WHERE "id" LIKE 'prueba-orto-%'
                                              AND "clinicId" = 'cmn6soeaw0000t17xgljxc2iq';

-- ── Comprobación (solo lee) — debe devolver 0 en todas ───────────────────
SELECT 'patients' AS tabla, count(*) FROM "patients" WHERE "id" LIKE 'prueba-orto-%'
UNION ALL SELECT 'orthodontic_diagnoses', count(*) FROM "orthodontic_diagnoses" WHERE "id" LIKE 'prueba-orto-%'
UNION ALL SELECT 'orthodontic_treatment_plans', count(*) FROM "orthodontic_treatment_plans" WHERE "id" LIKE 'prueba-orto-%'
UNION ALL SELECT 'ortho_wire_steps', count(*) FROM "ortho_wire_steps" WHERE "id" LIKE 'prueba-orto-%'
UNION ALL SELECT 'ortho_treatment_cards', count(*) FROM "ortho_treatment_cards" WHERE "id" LIKE 'prueba-orto-%'
UNION ALL SELECT 'appointments', count(*) FROM "appointments" WHERE "id" LIKE 'prueba-orto-%'
UNION ALL SELECT 'invoices', count(*) FROM "invoices" WHERE "id" LIKE 'prueba-orto-%'
UNION ALL SELECT 'invoice_payment_terms', count(*) FROM "invoice_payment_terms" WHERE "invoiceId" LIKE 'prueba-orto-%'
UNION ALL SELECT 'payments', count(*) FROM "payments" WHERE "id" LIKE 'prueba-orto-%'
UNION ALL SELECT 'orthodontic_payment_promises', count(*) FROM "orthodontic_payment_promises" WHERE "id" LIKE 'prueba-orto-%'
UNION ALL SELECT 'orthodontic_aligners', count(*) FROM "orthodontic_aligners" WHERE "id" LIKE 'prueba-orto-%'
UNION ALL SELECT 'orthodontic_aligner_events', count(*) FROM "orthodontic_aligner_events" WHERE "id" LIKE 'prueba-orto-%'
UNION ALL SELECT 'orthodontic_cephalometry_analyses', count(*) FROM "orthodontic_cephalometry_analyses" WHERE "id" LIKE 'prueba-orto-%'
UNION ALL SELECT 'ped_guardians', count(*) FROM "ped_guardians" WHERE "id" LIKE 'prueba-orto-%';

COMMIT;
