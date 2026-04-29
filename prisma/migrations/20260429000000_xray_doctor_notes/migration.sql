-- Notas clínicas del doctor sobre cada PatientFile (radiografía / foto / etc.).
-- Independientes de las notas de upload (PatientFile.notes) y del análisis IA.
-- Los campos fueron agregados al modelo Prisma (PatientFile.doctorNotes,
-- PatientFile.doctorNotesUpdatedAt) en commits e91ad2b/fa71fd3 pero la
-- migración correspondiente no se generó, dejando el DB driftado.
--
-- Sin estas columnas, prisma.patientFile.findMany() sin `select` explícito
-- (ej. /api/xrays) devuelve 500 con "column doctorNotes does not exist".
--
-- IF NOT EXISTS para idempotencia: algunos entornos de dev pueden tener
-- las columnas vía `prisma db push`.

ALTER TABLE "patient_files"
  ADD COLUMN IF NOT EXISTS "doctorNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "doctorNotesUpdatedAt" TIMESTAMP(3);
