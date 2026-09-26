-- ============================================================================
-- WS1-T6 — clic de Google Ads (gclid / gbraid / wbraid) ligado a la clínica.
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal no
--    toca la base.
--
-- PARA QUÉ: el SPEI directo se confirma en /admin y no pasa por la página de
-- éxito, así que ningún pixel lo mide. Para atribuirlo a la campaña hace falta
-- tener guardado el clic con el que llegó la persona, y solo existe al llegar:
-- lo guarda /api/auth/register (y register-oauth) al crear la clínica.
--
-- TABLA NUEVA y no columna en "clinics": si el código se despliega sin este SQL,
-- una columna nueva en clinics tumbaría todas las consultas de Prisma. Aquí el
-- código usa SQL crudo, no un modelo, y tolera que la tabla no exista (avisa en
-- el log y el alta sigue igual). Por eso NO va a prisma/schema.prisma.
--
-- ORDEN: aplica este SQL ANTES de integrar/desplegar. Las altas que ocurran sin
-- la tabla pierden su clic (no hay forma de recuperarlo después).
--
-- Plano e idempotente: se puede pegar dos veces. Sin DO $$, sin migraciones.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "clinic_ads_clicks" (
  "clinicId"  text        PRIMARY KEY REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "gclid"     text,
  "gbraid"    text,
  "wbraid"    text,
  -- Cuándo dio el clic (lo que declara la cookie), no cuándo se registró.
  "clickedAt" timestamptz,
  -- De qué cookie salió: 'dc_ads' (la propia, server-side) o '_gcl_aw' (respaldo de gtag).
  "source"    text        NOT NULL DEFAULT 'dc_ads',
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- Para cruzar contra la exportación de Google Ads y para la importación sin conexión.
CREATE INDEX IF NOT EXISTS "clinic_ads_clicks_gclid_idx"
  ON "clinic_ads_clicks" ("gclid") WHERE "gclid" IS NOT NULL;

-- Deny-all para anon/authenticated (Prisma usa el service role y salta RLS).
-- Con RLS activo y SIN políticas nadie más lee ni escribe esta tabla.
ALTER TABLE "clinic_ads_clicks" ENABLE ROW LEVEL SECURITY;

-- Verificación (solo lectura):
-- SELECT c."name", k."gclid", k."gbraid", k."wbraid", k."clickedAt", k."source", k."createdAt"
-- FROM "clinic_ads_clicks" k JOIN "clinics" c ON c."id" = k."clinicId"
-- ORDER BY k."createdAt" DESC LIMIT 20;
