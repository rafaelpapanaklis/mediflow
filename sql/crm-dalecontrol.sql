-- ═══════════════════════════════════════════════════════════════════════
-- CRM DE VENTAS DE DALECONTROL — /admin/crm
--
-- La libreta de a quién le queremos vender: clínicas, universidades,
-- barberías, laboratorios. NO son clientes — el cliente que ya paga vive
-- en "clinics" y esta migración no la toca ni de lejos.
--
-- Dos pantallas la usan: /admin/crm, que lo ve TODO, y /afiliados/crm,
-- donde cada socio da de alta lo que recomienda y ve SÓLO lo suyo. Lo que
-- los separa es la columna "affiliateId" — ver su comentario abajo.
--
-- Qué crea:
--   2 tablas  · "crm_prospects" (el prospecto) y "crm_activities" (la
--               bitácora: cada WhatsApp, llamada, junta, nota y cambio de
--               etapa)
--   1 llave foránea · crm_activities."prospectId" → crm_prospects (CASCADE:
--               borrar un prospecto se lleva su bitácora, que sin él no
--               significa nada)
--   7 índices · los del esquema de Prisma, con SUS nombres exactos
--   2 policies RLS deny-all (anon/authenticated). Importa: la tabla lleva
--               teléfonos y correos de negocios reales.
--   0 backfill · nace vacía; el panel tiene botón para importar pegando
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
--
-- 🔴 APLICARLO ANTES DEL DEPLOY. El cliente Prisma nuevo conoce estas dos
-- tablas; sin ellas ni /admin/crm ni /afiliados/crm pueden leer nada. Las
-- dos pantallas NO se caen (dicen con todas sus letras que falta correr
-- este archivo) y el badge del menú trae su propio catch, así que el resto
-- de /admin y del panel del socio siguen funcionando igual — pero el CRM
-- no sirve hasta que esto corra.
--
-- ADITIVO e idempotente: cada bloque comprueba existencia antes de crear,
-- así que correrlo dos veces no produce errores ni duplicados. CERO DROP,
-- CERO ALTER sobre tablas existentes.
--
-- Nota sobre $$: delimitador con nombre, $crm$, y NUNCA bloques DO
-- anidados — el parser SQL de Supabase rompe con $$ anidado.
--
-- Nota sobre los nombres: las columnas van en camelCase ENTRECOMILLADO
-- porque así las escribe Prisma; sin comillas Postgres las bajaría a
-- minúsculas y el cliente dejaría de encontrarlas.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 LAS DOS DECISIONES DE ESTE ESQUEMA, Y POR QUÉ
--
--   · LA ETAPA ES TEXT, NO UN ENUM. El resto del repo usa enums de
--     Postgres (realty_leads.stage, edu_*). Aquí no: un embudo de ventas
--     se retoca seguido y cada retoque de un enum es un ALTER TYPE a mano
--     en Supabase ANTES de desplegar. Con TEXT, agregar "Prueba gratis" es
--     editar un arreglo de TypeScript. El catálogo completo vive en
--     src/lib/admin/crm/crm-core.ts y el servicio valida contra él antes
--     de escribir: la integridad la pone la aplicación, a sabiendas.
--
--   · "clinicId" NO LLEVA LLAVE FORÁNEA. Cuando un prospecto se gana se
--     puede apuntar qué clínica nació de él, pero es un id suelto: este
--     CRM interno JAMÁS debe poder estorbar el borrado de una cuenta viva
--     por una referencia de la libreta de ventas. La ficha resuelve el
--     nombre con una consulta aparte que ya trae su propio catch.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. El prospecto ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "crm_prospects" (
    "id"             TEXT NOT NULL,

    -- El negocio y qué producto se le vende.
    "name"           TEXT NOT NULL,
    "vertical"       TEXT NOT NULL DEFAULT 'DENTAL',
    "stage"          TEXT NOT NULL DEFAULT 'NUEVO',
    "source"         TEXT,

    -- Con quién se habla.
    "contactName"    TEXT,
    "contactRole"    TEXT,
    "phone"          TEXT,
    "email"          TEXT,

    "city"           TEXT,
    "state"          TEXT,
    -- País: los afiliados capturan "Ciudad / País" y hay prospectos fuera
    -- de México.
    "country"        TEXT,
    "website"        TEXT,

    -- Tamaño en la unidad del giro (consultorios, sillones, estudiantes)
    -- y cuánto pagaría al mes si cierra.
    "size"           INTEGER,
    "monthlyValue"   DOUBLE PRECISION,

    -- El próximo paso: LA columna que hace que esto sirva. Es una FECHA DE
    -- CALENDARIO guardada a las 12:00 UTC. A medianoche UTC caería a las
    -- 18:00 del día anterior en México y el seguimiento se pintaría un día
    -- antes en todo el país.
    "nextActionAt"   TIMESTAMP(3),
    "nextActionNote" TEXT,

    -- Último contacto REAL (WhatsApp, llamada, correo, junta, visita). Una
    -- nota interna no lo mueve.
    "lastContactAt"  TIMESTAMP(3),

    "wonAt"          TIMESTAMP(3),
    "lostAt"         TIMESTAMP(3),
    "lostReason"     TEXT,

    -- Sin llave foránea, a propósito (ver arriba).
    "clinicId"       TEXT,

    "notes"          TEXT,
    "tags"           TEXT[] NOT NULL DEFAULT '{}',

    -- Correo del admin que lo dio de alta, denormalizado: la libreta tiene
    -- que sobrevivir a que se dé de baja quien la escribió.
    "createdByEmail" TEXT,

    -- 🔴 QUIÉN LO RECOMENDÓ. NULL = lo dio de alta DaleControl desde
    -- /admin/crm; con valor = lo mandó ese afiliado desde /afiliados/crm.
    -- Es la columna que SEPARA lo que cada afiliado puede ver. Sin llave
    -- foránea a "affiliates", igual que "clinicId": dar de baja a un socio
    -- no puede quedar bloqueado por la libreta de ventas, y un id colgando
    -- se pinta como "afiliado dado de baja" — mejor que convertir sus
    -- prospectos en propios sin que nadie se entere, que es lo que haría
    -- un ON DELETE SET NULL.
    "affiliateId"    TEXT,

    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_prospects_pkey" PRIMARY KEY ("id")
);

-- Los cinco índices del esquema, con los nombres que genera Prisma.
CREATE INDEX IF NOT EXISTS "crm_prospects_stage_idx"        ON "crm_prospects"("stage");
CREATE INDEX IF NOT EXISTS "crm_prospects_nextActionAt_idx" ON "crm_prospects"("nextActionAt");
CREATE INDEX IF NOT EXISTS "crm_prospects_vertical_idx"     ON "crm_prospects"("vertical");
CREATE INDEX IF NOT EXISTS "crm_prospects_createdAt_idx"    ON "crm_prospects"("createdAt");
-- El que usa el panel del afiliado en CADA una de sus consultas.
CREATE INDEX IF NOT EXISTS "crm_prospects_affiliateId_idx"  ON "crm_prospects"("affiliateId");


-- ── 2. La bitácora ─────────────────────────────────────────────────────
-- Sólo se agrega: nada la reescribe. Es lo que contesta "¿ya le escribí?",
-- que es justo la pregunta que hace que un prospecto se pierda cuando
-- nadie la puede contestar.

CREATE TABLE IF NOT EXISTS "crm_activities" (
    "id"          TEXT NOT NULL,
    "prospectId"  TEXT NOT NULL,

    -- WHATSAPP | LLAMADA | EMAIL | REUNION | VISITA | NOTA | ETAPA.
    -- ETAPA la escribe el sistema al mover el prospecto de columna.
    "kind"        TEXT NOT NULL,
    "body"        TEXT,
    "outcome"     TEXT,

    -- Para kind = 'ETAPA'. En columnas propias y no en un JSON: se
    -- consultan, se leen de un vistazo y no arrastran el enredo de DbNull
    -- de Prisma.
    "stageFrom"   TEXT,
    "stageTo"     TEXT,

    -- CUÁNDO PASÓ, que no siempre es cuándo se anotó (se puede registrar
    -- una llamada de ayer). La bitácora se ordena por esto.
    "happenedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorEmail" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "crm_activities_prospectId_happenedAt_idx"
    ON "crm_activities"("prospectId", "happenedAt");
CREATE INDEX IF NOT EXISTS "crm_activities_happenedAt_idx"
    ON "crm_activities"("happenedAt");


-- ── 3. La llave foránea ────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que va envuelta.
-- CASCADE y no SET NULL: una anotación sin prospecto no significa nada.

DO $crm$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_activities_prospectId_fkey'
  ) THEN
    ALTER TABLE "crm_activities"
      ADD CONSTRAINT "crm_activities_prospectId_fkey"
      FOREIGN KEY ("prospectId") REFERENCES "crm_prospects"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$crm$;


-- ── 4. RLS deny-all restrictive (patrón sql/rls-deny-all-policies.sql) ──
-- Niega todo a anon/authenticated; el service role (Prisma, desde el
-- servidor) la sigue usando igual. Importa de verdad aquí: son teléfonos,
-- correos y notas de negocios reales, y además dejan ver a quién le está
-- vendiendo DaleControl.

DO $crm$
DECLARE
  t    text;
  tbls text[] := ARRAY['crm_prospects', 'crm_activities'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = t
        AND policyname = t || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        t || '_deny_anon', t
      );
    END IF;
  END LOOP;
END
$crm$;


-- ═══════════════════════════════════════════════════════════════════════
-- Verificación post-aplicación (correr y comparar a ojo)
-- ═══════════════════════════════════════════════════════════════════════
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name IN ('crm_prospects','crm_activities');
--   → 2 filas
--
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname = 'public' AND tablename IN ('crm_prospects','crm_activities');
--   → 9 filas (7 índices + las 2 llaves primarias)
--
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public' AND tablename IN ('crm_prospects','crm_activities');
--   → 2 filas, ambas *_deny_anon
