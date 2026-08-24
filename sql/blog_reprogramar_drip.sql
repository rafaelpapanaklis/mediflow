-- ─────────────────────────────────────────────────────────────────────────────
-- BLOG · Reprogramar el drip de artículos cuyas fechas quedaron en el pasado
--
-- YA SE CORRIÓ en Supabase el 18-ago-2026. Se guarda como constancia y como
-- remedio manual si vuelve a pasar (ajusta el ancla y los artículos por día
-- antes de volver a ejecutarlo — ver "ANTES DE REUTILIZARLO").
--
-- QUÉ PASÓ (bug de src/lib/blog/import.ts, firstDripSlot): el importador
-- calculaba el primer hueco del lote como "último scheduledAt de la BD + 1 día"
-- sin compararlo contra hoy. El último programado era del 11-ago, así que el
-- 18-ago los 60 artículos del lote entraron con fechas del 12 al 17 a 10 por
-- día: todas vencidas. El cron de publicación (src/app/api/cron/blog-publish)
-- toma `status = 'scheduled' AND "scheduledAt" <= now()` con take 200, así que
-- en su siguiente corrida habría publicado los 60 de golpe en vez de gotearlos.
--
-- EL ARREGLO en código (mismo deploy que este archivo): firstDripSlot devuelve
-- el máximo entre "último + 1 día" y el primer hueco válido contado desde
-- ahora. Este script es el remedio para filas que YA están en la BD con fecha
-- vencida; el código arreglado evita que vuelvan a entrar así.
--
-- QUÉ HACE: toma TODOS los artículos en 'scheduled', los ordena por
-- (scheduledAt, createdAt, slug) para conservar el orden previsto y los
-- reparte de nuevo a partir del ancla, 10 por día, todos a las 13:00 UTC (la
-- hora del drip: BLOG_IMPORT_LIMITS.publishHourUtc). Los publicados y los
-- borradores no se tocan. Es idempotente: correrlo dos veces con el mismo
-- ancla deja las mismas fechas.
--
-- ANTES DE REUTILIZARLO:
--   · el ancla ('2026-08-18 13:00:00+00') debe ser el primer hueco válido
--     desde hoy: hoy a las 13:00 UTC si aún no pasó, o mañana a las 13:00;
--   · el divisor (10) es cuántos artículos se publican por día;
--   · comprobar antes con:
--       SELECT slug, "scheduledAt" FROM blog_posts
--       WHERE status = 'scheduled' ORDER BY "scheduledAt", "createdAt", slug;
-- ─────────────────────────────────────────────────────────────────────────────

WITH orden AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "scheduledAt", "createdAt", slug) - 1 AS rn
  FROM blog_posts WHERE status = 'scheduled'
)
UPDATE blog_posts b
SET "scheduledAt" = TIMESTAMPTZ '2026-08-18 13:00:00+00' + (o.rn / 10) * INTERVAL '1 day'
FROM orden o WHERE b.id = o.id;
