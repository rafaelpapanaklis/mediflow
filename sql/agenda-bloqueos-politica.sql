-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T5 · ¿SE PUEDE AGENDAR SOBRE UN DÍA BLOQUEADO?
--
-- Crea UNA tabla nueva ("agenda_block_policies"). NO toca ni una tabla, ni
-- una columna, ni una fila de lo que ya existe: ni un ALTER sobre "clinics".
-- La relación se declara desde la tabla nueva hacia "clinics", así que entra
-- en una base VIVA sin ventana de mantenimiento.
--
-- QUÉ RESUELVE: Configuración → Horarios y bloqueos → «¿Recepción puede
-- agendar sobre un día bloqueado?» no tenía dónde guardarse: la tarjeta
-- pedía /api/settings/bloqueos/politica, esa ruta no existía y salía «No se
-- pudo leer este ajuste». El valor no vivía en ninguna parte de la base.
--
-- 🔴 APLICARLO NO CAMBIA NINGUNA AGENDA. La tabla nace vacía, y una clínica
-- SIN fila aquí sigue en «Sí, avisando y dejando registro», exactamente como
-- hoy. Solo cambia la clínica que entra y elige «No» a propósito.
--
-- Y mientras NO se aplique, el panel no se cae: leer la tabla que falta se
-- toma como «Sí» (src/lib/agenda-bloqueos/politica.server.ts). Lo único que
-- no funciona es GUARDAR: la tarjeta dice que falta este SQL.
--
-- GENERADO con `prisma migrate diff` desde el bloque AgendaBlockPolicy de
-- prisma/schema.prisma y hecho idempotente: cada bloque comprueba existencia
-- antes de crear, así que correrlo varias veces no produce errores ni
-- duplicados. CERO DROP.
--
-- Contenido:
--   1 tabla        · agenda_block_policies (llave primaria = "clinicId")
--   1 llave foránea · clinics, ON DELETE CASCADE
--   RLS deny-all para anon/authenticated (patrón sql/rls-deny-all-policies.sql)
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`: hay migraciones del
-- repo sin registrar contra producción y se llevarían la base por delante.
--
-- Nota sobre $$: delimitador con nombre, $pbdoc$, y NUNCA bloques DO anidados
-- — el parser SQL de Supabase rompe con $$ anidado.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. La tabla ────────────────────────────────────────────────────────
-- Una fila por clínica: "clinicId" ES la llave primaria.
--   · "recepcionPuedeAgendar" true  = «Sí, avisando y dejando registro».
--                             false = «No, queda prohibido».
--   · "updatedById" sin llave foránea a "users" a propósito: el rastro de
--     quién lo cambió va a "audit_logs", y borrar a esa persona no tiene que
--     atorarse aquí.
CREATE TABLE IF NOT EXISTS "agenda_block_policies" (
  "clinicId"              TEXT         NOT NULL,
  "recepcionPuedeAgendar" BOOLEAN      NOT NULL DEFAULT true,
  "updatedById"           TEXT,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agenda_block_policies_pkey" PRIMARY KEY ("clinicId")
);


-- ── 2. La llave foránea ────────────────────────────────────────────────
-- CASCADE: el ajuste no tiene sentido sin su clínica.
DO $pbdoc$
BEGIN
  ALTER TABLE "agenda_block_policies"
    ADD CONSTRAINT "agenda_block_policies_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$pbdoc$;


-- ── 3. Defense-in-depth: RLS deny-all ──────────────────────────────────
-- Mismo patrón que sql/doctor-horarios.sql. DaleControl accede solo vía
-- Prisma + service role (bypassa RLS). Esto cierra PostgREST si se filtra el
-- anon key.
DO $pbdoc$
BEGIN
  EXECUTE 'ALTER TABLE "agenda_block_policies" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agenda_block_policies' AND policyname = 'agenda_block_policies_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "agenda_block_policies_deny_anon" ON "agenda_block_policies" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'agenda_block_policies no existe — RLS saltada';
END
$pbdoc$;


-- ── 4. Comprobación ────────────────────────────────────────────────────
-- Tiene que devolver 1 tabla, 1 índice (la llave primaria), 1 llave foránea,
-- 1 política y 0 filas.
SELECT
  (SELECT count(*) FROM pg_tables  WHERE tablename = 'agenda_block_policies')   AS tablas,
  (SELECT count(*) FROM pg_indexes WHERE tablename = 'agenda_block_policies')   AS indices_pk,
  (SELECT count(*) FROM pg_constraint
     WHERE conrelid = 'agenda_block_policies'::regclass AND contype = 'f')      AS llaves_foraneas,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'agenda_block_policies')  AS politicas,
  (SELECT count(*) FROM "agenda_block_policies")                                AS filas;
