-- M2.b: Drop columnas legacy de Appointment + drop defaults transitorios.
-- Pre-condición: todos los consumers fueron migrados a startsAt/endsAt
-- (verificado con git grep — los reads que quedan son strings derivados
-- en server components, no columnas DB).

-- 1. Drop defaults transitorios que M2 había puesto para que los routes
--    legacy siguieran funcionando.
ALTER TABLE "appointments"
  ALTER COLUMN "startsAt" DROP DEFAULT,
  ALTER COLUMN "endsAt"   DROP DEFAULT;

-- 2. Drop las 4 columnas legacy.
ALTER TABLE "appointments"
  DROP COLUMN IF EXISTS "date",
  DROP COLUMN IF EXISTS "startTime",
  DROP COLUMN IF EXISTS "endTime",
  DROP COLUMN IF EXISTS "durationMins";
