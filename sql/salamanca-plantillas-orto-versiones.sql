-- ============================================================================
-- WS1-T6 — Plantillas de fábrica EDITABLES por clínica (para TODAS las clínicas).
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal no
--    toca la base.
--
-- QUÉ GUARDA: la VERSIÓN DE UNA CLÍNICA de una plantilla de fábrica. Cuando una
-- clínica edita una plantilla de fábrica (nota de ortodoncia, indicaciones,
-- constancia, consentimiento), la de fábrica no se toca: aquí queda el texto de
-- ESA clínica, que reemplaza a la de fábrica solo ahí. «Volver a la de fábrica»
-- no borra: marca "archivedAt" y la fila se queda para siempre.
--
-- TABLA NUEVA y SIN modelo de Prisma (src/lib/plantillas-fabrica/db.ts): ninguna
-- tabla existente cambia. Mientras no exista, las plantillas de fábrica siguen
-- siendo de solo lectura (el código pregunta con to_regclass, sin consultas que
-- fallen).
--
-- Plano e idempotente: se puede pegar dos veces. Sin DROP, sin UPDATE, sin DELETE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "clinic_template_versions" (
  "id"           text        PRIMARY KEY,
  "clinicId"     text        NOT NULL REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Qué tipo de plantilla es.
  "family"       text        NOT NULL CHECK ("family" IN ('ORTO_NOTA', 'HOJA_INDICACIONES', 'HOJA_CONSTANCIA', 'CONSENTIMIENTO')),
  -- Cuál plantilla de fábrica reemplaza: el nombre (notas de ortodoncia), la
  -- clave ('extraccion', 'constancia'…) o la clave del catálogo de consentimientos.
  "factoryKey"   text        NOT NULL,
  -- El texto de la clínica (en las notas de ortodoncia, el SOAP en JSON).
  "body"         text        NOT NULL,
  "createdById"  text,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz NOT NULL DEFAULT now(),
  -- NULL = vigente. Con fecha = archivada («Volver a la de fábrica»); nunca se borra.
  "archivedAt"   timestamptz,
  "archivedById" text
);

-- Una sola versión VIGENTE por clínica y plantilla de fábrica (las archivadas pueden ser muchas).
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_template_versions_vigente_key"
  ON "clinic_template_versions" ("clinicId", "family", "factoryKey") WHERE "archivedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "clinic_template_versions_clinic_idx"
  ON "clinic_template_versions" ("clinicId", "family");

-- Deny-all para anon/authenticated (Prisma usa el service role y salta RLS).
ALTER TABLE "clinic_template_versions" ENABLE ROW LEVEL SECURITY;

-- Verificación (solo lectura):
-- SELECT to_regclass('public.clinic_template_versions') IS NOT NULL AS existe;
-- SELECT c."name", v."family", v."factoryKey", v."archivedAt" IS NULL AS vigente, v."updatedAt"
-- FROM "clinic_template_versions" v JOIN "clinics" c ON c."id" = v."clinicId"
-- ORDER BY c."name", v."family", v."factoryKey" LIMIT 50;
