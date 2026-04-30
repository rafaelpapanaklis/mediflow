-- ═══════════════════════════════════════════════════════════════════
-- Indexes de performance para queries calientes del dashboard.
-- Idempotentes (CREATE INDEX IF NOT EXISTS). Seguros para correr en
-- prod sin downtime — Postgres puede crearlos con CONCURRENTLY si la
-- tabla tiene mucha actividad, pero acá usamos CREATE INDEX normal
-- porque las tablas de demo son chicas y la operación es rápida.
--
-- Auditoría: solo Appointment tenía indexes compuestos. Patient,
-- MedicalRecord, Invoice, Payment, Prescription, PatientFile,
-- TreatmentPlan, TreatmentSession dependían de scans completos.
-- ═══════════════════════════════════════════════════════════════════

-- ── Patient ────────────────────────────────────────────────────────
-- Listado /dashboard/patients filtra por clinicId + status, y ordena
-- por createdAt o name. Sin índice compuesto, scan + sort cuesta
-- O(n log n) sobre toda la tabla.
CREATE INDEX IF NOT EXISTS "patients_clinicId_status_idx"
  ON "patients"("clinicId", "status");
CREATE INDEX IF NOT EXISTS "patients_clinicId_createdAt_idx"
  ON "patients"("clinicId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "patients_primaryDoctorId_idx"
  ON "patients"("primaryDoctorId")
  WHERE "primaryDoctorId" IS NOT NULL;

-- ── MedicalRecord ──────────────────────────────────────────────────
-- /api/patients/[id]/timeline + history queries. Sin índice, queries
-- de timeline hacían seq scan. Crítico con 30+ SOAP notes por paciente
-- demo.
CREATE INDEX IF NOT EXISTS "medical_records_clinicId_patientId_visitDate_idx"
  ON "medical_records"("clinicId", "patientId", "visitDate" DESC);
CREATE INDEX IF NOT EXISTS "medical_records_clinicId_doctorId_idx"
  ON "medical_records"("clinicId", "doctorId");

-- ── Invoice ────────────────────────────────────────────────────────
-- /dashboard/billing filtra por status + ordena por createdAt.
-- /dashboard/patients/[id] hero card hace count + sum por patient.
-- /api/dashboard/home/admin agrega revenue por período.
CREATE INDEX IF NOT EXISTS "invoices_clinicId_status_createdAt_idx"
  ON "invoices"("clinicId", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "invoices_patientId_idx"
  ON "invoices"("patientId");
-- balance > 0 es la query de "facturas pendientes" en hero card.
CREATE INDEX IF NOT EXISTS "invoices_clinicId_balance_partial_idx"
  ON "invoices"("clinicId", "balance")
  WHERE "balance" > 0;

-- ── Payment ────────────────────────────────────────────────────────
-- Cada vez que se carga un invoice con sus payments, sin índice se
-- hace seq scan de toda la tabla payments para el invoiceId.
CREATE INDEX IF NOT EXISTS "payments_invoiceId_idx"
  ON "payments"("invoiceId");

-- ── Prescription ───────────────────────────────────────────────────
-- /api/patients/[id]/timeline incluye recetas, agrupadas por
-- medicalRecordId. Antes hacía seq scan.
CREATE INDEX IF NOT EXISTS "prescriptions_medicalRecordId_idx"
  ON "prescriptions"("medicalRecordId");
CREATE INDEX IF NOT EXISTS "prescriptions_clinicId_issuedAt_idx"
  ON "prescriptions"("clinicId", "issuedAt" DESC);

-- ── PatientFile ────────────────────────────────────────────────────
-- /dashboard/xrays/[patientId] + /api/xrays?patientId= + timeline
-- xray events. Sin índice, scan completo de patient_files.
CREATE INDEX IF NOT EXISTS "patient_files_clinicId_patientId_createdAt_idx"
  ON "patient_files"("clinicId", "patientId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "patient_files_patientId_category_idx"
  ON "patient_files"("patientId", "category");

-- ── TreatmentPlan ──────────────────────────────────────────────────
-- /dashboard/patients/[id] tab "Plan tratamiento" + timeline.
CREATE INDEX IF NOT EXISTS "treatment_plans_clinicId_patientId_status_idx"
  ON "treatment_plans"("clinicId", "patientId", "status");

-- ── TreatmentSession ───────────────────────────────────────────────
-- Sesiones por plan se cargan cada vez que se abre un plan. Sin
-- índice, seq scan de toda la tabla treatment_sessions.
CREATE INDEX IF NOT EXISTS "treatment_sessions_treatmentId_idx"
  ON "treatment_sessions"("treatmentId");

-- ── Appointment (extras además de los ya existentes) ───────────────
-- /api/agenda/range pre-carga todas las citas del clinic en el rango
-- (commit anterior agregó esto). Aprovechamos el índice
-- (clinicId, startsAt, endsAt, status) que ya existe.
-- /api/dashboard/home/admin filter por status="COMPLETED" — aprovecha
-- el mismo índice.
-- Sin cambios en appointments — los 4 índices existentes cubren todo.
