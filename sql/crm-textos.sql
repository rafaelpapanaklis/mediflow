-- ═══════════════════════════════════════════════════════════════════════
-- "MIS TEXTOS" DEL CRM DE VENTAS — /admin/crm/textos
--
-- La libreta de mensajes de venta de DaleControl: lo que se le manda a un
-- prospecto por WhatsApp o por correo, escrito UNA vez y reusado. Se copia
-- al portapapeles y lo pega una persona — NO es una plantilla de WhatsApp
-- Business (esas se aprueban en Meta y las manda el producto), así que
-- aquí no hay estado de entrega ni de aprobación.
--
-- Qué crea:
--   1 tabla   · "crm_templates"
--   2 índices · los del esquema de Prisma, con SUS nombres exactos
--   1 policy RLS deny-all (anon/authenticated), como el resto del CRM
--   0 backfill · nace vacía; la pantalla lo dice y trae botón para escribir
--                el primero
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar TODO → Run.
--
-- ⚠️ ESTE ARCHIVO NO ES EL ÚNICO PENDIENTE DEL CRM.
--    "crm_templates" no depende de las otras dos tablas del CRM, pero la
--    pantalla desde la que se usa sí: si "crm_prospects" y "crm_activities"
--    todavía no existen, primero corre sql/crm-dalecontrol.sql y después
--    este. Comprobación de 5 segundos, antes de nada:
--
--      SELECT table_name FROM information_schema.tables
--       WHERE table_schema = 'public'
--         AND table_name IN ('crm_prospects','crm_activities','crm_templates');
--
--    → 0 filas: corre crm-dalecontrol.sql y luego éste.
--    → 2 filas: sólo falta éste.
--    → 3 filas: ya está todo; correrlo otra vez no hace nada.
--
-- 🔴 APLICARLO ANTES DEL DEPLOY. El cliente Prisma nuevo conoce la tabla.
-- La pantalla NO se cae sin ella —cada lectura de textos trae su propio
-- catch y /admin/crm sigue funcionando entero, sin la sección de textos—,
-- pero los textos no se pueden ni ver ni guardar hasta que esto corra.
--
-- ADITIVO e idempotente: cada bloque comprueba existencia antes de crear.
-- CERO DROP, CERO ALTER sobre tablas existentes.
--
-- Nota sobre $$: delimitador con nombre, $crmtx$, y NUNCA bloques DO
-- anidados — el parser SQL de Supabase rompe con $$ anidado.
--
-- Nota sobre los nombres: las columnas van en camelCase ENTRECOMILLADO
-- porque así las escribe Prisma; sin comillas Postgres las bajaría a
-- minúsculas y el cliente dejaría de encontrarlas.
--
-- ═══════════════════════════════════════════════════════════════════════
-- LAS DOS DECISIONES DE ESTE ESQUEMA, Y POR QUÉ
--
--   · "vertical" Y "stage" SON OPCIONALES Y NO LLEVAN LLAVE. NULL quiere
--     decir "sirve para cualquiera", que es el caso más común y no puede
--     costar trabajo. Son TEXT contra los mismos catálogos de TypeScript
--     que el resto del CRM (CRM_VERTICALES, CRM_ETAPAS) — misma decisión y
--     mismo motivo que la etapa del prospecto: el embudo se retoca seguido
--     y cada retoque de un enum sería un ALTER TYPE a mano antes de
--     desplegar. La integridad la pone el servicio, a sabiendas.
--
--   · NO HAY DUEÑO NI "clinicId". /admin es la sesión de PLATAFORMA de
--     DaleControl: sus textos son de la casa, no de una clínica ni de un
--     socio. /afiliados/crm no consulta esta tabla, y por eso la policy
--     deny-all de abajo alcanza — no hace falta una regla por dueño.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. La tabla ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "crm_templates" (
    "id"             TEXT NOT NULL,

    -- Cómo se encuentra después. Es lo que hace que la libreta sirva
    -- cuando ya hay veinte textos.
    "title"          TEXT NOT NULL,

    -- El mensaje. Puede traer huecos —{{negocio}}, {{ciudad}}, {{saludo}}—
    -- que se rellenan con el prospecto abierto. El catálogo de huecos vive
    -- en src/lib/admin/crm/textos-core.ts y uno fuera del catálogo se
    -- rechaza AL GUARDAR, no al copiar.
    "body"           TEXT NOT NULL,

    -- NULL = sirve para cualquier giro / en cualquier momento del embudo.
    "vertical"       TEXT,
    "stage"          TEXT,

    -- El orden que le puso la persona. Se reescribe ENTERO al reordenar,
    -- no se intercambian dos valores: dos textos nuevos nacen los dos en 0
    -- y con intercambios se saltarían de sitio entre recargas.
    "sortOrder"      INTEGER NOT NULL DEFAULT 0,

    -- Correo del admin que lo escribió, denormalizado: la libreta tiene que
    -- sobrevivir a que se dé de baja quien la escribió (mismo criterio que
    -- "createdByEmail" de crm_prospects).
    "createdByEmail" TEXT,

    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_templates_pkey" PRIMARY KEY ("id")
);

-- Los dos índices del esquema, con los nombres que genera Prisma.
CREATE INDEX IF NOT EXISTS "crm_templates_sortOrder_idx" ON "crm_templates"("sortOrder");
CREATE INDEX IF NOT EXISTS "crm_templates_vertical_idx"  ON "crm_templates"("vertical");


-- ── 2. RLS deny-all restrictive (patrón sql/rls-deny-all-policies.sql) ──
-- Niega todo a anon/authenticated; el service role (Prisma, desde el
-- servidor) la sigue usando igual. Estos textos son el guion de venta de
-- DaleControl: no tienen por qué poder leerse desde el navegador de nadie.

DO $crmtx$
DECLARE
  t text := 'crm_templates';
BEGIN
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
END
$crmtx$;


-- ═══════════════════════════════════════════════════════════════════════
-- Verificación post-aplicación (correr y comparar a ojo)
-- ═══════════════════════════════════════════════════════════════════════
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name = 'crm_templates';
--   → 1 fila
--
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname = 'public' AND tablename = 'crm_templates';
--   → 3 filas (2 índices + la llave primaria)
--
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'crm_templates';
--   → 1 fila: crm_templates_deny_anon
