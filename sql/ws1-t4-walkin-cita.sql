-- ws1-t4 (2-oct-2026) — «Iniciar» en la fila de walk-in crea la cita del momento y la LIGA a la fila.
-- Idempotente. NO es requisito para que funcione: sin esta columna la cita se crea igual y la fila queda ligada
-- al paciente (walk_in_queue."patientId"); la columna solo guarda también cuál fue la cita.
ALTER TABLE walk_in_queue ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;
CREATE INDEX IF NOT EXISTS walk_in_queue_appointment_idx ON walk_in_queue ("appointmentId") WHERE "appointmentId" IS NOT NULL;
