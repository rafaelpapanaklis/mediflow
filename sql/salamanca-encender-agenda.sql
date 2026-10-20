-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T5 · ENCENDER la agenda flexible SOLO para el
-- grupo Centro Dental Salamanca (6 clínicas del mismo dueño).
--
-- Enciende la bandera `agenda-flexible` (fila en "clinic_feature_flags") de
-- estas seis clínicas, por SLUG, y de ninguna otra:
--   centro-dental, centro-dental-san-felipe, centro-dental-guanajuato,
--   centro-dental-villagran, dental-bas, clan-dental
--
-- Con la bandera, esas clínicas tienen:
--   · sobreagendar con aviso («¿Seguro?») para el equipo;
--   · el ajuste «Colorear las citas por: Doctor / Procedimiento» (empieza en
--     Doctor: este archivo NO toca el color) y el color en cada procedimiento;
--   · «Comida de __ a __» en el horario de cada doctor.
-- HERENCIA: una sede NUEVA hereda la bandera (y su «Colorear por») de la
-- SEDE PRINCIPAL DE SU DUEÑO, SIEMPRE, aunque no marque «copiar la
-- configuración» (POST /api/clinics → heredarBanderasDeAgenda en
-- src/lib/branches/copia-sede.server.ts). Ese es el criterio acordado para
-- todas las banderas del grupo (revisión t8, C4).
--
-- Antes: sql/salamanca-agenda.sql (columnas). Este archivo funciona sin él
-- (la bandera se enciende igual), pero la comida y el color no se podrán
-- guardar hasta pegarlo: la app lo dice con un aviso, no falla.
--
-- IDEMPOTENTE: volver a correrlo deja las mismas 6 filas encendidas. No borra
-- nada. Para APAGAR una clínica, ver el bloque comentado al final (se marca
-- enabled = false, la fila no se borra).
-- Lo pega Rafael en Supabase → SQL Editor. ⛔ Nunca una terminal.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Antes de encender: ¿están las 6? (solo lectura) ─────────────────
-- Debe devolver 6 filas. Si falta alguna, el paso 2 se detiene solo.
SELECT "id", "slug", "name"
  FROM "clinics"
 WHERE "slug" IN (
   'centro-dental',
   'centro-dental-san-felipe',
   'centro-dental-guanajuato',
   'centro-dental-villagran',
   'dental-bas',
   'clan-dental'
 )
 ORDER BY "slug";


-- ── 2. Encender, CON FRENO ─────────────────────────────────────────────
-- Solo enciende si encuentra EXACTAMENTE las 6 clínicas y TODAS son del mismo
-- dueño (un único SUPER_ADMIN por supabaseId entre ellas). Si no, aborta con
-- un error que dice qué falta y NO enciende ninguna (revisión t8, A10: los
-- slugs son genéricos, p. ej. «centro-dental»; mejor parar que encender la
-- clínica equivocada).
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
  n int;
BEGIN
  SELECT count(*) INTO encontrados FROM "clinics" WHERE "slug" = ANY(esperados);
  IF encontrados <> 6 THEN
    SELECT string_agg(e, ', ') INTO faltan
      FROM unnest(esperados) AS e
     WHERE NOT EXISTS (SELECT 1 FROM "clinics" c WHERE c."slug" = e);
    RAISE EXCEPTION 'Freno: se esperaban 6 clínicas y hay %. Slugs que no existen: %. No se encendió nada.',
      encontrados, coalesce(faltan, '(ninguno; revisa duplicados)');
  END IF;

  SELECT count(DISTINCT u."supabaseId") INTO duenos
    FROM "users" u
    JOIN "clinics" c ON c."id" = u."clinicId"
   WHERE c."slug" = ANY(esperados) AND u."role" = 'SUPER_ADMIN';
  IF duenos <> 1 THEN
    RAISE EXCEPTION 'Freno: las 6 clínicas deberían ser del mismo dueño y hay % dueños distintos. No se encendió nada.', duenos;
  END IF;

  INSERT INTO "clinic_feature_flags" ("clinicId", "flag", "enabled")
  SELECT "id", 'agenda-flexible', true FROM "clinics" WHERE "slug" = ANY(esperados)
  ON CONFLICT ("clinicId", "flag") DO UPDATE SET "enabled" = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'agenda-flexible encendida en % clínicas.', n;
END
$sal$;


-- ── 3. Comprobación: TODAS las clínicas con la bandera (solo lectura) ──
-- Deben salir exactamente estas 6 (más las sedes nuevas que hayan heredado).
SELECT c."slug", c."name", f."enabled", f."createdAt"
  FROM "clinic_feature_flags" f
  JOIN "clinics" c ON c."id" = f."clinicId"
 WHERE f."flag" = 'agenda-flexible'
 ORDER BY c."slug";


-- ── Apagar una clínica (NO correr salvo que se pida) ───────────────────
-- UPDATE "clinic_feature_flags" SET "enabled" = false
--  WHERE "flag" = 'agenda-flexible'
--    AND "clinicId" = (SELECT "id" FROM "clinics" WHERE "slug" = '<slug>')
-- RETURNING "clinicId", "flag", "enabled";
