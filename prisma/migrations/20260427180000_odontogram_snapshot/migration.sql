-- Snapshot inmutable del odontograma al cerrar consulta. Sirve para:
--   1. Historial: ver el estado dental en cualquier consulta pasada.
--   2. Diff: comparar contra el snapshot anterior para detectar tratamientos
--      realizados y proponer line items de factura.
--
-- entries = JSON array con [{ toothNumber, surface, state, notes }, ...]
-- copiada del estado vigente de odontogram_entries al momento del cierre.

CREATE TABLE "odontogram_snapshots" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "entries" JSONB NOT NULL,

  CONSTRAINT "odontogram_snapshots_pkey" PRIMARY KEY ("id")
);

-- 1 snapshot por cita (al cerrarla). Si se reabre y vuelve a cerrar,
-- el endpoint upsertea sobre el mismo appointmentId.
CREATE UNIQUE INDEX "odontogram_snapshots_appointmentId_key"
  ON "odontogram_snapshots"("appointmentId");

CREATE INDEX "odontogram_snapshots_patientId_idx"
  ON "odontogram_snapshots"("patientId");

CREATE INDEX "odontogram_snapshots_patientId_snapshotAt_idx"
  ON "odontogram_snapshots"("patientId", "snapshotAt");

ALTER TABLE "odontogram_snapshots"
  ADD CONSTRAINT "odontogram_snapshots_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "odontogram_snapshots"
  ADD CONSTRAINT "odontogram_snapshots_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
