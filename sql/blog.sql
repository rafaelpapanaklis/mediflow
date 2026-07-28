-- ═══════════════════════════════════════════════════════════════════════
-- Blog SEO público (dalecontrol.com/blog) — schema.
-- IDEMPOTENTE: seguro re-correr en el SQL editor de Supabase.
--
-- Equivalente idempotente del modelo Prisma BlogPost (al final de
-- prisma/schema.prisma). Contenido GLOBAL de marca: NO lleva clinicId ni
-- relación a Clinic — no es multi-tenant. Lo escribe el admin de plataforma
-- (/admin/blog, guard AdminUser) y lo lee todo internet.
--
-- Los artículos llegan ya redactados por el importador JSON del admin y el
-- cron /api/cron/blog-publish los promueve scheduled → published en goteo.
--
-- `status` y `category` son TEXT, no enums de Postgres — igual que
-- support_tickets: los valores válidos los define la app
-- (src/lib/blog/types.ts y src/lib/blog/categories.ts). Aquí sólo hay un
-- CHECK sobre `status`, que es un conjunto cerrado y estable; las categorías
-- pueden crecer sin tocar la BD.
--
-- Nota sobre $$: usamos un único delimitador `$bl$` y NUNCA bloques DO
-- anidados (el parser SQL de Supabase rompe con $$ anidado).
-- ═══════════════════════════════════════════════════════════════════════


-- ── Tabla ─────────────────────────────────────────────────────────────

-- TIMESTAMPTZ (no TIMESTAMP como el resto del repo) a propósito: el drip
-- programa a una hora absoluta (13:00 UTC) y el cron compara contra now().
-- Con una columna naive la hora quedaría ambigua. El modelo Prisma lo declara
-- con @db.Timestamptz(3), así que no hay drift.
CREATE TABLE IF NOT EXISTS "blog_posts" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metaTitle" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "contentMd" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "cluster" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "faq" JSONB,
    "relatedSlugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMPTZ(3),
    "publishedAt" TIMESTAMPTZ(3),
    "author" TEXT NOT NULL DEFAULT 'Equipo DaleControl',
    "readingMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);


-- ── Constraints ───────────────────────────────────────────────────────

-- Mismo regex que valida la app (src/lib/blog/types.ts): minúsculas, dígitos
-- y guiones simples, sin guion inicial/final, máx 90. Es la última línea de
-- defensa: el slug va directo a la URL pública /blog/<slug>.
DO $bl$
BEGIN
  ALTER TABLE "blog_posts"
    ADD CONSTRAINT "blog_posts_slug_format_check"
    CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") <= 90);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$bl$;

DO $bl$
BEGIN
  ALTER TABLE "blog_posts"
    ADD CONSTRAINT "blog_posts_status_check"
    CHECK ("status" IN ('draft', 'scheduled', 'published', 'archived'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$bl$;


-- ── Índices ───────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_slug_key"
    ON "blog_posts"("slug");

-- Barrido del cron de publicación (status='scheduled' AND scheduledAt <= now()).
CREATE INDEX IF NOT EXISTS "blog_posts_status_scheduledAt_idx"
    ON "blog_posts"("status", "scheduledAt");

-- Índice público, RSS y sitemap (status='published' ORDER BY publishedAt DESC).
CREATE INDEX IF NOT EXISTS "blog_posts_status_publishedAt_idx"
    ON "blog_posts"("status", "publishedAt" DESC);

CREATE INDEX IF NOT EXISTS "blog_posts_category_idx"
    ON "blog_posts"("category");

CREATE INDEX IF NOT EXISTS "blog_posts_cluster_idx"
    ON "blog_posts"("cluster");


-- ── RLS deny-all ──────────────────────────────────────────────────────
-- Patrón del repo: la app entra SIEMPRE por Prisma + service role, que
-- bypassa RLS por diseño. Con RLS habilitada y CERO policies, ningún rol
-- normal (anon / authenticated) puede leer ni escribir vía PostgREST — que
-- es justo lo que queremos: los borradores y los artículos programados no
-- deben ser legibles por nadie hasta que el cron los publique.
ALTER TABLE "blog_posts" ENABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════════════
-- Verificación post-aplicación:
--   SELECT count(*) FROM "blog_posts";                     -- 0 al inicio
--   SELECT relrowsecurity FROM pg_class
--     WHERE relname = 'blog_posts';                        -- t
--   SELECT indexname FROM pg_indexes
--     WHERE tablename = 'blog_posts';                      -- 6 (pkey + 5)
-- ═══════════════════════════════════════════════════════════════════════
