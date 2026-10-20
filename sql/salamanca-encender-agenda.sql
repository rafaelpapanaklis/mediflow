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
-- Las sedes NUEVAS que se den de alta desde cualquiera de ellas heredan la
-- bandera solas (src/lib/branches/copia-sede.server.ts).
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
-- Debe devolver 6 filas. Si falta alguna, revisa el slug antes de seguir.
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


-- ── 2. Encender ────────────────────────────────────────────────────────
INSERT INTO "clinic_feature_flags" ("clinicId", "flag", "enabled")
SELECT "id", 'agenda-flexible', true
  FROM "clinics"
 WHERE "slug" IN (
   'centro-dental',
   'centro-dental-san-felipe',
   'centro-dental-guanajuato',
   'centro-dental-villagran',
   'dental-bas',
   'clan-dental'
 )
ON CONFLICT ("clinicId", "flag") DO UPDATE SET "enabled" = true
RETURNING "clinicId", "flag", "enabled";
-- Debe devolver 6 filas, todas con enabled = true.


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
