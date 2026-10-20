-- ═══════════════════════════════════════════════════════════════════════
-- WS1-T9 · Encender «Google Calendar → agenda» SOLO para el grupo Salamanca
--
-- Requiere antes sql/salamanca-google.sql, el código desplegado (producción y
-- panel.108) y mirar sql/salamanca-google-verificar.sql (solo lectura).
--
-- Enciende la bandera de las 6 clínicas del Centro Dental Salamanca y de
-- NINGUNA otra, CON FRENO (segunda vuelta t8, N-G13; mismo freno que
-- sql/salamanca-encender-agenda.sql, con la rendija N-A4 cerrada):
--   · tienen que existir EXACTAMENTE las 6 (los slugs son genéricos:
--     «centro-dental» podría ser otra clínica);
--   · las 6 tienen que tener un SUPER_ADMIN y ser del MISMO dueño (un único
--     supabaseId). Una clínica sin SUPER_ADMIN también frena.
-- Si algo no cuadra, para con «Freno: …» y NO enciende ninguna.
--
-- Y de esas 6, SOLO enciende las que salen «listo» en el archivo de
-- verificación (calendario propio de la clínica, no repetido en otra sede,
-- agenda nueva). Las demás las nombra en un aviso (NOTICE) y NO las enciende:
-- arreglarlas y volver a pegar este archivo. (Este archivo no APAGA nada: si
-- una ya estaba encendida de antes y ahora no sale «listo», sigue encendida;
-- apágala con el UPDATE de abajo.)
--
-- Si una ya tenía fila (apagada), la enciende; si no, la crea. Una sede
-- NUEVA de cualquiera de ellas la hereda al darse de alta desde su sede
-- PRINCIPAL, siempre (src/app/api/clinics/route.ts → heredarBanderaGoogle).
--
-- Para apagarla después: UPDATE google_agenda_imports SET "enabled" = false
-- WHERE "clinicId" = '<id>';  (los bloqueos de Google de esa clínica se
-- retiran solos en la siguiente pasada del cron; nada se borra).
-- Idempotente. Lo pega Rafael en Supabase → SQL Editor. ⛔ Nunca una terminal.
-- ═══════════════════════════════════════════════════════════════════════
DO $sal$
DECLARE
  esperados text[] := ARRAY[
    'centro-dental',
    'centro-dental-san-felipe',
    'centro-dental-guanajuato',
    'centro-dental-villagran',
    'dental-bas',
    'clan-dental'
  ];
  encontrados int;
  faltan text;
  duenos int;
  con_dueno int;
  sin_dueno text;
  no_listas text;
  n int;
BEGIN
  SELECT count(*) INTO encontrados FROM clinics WHERE slug = ANY(esperados);
  IF encontrados <> 6 THEN
    SELECT string_agg(e, ', ') INTO faltan
      FROM unnest(esperados) AS e
     WHERE NOT EXISTS (SELECT 1 FROM clinics c WHERE c.slug = e);
    RAISE EXCEPTION 'Freno: se esperaban 6 clínicas y hay %. Slugs que no existen: %. No se encendió nada.',
      encontrados, coalesce(faltan, '(ninguno; revisa duplicados)');
  END IF;

  -- Las 6, cada una con un SUPER_ADMIN, y todos el mismo dueño (N-A4).
  SELECT count(DISTINCT u."supabaseId"), count(DISTINCT c.id) INTO duenos, con_dueno
    FROM users u
    JOIN clinics c ON c.id = u."clinicId"
   WHERE c.slug = ANY(esperados) AND u.role = 'SUPER_ADMIN' AND u."supabaseId" IS NOT NULL;
  IF con_dueno <> 6 THEN
    SELECT string_agg(c.slug, ', ') INTO sin_dueno
      FROM clinics c
     WHERE c.slug = ANY(esperados)
       AND NOT EXISTS (SELECT 1 FROM users u
                        WHERE u."clinicId" = c.id AND u.role = 'SUPER_ADMIN' AND u."supabaseId" IS NOT NULL);
    RAISE EXCEPTION 'Freno: estas clínicas no tienen dueño (SUPER_ADMIN): %. No se encendió nada.', sin_dueno;
  END IF;
  IF duenos <> 1 THEN
    RAISE EXCEPTION 'Freno: las 6 clínicas deberían ser del mismo dueño y hay % dueños distintos. No se encendió nada.', duenos;
  END IF;

  -- Las que NO están listas (misma regla que salamanca-google-verificar.sql).
  SELECT string_agg(c.slug, ', ' ORDER BY c.slug) INTO no_listas
    FROM clinics c
   WHERE c.slug = ANY(esperados)
     AND NOT (
       (c."googleClinicCalendarId" IS NULL
          OR c."googleClinicCalendarId" ~* '^[^@[:space:]]+@group\.calendar\.google\.com$')
       AND NOT EXISTS (SELECT 1 FROM clinics o
                        WHERE o.id <> c.id
                          AND o."googleClinicCalendarId" = c."googleClinicCalendarId")
       AND NOT EXISTS (SELECT 1 FROM clinic_feature_flags f
                        WHERE f."clinicId" = c.id AND f.flag = 'menu-dos-niveles' AND f.enabled = false)
     );
  IF no_listas IS NOT NULL THEN
    RAISE NOTICE 'NO se encienden (no salen «listo» en salamanca-google-verificar.sql; si ya estaban encendidas de antes, siguen así): %', no_listas;
  END IF;

  INSERT INTO google_agenda_imports ("clinicId", "enabled", "createdAt", "updatedAt")
  SELECT c.id, true, NOW(), NOW()
    FROM clinics c
   WHERE c.slug = ANY(esperados)
     AND (c."googleClinicCalendarId" IS NULL
            OR c."googleClinicCalendarId" ~* '^[^@[:space:]]+@group\.calendar\.google\.com$')
     AND NOT EXISTS (SELECT 1 FROM clinics o
                      WHERE o.id <> c.id
                        AND o."googleClinicCalendarId" = c."googleClinicCalendarId")
     AND NOT EXISTS (SELECT 1 FROM clinic_feature_flags f
                      WHERE f."clinicId" = c.id AND f.flag = 'menu-dos-niveles' AND f.enabled = false)
  ON CONFLICT ("clinicId") DO UPDATE
     -- Sin syncToken: la primera pasada es COMPLETA y reactiva lo que siga ocupado en Google.
     SET "enabled" = true, "syncToken" = NULL, "updatedAt" = NOW();
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Google → agenda encendida en % clínicas.', n;
END
$sal$;

-- Comprobación (solo lectura): TODAS las clínicas con la bandera encendida.
-- Deben salir las de Salamanca que estaban «listo» (más las sedes nuevas que
-- la hayan heredado), y ninguna otra.
SELECT c.slug, c.name, g."enabled", g."updatedAt"
  FROM google_agenda_imports g
  JOIN clinics c ON c.id = g."clinicId"
 WHERE g."enabled" = true
 ORDER BY c.slug;
