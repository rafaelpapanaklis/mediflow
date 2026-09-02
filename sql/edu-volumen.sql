-- ══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — EL ÍNDICE DEL P2-6 (volumen de evaluación).
--
-- UN SOLO ÍNDICE. Ni una tabla, ni una columna, ni un enum, ni una fila.
-- No toca el dental, ni barbería, ni inmuebles: `edu_appointments` es una
-- tabla PROPIA del vertical institucional.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- Idempotente: `IF NOT EXISTS`. Correrlo dos veces no hace nada la segunda.
--
-- ⚠️ NO ES BLOQUEANTE PARA EL DEPLOY, y es la diferencia con los .sql de
-- las olas anteriores. Aquí no hay ninguna columna nueva que el cliente
-- Prisma vaya a pedir: sin este índice el código funciona igual, solo que
-- la consulta de horas clínicas lee más páginas de las necesarias. Se
-- puede aplicar antes, durante o después.
--
-- ══════════════════════════════════════════════════════════════════════
-- POR QUÉ HACÍA FALTA
--
-- La pantalla de evaluación cuenta las HORAS CLÍNICAS de cada estudiante
-- sumando sus citas COMPLETADAS. La consulta es, en esencia:
--
--   WHERE "institutionId" = ? AND "studentId" IN (...) AND status='COMPLETED'
--     AND "startsAt" >= <arranque de su generación>
--
-- El único índice que servía era `edu_appointments_student_idx`
-- (institutionId, studentId, startsAt) — y ahí **`status` no entra**, así
-- que Postgres lee TODAS las citas de esos estudiantes y descarta después
-- las que no están COMPLETED. La auditoría lo señaló (docs/audits/
-- EDU_AUDIT.md, P2-6) y el instituto de demo lo midió: para la generación
-- vigente, **4 505 filas leídas para quedarse con 3 315**. Un 26 % de
-- lectura tirada, en la consulta más cara del panel.
--
-- Con `status` DENTRO del índice y ANTES de `startsAt`, el filtro por
-- estado se resuelve en el propio índice y el rango de fechas se recorre
-- ya limpio. El orden de las columnas no es decorativo:
--   (institutionId, studentId) → igualdad, lo primero siempre
--   status                     → igualdad, antes de cualquier rango
--   startsAt                   → el RANGO, que va ÚLTIMO porque una vez
--                                 que entras en él se acabó la búsqueda
--
-- ⚠️ ESTE ÍNDICE NO ESTÁ EN prisma/schema.prisma, y es a propósito: el
-- schema es un archivo COMPARTIDO con el dental y esta rama no lo toca.
-- Es el mismo trato que ya tienen los índices trigram del vertical
-- (`edu_patients_search_trgm` y compañía, sql/edu-ola-1b.sql): viven solo
-- aquí. La consecuencia hay que saberla — un `prisma db push` contra una
-- base de desarrollo se lo llevaría por delante, y se recupera volviendo a
-- correr este archivo, que para eso es idempotente. En producción no se
-- corre `db push`, así que no se pierde.
-- ══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "edu_appointments_student_status_idx"
  ON "edu_appointments" ("institutionId", "studentId", "status", "startsAt");

-- Comprobación: tiene que devolver UNA fila.
SELECT indexname
FROM pg_indexes
WHERE tablename = 'edu_appointments'
  AND indexname = 'edu_appointments_student_status_idx';
