-- ============================================================================
-- WS1-T10 — origen de la clínica: clic de Meta (fbclid / fbc / fbp) y UTM del
-- primer y del último toque, en la misma fila de "clinic_ads_clicks".
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal no
--    toca la base.
--
-- PARA QUÉ: saber qué clínicas llegaron por Meta («Meta · campaña · anuncio»)
-- y darle a la API de Conversiones el fbc/fbp de la clínica cuando el pago no
-- pasa por el navegador (SPEI que se confirma en /admin).
--
-- NO REQUIERE sql/ws1-t6-ads-clics.sql aplicado antes: si la tabla aún no existe
-- se crea aquí con la misma definición (CREATE TABLE IF NOT EXISTS); si ya
-- existe, solo se le añaden columnas. Las dos formas dejan el mismo resultado.
--
-- ORDEN: aplícalo ANTES de integrar/desplegar. El código funciona sin él (el
-- alta sigue igual y el clic de Google se guarda como siempre), pero las altas
-- que ocurran sin las columnas pierden su fbclid/UTM y no se pueden recuperar.
--
-- COLUMNAS NUEVAS (todas opcionales, sin DEFAULT: las filas viejas quedan NULL):
--   platform       'google' | 'meta' — la plataforma del ÚLTIMO clic.
--   fbclid         el ?fbclid= tal cual llegó.
--   fbc            «fb.1.<epoch ms>.<fbclid>», el formato que Meta pide.
--   fbp            la cookie _fbp del navegador al registrarse.
--   metaClickedAt  cuándo dio el clic de Meta.
--   utm*First      utm_source/medium/campaign/content del PRIMER toque con UTM.
--   utm*Last       lo mismo del ÚLTIMO toque con UTM.
--
-- "clickedAt" y "source" conservan su significado de ws1-t6: el clic de GOOGLE.
--
-- Plano e idempotente: se puede pegar dos veces. Sin DO $$, sin DROP.
-- Sin tabla nueva que no sea la de ws1-t6: RLS sigue activo y sin políticas.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "clinic_ads_clicks" (
  "clinicId"  text        PRIMARY KEY REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "gclid"     text,
  "gbraid"    text,
  "wbraid"    text,
  "clickedAt" timestamptz,
  "source"    text        NOT NULL DEFAULT 'dc_ads',
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "clinic_ads_clicks_gclid_idx"
  ON "clinic_ads_clicks" ("gclid") WHERE "gclid" IS NOT NULL;

ALTER TABLE "clinic_ads_clicks"
  ADD COLUMN IF NOT EXISTS "platform"         text,
  ADD COLUMN IF NOT EXISTS "fbclid"           text,
  ADD COLUMN IF NOT EXISTS "fbc"              text,
  ADD COLUMN IF NOT EXISTS "fbp"              text,
  ADD COLUMN IF NOT EXISTS "metaClickedAt"    timestamptz,
  ADD COLUMN IF NOT EXISTS "utmSourceFirst"   text,
  ADD COLUMN IF NOT EXISTS "utmMediumFirst"   text,
  ADD COLUMN IF NOT EXISTS "utmCampaignFirst" text,
  ADD COLUMN IF NOT EXISTS "utmContentFirst"  text,
  ADD COLUMN IF NOT EXISTS "utmFirstAt"       timestamptz,
  ADD COLUMN IF NOT EXISTS "utmSourceLast"    text,
  ADD COLUMN IF NOT EXISTS "utmMediumLast"    text,
  ADD COLUMN IF NOT EXISTS "utmCampaignLast"  text,
  ADD COLUMN IF NOT EXISTS "utmContentLast"   text,
  ADD COLUMN IF NOT EXISTS "utmLastAt"        timestamptz;

-- Para cruzar contra Meta y para contar clínicas por campaña/anuncio.
CREATE INDEX IF NOT EXISTS "clinic_ads_clicks_fbclid_idx"
  ON "clinic_ads_clicks" ("fbclid") WHERE "fbclid" IS NOT NULL;

-- Deny-all para anon/authenticated (Prisma usa el service role y salta RLS).
-- Con RLS activo y SIN políticas nadie más lee ni escribe esta tabla.
ALTER TABLE "clinic_ads_clicks" ENABLE ROW LEVEL SECURITY;

-- Verificación (solo lectura):
-- SELECT c."name", k."platform", k."utmCampaignLast", k."utmContentLast", k."fbclid" IS NOT NULL AS tiene_fbclid, k."createdAt"
-- FROM "clinic_ads_clicks" k JOIN "clinics" c ON c."id" = k."clinicId"
-- ORDER BY k."createdAt" DESC LIMIT 20;
