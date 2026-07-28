import { prisma } from "@/lib/prisma";
import {
  BLOG_PAGE_SIZE,
  BLOG_RSS_LIMIT,
  BLOG_SITEMAP_CAP,
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
// devuelven vacío en vez de romper el build.
// ─────────────────────────────────────────────────────────────────────────────

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
  const where = opts?.category ? { ...PUBLISHED, category: opts.category } : { ...PUBLISHED };

  try {
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
  } catch (e) {
    console.error("[blog/queries] listPublishedPosts error:", e);
    return { ...EMPTY_LIST, page };
  }
}

/** Artículo publicado por slug. null (→ notFound) si es draft/scheduled/archived. */
export async function getPublishedPostBySlug(slug: string): Promise<BlogPostDTO | null> {
  if (!slug) return null;
  try {
    const row = await prisma.blogPost.findFirst({ where: { ...PUBLISHED, slug } });
    return row ? toBlogPostDTO(row) : null;
  } catch (e) {
    console.error("[blog/queries] getPublishedPostBySlug error:", e);
    return null;
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
  } catch (e) {
    console.error("[blog/queries] getRelatedPosts error:", e);
    return [];
  }
}

/** Últimos N publicados — /blog/rss.xml. */
export async function listRecentPublished(limit = BLOG_RSS_LIMIT): Promise<BlogPostCardDTO[]> {
  try {
    const rows = await prisma.blogPost.findMany({
      where: PUBLISHED,
      orderBy: { publishedAt: "desc" },
      select: CARD_SELECT,
      take: limit,
    });
    return rows.map(toCard);
  } catch (e) {
    console.error("[blog/queries] listRecentPublished error:", e);
    return [];
  }
}

export interface BlogSitemapEntry {
  slug: string;
  lastModified: Date;
}

/** Slugs publicados para el sitemap (cap 5000). lastModified = updatedAt ?? publishedAt. */
export async function listPublishedForSitemap(): Promise<BlogSitemapEntry[]> {
  const rows = await prisma.blogPost.findMany({
    where: PUBLISHED,
    orderBy: { publishedAt: "desc" },
    select: { slug: true, updatedAt: true, publishedAt: true },
    take: BLOG_SITEMAP_CAP,
  });
  return rows.map((r) => ({
    slug: r.slug,
    lastModified: r.updatedAt ?? r.publishedAt ?? new Date(),
  }));
}

/** Conteo de publicados por categoría — chips con número en el índice. */
export async function countPublishedByCategory(): Promise<Record<string, number>> {
  try {
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
  } catch (e) {
    console.error("[blog/queries] countPublishedByCategory error:", e);
    return {};
  }
}
