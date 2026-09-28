-- Ortodoncia — ws1-t8 ronda 6 (M5): las notas de evolución que se crearon al
-- firmar un control ANTES del arreglo quedaron sin `status`, y el historial de
-- consultas las pinta como «Borrador» (con «Eliminar borrador»). Este UPDATE
-- las marca como firmadas, con la fecha de su hoja. Idempotente: solo toca las
-- que vienen de una hoja de control (`treatmentCardId`) y no tienen `status`.
-- SIN bloques DO. NO lo aplica la terminal: pégalo en Supabase → SQL Editor.

UPDATE "medical_records"
SET "specialtyData" = "specialtyData"
  || jsonb_build_object('status', 'SIGNED', 'signedAt', to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
WHERE "specialtyData"->>'type' = 'orthodontics'
  AND "specialtyData"->>'treatmentCardId' IS NOT NULL
  AND "specialtyData"->>'status' IS NULL;
