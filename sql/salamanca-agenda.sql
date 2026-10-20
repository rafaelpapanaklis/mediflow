-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T5 · AGENDA FLEXIBLE (grupo Centro Dental Salamanca)
--
-- Las columnas que necesitan dos de las tres funciones de la bandera
-- `agenda-flexible` (sobreagendar con aviso, color por procedimiento, hora de
-- comida). Sobreagendar NO necesita columnas: usa `appointments.overrideReason`,
-- que ya existe.
--
--   1. doctor_schedules."lunchStart" / "lunchEnd"  (TEXT, NULL)
--      La hora de comida de cada doctor, por día de la semana ("HH:MM").
--   2. procedure_catalog."agendaColor"              (TEXT, NULL)
--      El color de cada procedimiento en la agenda: una CLAVE de la paleta
--      ('morado','azul','cian','verde','oliva','ambar','naranja','coral',
--      'rosa','gris'). NULL = el color por defecto, que calcula la app.
--   3. clinic_feature_flags (CREATE TABLE IF NOT EXISTS): ya existe en
--      producción (sql/menu-dos-niveles.sql); va aquí solo para que este
--      archivo no dependa de aquél. Si ya existe, no hace nada.
--
-- 🔴 APLICARLO NO CAMBIA NADA PARA NADIE. Las columnas nacen vacías y la app
-- solo las lee con la bandera encendida (sql/salamanca-encender-agenda.sql).
-- Sin este SQL tampoco se rompe nada: la app pregunta antes si la columna
-- existe (information_schema) y, si no, sigue como siempre.
--
-- ADITIVO e IDEMPOTENTE: solo ADD COLUMN IF NOT EXISTS y CREATE … IF NOT
-- EXISTS. CERO DROP, cero RENAME, cero cambios de tipo, cero UPDATE de datos.
-- Columnas camelCase ENTRECOMILLADAS (así las escribe Prisma).
-- Delimitador con nombre ($sal$), nunca $$ pelado: Supabase lo rompe.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run. Lo pega Rafael.
-- ⛔ NO `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Hora de comida por doctor y día ─────────────────────────────────
-- Opcional y en pareja: o las dos horas o ninguna. La app valida además que
-- caiga dentro del horario de ese día y que termine después de empezar.
ALTER TABLE "doctor_schedules" ADD COLUMN IF NOT EXISTS "lunchStart" TEXT;
ALTER TABLE "doctor_schedules" ADD COLUMN IF NOT EXISTS "lunchEnd"   TEXT;

-- Las dos o ninguna. Las columnas nacen vacías, así que se cumple al crearla.
DO $sal$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doctor_schedules_lunch_pareja') THEN
    ALTER TABLE "doctor_schedules"
      ADD CONSTRAINT "doctor_schedules_lunch_pareja"
      CHECK (("lunchStart" IS NULL) = ("lunchEnd" IS NULL));
  END IF;
END
$sal$;

COMMENT ON COLUMN "doctor_schedules"."lunchStart" IS
  'WS1-T5: inicio de la hora de comida (HH:MM, hora de pared de la clínica). Solo cuenta con la bandera agenda-flexible.';
COMMENT ON COLUMN "doctor_schedules"."lunchEnd" IS
  'WS1-T5: fin de la hora de comida (HH:MM, exclusiva). Solo cuenta con la bandera agenda-flexible.';


-- ── 2. Color de cada procedimiento en la agenda ────────────────────────
-- Fuera de schema.prisma A PROPÓSITO (procedure_catalog se lee sin select en
-- media app): la app lo lee y escribe por SQL crudo.
ALTER TABLE "procedure_catalog" ADD COLUMN IF NOT EXISTS "agendaColor" TEXT;

COMMENT ON COLUMN "procedure_catalog"."agendaColor" IS
  'WS1-T5: clave de color del procedimiento en la agenda (morado, azul, cian, verde, oliva, ambar, naranja, coral, rosa, gris). NULL = color por defecto.';


-- ── 3. La tabla de interruptores por clínica (ya debería existir) ──────
CREATE TABLE IF NOT EXISTS "clinic_feature_flags" (
  "clinicId"  text         NOT NULL,
  "flag"      text         NOT NULL,
  "enabled"   boolean      NOT NULL DEFAULT true,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clinic_feature_flags_pkey" PRIMARY KEY ("clinicId", "flag")
);


-- ── Comprobación (solo lectura) ────────────────────────────────────────
-- Debe devolver 3 filas: lunchStart, lunchEnd, agendaColor.
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND ((table_name = 'doctor_schedules'  AND column_name IN ('lunchStart', 'lunchEnd'))
     OR (table_name = 'procedure_catalog' AND column_name = 'agendaColor'))
 ORDER BY table_name, column_name;
