-- ═══════════════════════════════════════════════════════════════════════
-- WS1-T9 · Comprobación ANTES de encender «Google Calendar → agenda»
--
-- SOLO LECTURA: no cambia nada. Se pega antes de sql/salamanca-encender-google.sql.
-- Una fila por cada una de las 6 clínicas del grupo Salamanca. Hay que encender
-- solo las que salgan con «listo» = true (revisión t8, G14 y G16):
--
--   · calendario_propio   — el calendario guardado es uno de la clínica
--                           (…@group.calendar.google.com). Si es «primary» o un
--                           correo, es el calendario PERSONAL de quien conectó y
--                           cada evento personal cerraría la clínica. (El código
--                           tampoco lo lee: la agenda avisa «no es el calendario
--                           propio de esta clínica».) NULL = aún sin conectar:
--                           se puede encender, pero no hará nada hasta conectar.
--   · calendario_repetido — otra clínica usa el MISMO calendario: una sede
--                           cerraría la agenda de la otra.
--   · agenda_nueva        — «Convertir en cita» y los avisos solo viven en la
--                           agenda nueva. false = la clínica tiene el rediseño
--                           APAGADO a propósito (fila en clinic_feature_flags).
-- ═══════════════════════════════════════════════════════════════════════
SELECT c.slug,
       c."googleCalendarEnabled" AS google_conectado,
       c."googleClinicCalendarId" AS calendario,
       CASE WHEN c."googleClinicCalendarId" IS NULL THEN NULL
            ELSE c."googleClinicCalendarId" ~* '^[^@[:space:]]+@group\.calendar\.google\.com$' END AS calendario_propio,
       EXISTS (SELECT 1 FROM clinics o
                WHERE o.id <> c.id
                  AND o."googleClinicCalendarId" = c."googleClinicCalendarId") AS calendario_repetido,
       NOT EXISTS (SELECT 1 FROM clinic_feature_flags f
                    WHERE f."clinicId" = c.id AND f.flag = 'menu-dos-niveles' AND f.enabled = false) AS agenda_nueva,
       (c."googleClinicCalendarId" IS NULL
          OR c."googleClinicCalendarId" ~* '^[^@[:space:]]+@group\.calendar\.google\.com$')
         AND NOT EXISTS (SELECT 1 FROM clinics o
                          WHERE o.id <> c.id
                            AND o."googleClinicCalendarId" = c."googleClinicCalendarId")
         AND NOT EXISTS (SELECT 1 FROM clinic_feature_flags f
                          WHERE f."clinicId" = c.id AND f.flag = 'menu-dos-niveles' AND f.enabled = false) AS listo
  FROM clinics c
 WHERE c.slug IN (
   'centro-dental',
   'centro-dental-san-felipe',
   'centro-dental-guanajuato',
   'centro-dental-villagran',
   'dental-bas',
   'clan-dental'
 )
 ORDER BY c.slug;
-- Deben salir 6 filas. Si alguna sale con listo = false, NO la enciendas: quita
-- su slug de sql/salamanca-encender-google.sql y avísanos.
