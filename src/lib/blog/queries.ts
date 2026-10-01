import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { BLOG_CACHE_TAG } from "./revalidate";
import {
  BLOG_PAGE_SIZE,
  BLOG_RSS_LIMIT,
  BLOG_SITEMAP_CAP,
  isValidBlogSlug,
  toBlogPostDTO,
  type BlogPostCardDTO,
  type BlogPostDTO,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Lecturas PÚBLICAS del blog. Regla única y no negociable de este archivo:
// **todo where lleva `status: "published"` y `publishedAt: { not: null }`**.
// Los borradores y los programados no se sirven en /blog, ni en el RSS, ni en
// el sitemap — el cron es el único que los promueve.
//
// Todas las funciones son tolerantes a build sin DATABASE_URL (mismo patrón
// que src/lib/directory/query.ts + src/app/sitemap.ts): si la query truena,
// devuelven vacío en vez de romper el build. La excepción es el artículo por
// slug: un fallo de la base se LANZA (ver getPublishedPostBySlug).
//
// ── CACHÉ (ws1-t12, incidente del 1-oct-2026) ──────────────────────────────
// Un robot recorriendo /blog/<slug> cada ~2 s abría una conexión por visita y
// ayudó a llenar el pooler de Supabase (EMAXCONN, 200 clientes). Cada lectura
// pública va por `unstable_cache` con la etiqueta BLOG_CACHE_TAG: el resultado
// vive en la caché de datos de Next (la de Vercel, compartida entre funciones)
// y la base solo se consulta una vez por llave cada BLOG_CACHE_SECONDS. Las
// mutaciones (admin, importador, cron de publicación) llaman revalidateBlog(),
// que hace revalidateTag(BLOG_CACHE_TAG): publicar o editar se ve al instante,
// y el plazo es solo la red de seguridad si una invalidación se pierde.
//
// Lo que se cachea es el resultado BUENO: la consulta cruda lanza, el error no
// entra en la caché y quien llama decide (vacío o lanzar). Así un hipo de la
// base no deja cacheado un blog vacío o un 404 durante cinco minutos.
// ─────────────────────────────────────────────────────────────────────────────

/** Vida de una lectura en caché si nadie la invalida antes. */
export const BLOG_CACHE_SECONDS = 300;

function enCache<A extends unknown[], R>(nombre: string, leer: (...args: A) => Promise<R>) {
  return unstable_cache(leer, ["blog-publico", nombre], {
    tags: [BLOG_CACHE_TAG],
    revalidate: BLOG_CACHE_SECONDS,
  });
}

const PUBLISHED = { status: "published", publishedAt: { not: null } } as const;

/** Campos de tarjeta: todo menos el markdown completo. */
const CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  metaTitle: true,
  metaDescription: true,
  excerpt: true,
  category: true,
  cluster: true,
  tags: true,
  status: true,
  scheduledAt: true,
  publishedAt: true,
  author: true,
  readingMinutes: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toCard(row: any): BlogPostCardDTO {
  const dto = toBlogPostDTO({ ...row, contentMd: "", faq: null, relatedSlugs: [] });
  const { contentMd, faq, relatedSlugs, ...card } = dto;
  return card;
}

export interface BlogListResult {
  posts: BlogPostCardDTO[];
  total: number;
  page: number;
  totalPages: number;
}

const EMPTY_LIST: BlogListResult = { posts: [], total: 0, page: 1, totalPages: 1 };

const listaEnCache = enCache(
  "lista",
  async (page: number, category: string | null, pageSize: number): Promise<BlogListResult> => {
    const where = category ? { ...PUBLISHED, category } : { ...PUBLISHED };
    const [total, rows] = await Promise.all([
      prisma.blogPost.count({ where }),
      prisma.blogPost.findMany({
        where,
        orderBy: { publishedAt: "desc" },
        select: CARD_SELECT,
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
    ]);
    return {
      posts: rows.map(toCard),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  },
);

/**
 * Índice paginado. `category` filtra por slug (ya validado contra la lista
 * fija por el caller). Página fuera de rango devuelve lista vacía con el
 * total real — la UI muestra el estado vacío, no un 404.
 */
export async function listPublishedPosts(opts?: {
  page?: number;
  category?: string | null;
  pageSize?: number;
}): Promise<BlogListResult> {
  const pageSize = opts?.pageSize ?? BLOG_PAGE_SIZE;
  const page = Math.max(1, Math.floor(opts?.page ?? 1));

  try {
    // Una página fuera de rango (?page=9999, típico de un robot) sale del
    // conteo en caché, sin consultar la base por cada número inventado.
    const conteos = await conteoEnCache();
    const total = opts?.category
      ? conteos[opts.category] ?? 0
      : Object.keys(conteos).reduce((suma, k) => suma + conteos[k], 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (page > totalPages) return { posts: [], total, page, totalPages };
    return await listaEnCache(page, opts?.category ?? null, pageSize);
  } catch (e) {
    console.error("[blog/queries] listPublishedPosts error:", e);
    return { ...EMPTY_LIST, page };
  }
}

const articuloEnCache = enCache("articulo", async (slug: string): Promise<BlogPostDTO | null> => {
  const row = await prisma.blogPost.findFirst({ where: { ...PUBLISHED, slug } });
  return row ? toBlogPostDTO(row) : null;
});

/**
 * Artículo publicado por slug. null (→ notFound) si es draft/scheduled/archived
 * o si el slug ni siquiera tiene forma de slug (eso no llega a la base: un
 * robot inventando direcciones no abre conexiones).
 *
 * Un fallo de la base SE LANZA, no se convierte en null: /blog/[slug] es ISR y
 * un 404 por un hipo de la base quedaría guardado (y Google desindexa los 404).
 * Lanzando, Next sigue sirviendo la versión anterior de la página, y si no la
 * había, contesta 500 sin guardar nada.
 */
export async function getPublishedPostBySlug(slug: string): Promise<BlogPostDTO | null> {
  if (!isValidBlogSlug(slug)) return null;
  try {
    return await articuloEnCache(slug);
  } catch (e) {
    console.error("[blog/queries] getPublishedPostBySlug error:", e);
    throw e;
  }
}

/**
 * Relacionados: primero los `relatedSlugs` que estén publicados (respetando el
 * orden en que los dejó el autor); si no alcanzan, se rellena con artículos
 * publicados del mismo cluster. Siempre excluye el propio artículo.
 */
export async function getRelatedPosts(
  post: Pick<BlogPostDTO, "id" | "slug" | "cluster" | "relatedSlugs">,
  limit = 3,
): Promise<BlogPostCardDTO[]> {
  try {
    // Solo lo que decide el resultado entra en la llave de la caché.
    return await relacionadosEnCache(post.slug, post.cluster ?? null, post.relatedSlugs ?? [], limit);
  } catch (e) {
    console.error("[blog/queries] getRelatedPosts error:", e);
    return [];
  }
}

const relacionadosEnCache = enCache(
  "relacionados",
  async (
    slug: string,
    cluster: string | null,
    relatedSlugs: string[],
    limit: number,
  ): Promise<BlogPostCardDTO[]> => {
    const post = { slug, cluster, relatedSlugs };
    const wanted = (post.relatedSlugs ?? []).filter((s) => s && s !== post.slug).slice(0, 20);

    let picked: BlogPostCardDTO[] = [];
    if (wanted.length > 0) {
      const rows = await prisma.blogPost.findMany({
        where: { ...PUBLISHED, slug: { in: wanted } },
        select: CARD_SELECT,
        take: limit,
      });
      // Reordena según relatedSlugs (el `in` de Postgres no conserva el orden).
      const cards = rows.map(toCard);
      picked = wanted
        .map((s) => cards.find((c) => c.slug === s))
        .filter(Boolean) as BlogPostCardDTO[];
    }

    if (picked.length >= limit) return picked.slice(0, limit);

    // Fallback: mismo cluster, más recientes primero.
    if (post.cluster) {
      const exclude = picked.map((p) => p.slug).concat([post.slug]);
      const rows = await prisma.blogPost.findMany({
        where: { ...PUBLISHED, cluster: post.cluster, slug: { notIn: exclude } },
        orderBy: { publishedAt: "desc" },
        select: CARD_SELECT,
        take: limit - picked.length,
      });
      picked = picked.concat(rows.map(toCard));
    }

    return picked.slice(0, limit);
  },
);

const recientesEnCache = enCache("recientes", async (limit: number): Promise<BlogPostCardDTO[]> => {
  const rows = await prisma.blogPost.findMany({
    where: PUBLISHED,
    orderBy: { publishedAt: "desc" },
    select: CARD_SELECT,
    take: limit,
  });
  return rows.map(toCard);
});

/** Últimos N publicados — /blog/rss.xml. */
export async function listRecentPublished(limit = BLOG_RSS_LIMIT): Promise<BlogPostCardDTO[]> {
  try {
    return await recientesEnCache(limit);
  } catch (e) {
    console.error("[blog/queries] listRecentPublished error:", e);
    return [];
  }
}

export interface BlogSitemapEntry {
  slug: string;
  lastModified: Date;
}

// La caché guarda JSON: las fechas viajan como texto ISO y se rehacen afuera.
const sitemapEnCache = enCache("sitemap", async (): Promise<{ slug: string; lastModified: string | null }[]> => {
  const rows = await prisma.blogPost.findMany({
    where: PUBLISHED,
    orderBy: { publishedAt: "desc" },
    select: { slug: true, updatedAt: true, publishedAt: true },
    take: BLOG_SITEMAP_CAP,
  });
  return rows.map((r) => ({
    slug: r.slug,
    lastModified: (r.updatedAt ?? r.publishedAt)?.toISOString() ?? null,
  }));
});

/** Slugs publicados para el sitemap (cap 5000). lastModified = updatedAt ?? publishedAt. */
export async function listPublishedForSitemap(): Promise<BlogSitemapEntry[]> {
  const rows = await sitemapEnCache();
  return rows.map((r) => ({
    slug: r.slug,
    lastModified: r.lastModified ? new Date(r.lastModified) : new Date(),
  }));
}

/** Conteo de publicados por categoría — chips con número en el índice. */
const conteoEnCache = enCache("conteo-por-categoria", async (): Promise<Record<string, number>> => {
  const rows = await prisma.blogPost.groupBy({
    by: ["category"],
    where: PUBLISHED,
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (let i = 0; i < rows.length; i++) {
    out[rows[i].category] = rows[i]._count._all;
  }
  return out;
});

export async function countPublishedByCategory(): Promise<Record<string, number>> {
  try {
    return await conteoEnCache();
  } catch (e) {
    console.error("[blog/queries] countPublishedByCategory error:", e);
    return {};
  }
}
