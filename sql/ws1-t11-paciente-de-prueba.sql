-- ⛔ FUNCIÓN CANCELADA (decisión 12 de Rafael, 2-oct-2026): «Paciente de prueba /
-- no contactar» NO existe. Este archivo YA se pegó en producción y se conserva
-- solo como registro de que la columna patients."isTestPatient" existe. El
-- código ya no la lee ni la escribe. NO volver a pegarlo y NO borrar la columna
-- sin permiso de Rafael.
--
-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — ws1-t11 · «PACIENTE DE PRUEBA / NO CONTACTAR» (11d,
-- tercer ticket de BEVADENT; para TODAS las clínicas).
--
-- Una casilla en la ficha (menú «…» de la cabecera). El paciente marcado no
-- recibe ningún mensaje (WhatsApp ni correo, automático ni manual, ni el
-- bot), no genera cargos automáticos y no cuenta en Reportes, Analítica ni
-- los tableros de inicio.
--
-- Contenido: UNA columna nueva en "patients":
--   "isTestPatient" BOOLEAN NOT NULL DEFAULT false
--
-- Nadie queda marcado: Postgres llena la columna con su DEFAULT false en
-- todas las filas existentes (en Postgres 11+ es un cambio de catálogo, sin
-- reescribir la tabla). Sin UPDATE ni backfill.
--
-- No se declara en prisma/schema.prisma a propósito (ver
-- src/lib/patients/paciente-de-prueba-db.ts): `prisma.patient.findMany()` sin
-- `select` se usa en decenas de rutas y, con la columna declarada y este SQL
-- sin pegar, todas tirarían P2022. El código la lee y escribe por SQL crudo.
--
-- ORDEN: da igual. El código de hoy no la conoce y sigue igual con ella
-- puesta; el código nuevo funciona sin ella (nadie es de prueba, nada se
-- bloquea, y la opción del menú sale apagada con «todavía no está activo»).
--
-- RLS: "patients" ya tiene RLS encendido con sus políticas; una columna nueva
-- hereda las de su tabla, no hace falta otra. La comprobación 2 lo muestra.
--
-- IDEMPOTENTE: correrlo varias veces no da errores ni cambia nada.
-- CERO DROP, CERO UPDATE.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS "isTestPatient" BOOLEAN NOT NULL DEFAULT false;

-- Comprobación 1 (solo lee): la columna, boolean, NOT NULL, DEFAULT false.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'patients'
  AND column_name = 'isTestPatient';

-- Comprobación 2 (solo lee): RLS sigue encendido en "patients".
SELECT relname, relrowsecurity
FROM pg_class
WHERE oid = 'public.patients'::regclass;

-- Comprobación 3 (solo lee): nadie marcado todavía (debe dar 0).
SELECT count(*) AS marcados FROM public.patients WHERE "isTestPatient" = true;
