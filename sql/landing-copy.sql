-- ============================================================
-- MINI-WEB: TODO EL TEXTO EDITABLE  (landing v3)
--
-- Una sola columna. Guarda un mapa PLANO { clave: texto } con lo que la
-- clínica reescribió de su página: kickers, etiquetas de botones, leyendas
-- de las cifras, avisos, llamadas a la acción.
--
-- Las claves las DECLARA el manifiesto de cada plantilla
-- (src/app/[slug]/_shared/template-manifest.ts → `copia`). Una clave que
-- ningún manifiesto declara no se guarda: el PATCH la rechaza. No es una
-- bolsa libre.
--
-- Los textos por defecto de la plantilla NUNCA se escriben aquí: vaciar un
-- campo borra su clave y vuelve a salir el literal real de la plantilla.
--
-- Correr en el SQL Editor de Supabase. Idempotente: se puede correr dos
-- veces sin efecto.
-- ============================================================

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS "landingCopy" JSONB;

COMMENT ON COLUMN clinics."landingCopy" IS
  'Mini-web: textos que reescribió la clínica, { claveDelManifiesto: texto }. Las claves las declara TemplateManifest.copia; los defaults de la plantilla no se guardan.';

-- Comprobación: debe devolver una fila con jsonb.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'clinics' AND column_name = 'landingCopy';
