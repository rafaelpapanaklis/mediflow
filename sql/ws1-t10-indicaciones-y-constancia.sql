-- ============================================================================
-- WS1-T10 — Indicaciones postoperatorias y constancia de asistencia
-- (mejora 12 de la auditoría BEVADENT, para TODAS las clínicas).
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal no
--    toca la base.
--
-- QUÉ GUARDA: la biblioteca de hojas de cada clínica (Administración →
-- Plantillas → «Indicaciones» y «Constancia»): los textos de fábrica que
-- DaleControl siembra la primera vez que alguien abre esa pantalla o el cuadro
-- de la cita, y las copias que escribe la clínica. Cada hoja de indicaciones se
-- liga a procedimientos del catálogo ("procedureIds", ids de procedure_catalog).
--
-- TABLA NUEVA y SIN modelo de Prisma: el código la lee por SQL crudo
-- (src/lib/indicaciones/db.ts) y, mientras no exista, la función se oculta
-- (pregunta con to_regclass, sin lanzar consultas que fallen). La constancia de
-- asistencia funciona desde antes con el texto de fábrica; editarla necesita esto.
--
-- Plano e idempotente: se puede pegar dos veces. Sin DROP, sin UPDATE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "patient_handout_templates" (
  "id"           text        PRIMARY KEY,
  "clinicId"     text        NOT NULL REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- 'INDICACIONES' (después de un procedimiento) o 'CONSTANCIA' (de asistencia).
  "kind"         text        NOT NULL CHECK ("kind" IN ('INDICACIONES', 'CONSTANCIA')),
  "name"         text        NOT NULL,
  -- Texto plano con marcadores [NOMBRE_PACIENTE]…; viñetas con «- ».
  "body"         text        NOT NULL,
  "procedureIds" text[]      NOT NULL DEFAULT '{}',
  -- Solo en las sembradas por DaleControl ('extraccion', 'constancia'…): su texto no se edita.
  "factoryKey"   text,
  -- En una copia: de qué texto de fábrica salió (para proponerla por palabras).
  "basedOn"      text,
  "isActive"     boolean     NOT NULL DEFAULT true,
  "createdById"  text,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz NOT NULL DEFAULT now()
);

-- Un texto de fábrica una sola vez por clínica (la siembra usa ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS "patient_handout_templates_factory_key"
  ON "patient_handout_templates" ("clinicId", "factoryKey") WHERE "factoryKey" IS NOT NULL;

-- «Extracción» y «extracción» son la misma hoja para quien las lee en una lista.
CREATE UNIQUE INDEX IF NOT EXISTS "patient_handout_templates_name_key"
  ON "patient_handout_templates" ("clinicId", "kind", lower("name"));

CREATE INDEX IF NOT EXISTS "patient_handout_templates_clinic_idx"
  ON "patient_handout_templates" ("clinicId", "kind", "isActive");

-- Deny-all para anon/authenticated (Prisma usa el service role y salta RLS).
-- Con RLS activo y SIN políticas nadie más lee ni escribe esta tabla.
ALTER TABLE "patient_handout_templates" ENABLE ROW LEVEL SECURITY;

-- Verificación (solo lectura):
-- SELECT to_regclass('public.patient_handout_templates') IS NOT NULL AS existe;
-- SELECT c."name", h."kind", h."name", h."factoryKey", h."isActive", cardinality(h."procedureIds") AS procedimientos
-- FROM "patient_handout_templates" h JOIN "clinics" c ON c."id" = h."clinicId"
-- ORDER BY c."name", h."kind", h."name" LIMIT 50;
