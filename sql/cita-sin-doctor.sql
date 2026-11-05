-- ═══════════════════════════════════════════════════════════════════════
-- Cita «Sin doctor» (ws1-t11 · fase 2 · P1). Aditivo e idempotente.
--
-- appointments."doctorId" deja de ser obligatorio: NULL = la cita todavía no
-- es de nadie (se asigna al llegar o al iniciar la consulta).
--
-- Seguro de pegar ANTES del push: el código de hoy nunca escribe NULL (todas
-- las altas pasan por Prisma con doctorId obligatorio, y no hay INSERT crudo).
-- Mientras no se pegue, el código nuevo no ofrece «Sin doctor» (sonda en
-- src/lib/agenda/sin-doctor.server.ts) y sigue funcionando como siempre.
--
-- No toca: la FK a users, la constraint appt_doctor_no_overlap (NULL nunca
-- choca), la de sillón, el trigger appt_liberar_apartado_vencido ni el índice.
-- DROP NOT NULL no reescribe la tabla; repetirlo no hace nada.
--
-- ⚠️ No crees citas «Sin doctor» en producción hasta que el código nuevo esté
-- desplegado: el cliente de Prisma viejo revienta al leer una fila con NULL.
-- ═══════════════════════════════════════════════════════════════════════
BEGIN;
-- Muere con la transacción: si alguien tiene bloqueada la tabla, falla en vez de esperar. Se vuelve a pegar.
SET LOCAL lock_timeout = '5s';
ALTER TABLE "appointments" ALTER COLUMN "doctorId" DROP NOT NULL;
COMMIT;

-- Verificación: tiene que decir YES.
SELECT is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'doctorId';

-- Reversa (solo mientras NO exista ninguna cita sin doctor):
--   ALTER TABLE "appointments" ALTER COLUMN "doctorId" SET NOT NULL;
-- Para ver si hay alguna:
--   SELECT id, "clinicId", "startsAt" FROM "appointments" WHERE "doctorId" IS NULL;
