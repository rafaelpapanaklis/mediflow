-- ═══════════════════════════════════════════════════════════════════════
-- WS1-T9 · Encender «Google Calendar → agenda» SOLO para el grupo Salamanca
--
-- Requiere antes sql/salamanca-google.sql, y mirar ANTES sql/salamanca-google-verificar.sql
-- (solo lectura): enciende solo las clínicas que salgan con «listo».
-- Enciende la bandera de las 6 clínicas del Centro Dental Salamanca y de
-- NINGUNA otra. Si una ya tenía fila (apagada), la enciende; si no, la crea.
-- Una sede NUEVA de cualquiera de ellas la hereda al darse de alta
-- desde su sede PRINCIPAL, siempre (src/app/api/clinics/route.ts → heredarBanderaGoogle).
--
-- Para apagarla después: UPDATE google_agenda_imports SET "enabled" = false
-- WHERE "clinicId" = '<id>';  (los bloqueos de Google de esa clínica se
-- retiran solos en la siguiente pasada del cron; nada se borra).
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO google_agenda_imports ("clinicId", "enabled", "createdAt", "updatedAt")
SELECT c.id, true, NOW(), NOW()
  FROM clinics c
 WHERE c.slug IN (
   'centro-dental',
   'centro-dental-san-felipe',
   'centro-dental-guanajuato',
   'centro-dental-villagran',
   'dental-bas',
   'clan-dental'
 )
ON CONFLICT ("clinicId") DO UPDATE
   -- Sin syncToken: la primera pasada es COMPLETA y reactiva lo que siga ocupado en Google.
   SET "enabled" = true, "syncToken" = NULL, "updatedAt" = NOW()
RETURNING "clinicId",
          (SELECT slug FROM clinics WHERE id = google_agenda_imports."clinicId") AS slug,
          "enabled";
-- Deben salir 6 filas. Si salen menos, algún slug no coincide: revísalo antes de seguir.
