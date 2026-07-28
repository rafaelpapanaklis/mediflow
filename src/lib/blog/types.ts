// ─────────────────────────────────────────────────────────────────────────────
// Contrato compartido del blog: estados, límites, validación de slug y el DTO
// que viaja del server al cliente (fechas ya serializadas a ISO).
//
// Lo importan el admin, el importador JSON, las rutas públicas, el RSS, el
// sitemap y el cron — es la única fuente de verdad de "qué es válido".
// ─────────────────────────────────────────────────────────────────────────────

export const BLOG_STATUSES = ["draft", "scheduled", "published", "archived"] as const;
export type BlogStatus = (typeof BLOG_STATUSES)[number];

export const BLOG_STATUS_LABELS: Record<BlogStatus, string> = {
  draft: "Borrador",
  scheduled: "Programado",
  published: "Publicado",
  archived: "Archivado",
};

export function isBlogStatus(v: unknown): v is BlogStatus {
  return typeof v === "string" && (BLOG_STATUSES as readonly string[]).includes(v);
}

// ── Límites ──────────────────────────────────────────────────────────────────
// Los de meta son los que Google suele respetar sin truncar; los de título y
// excerpt son topes defensivos, no reglas de SEO.

export const BLOG_LIMITS = {
  slug: 90,
  title: 160,
  metaTitle: 60,
  metaDescriptionMin: 140,
  metaDescriptionMax: 160,
  excerpt: 400,
  contentMd: 200_000,
  tags: 12,
  tagLength: 40,
  faqItems: 20,
  faqQuestion: 300,
  faqAnswer: 2000,
  relatedSlugs: 10,
  author: 80,
  cluster: 90,
} as const;

/** Tamaño y volumen máximos de UN lote del importador JSON. */
export const BLOG_IMPORT_LIMITS = {
  maxItems: 200,
  maxBytes: 5 * 1024 * 1024, // 5 MB
  defaultPerDay: 3,
  maxPerDay: 24,
  /** Hora UTC a la que se programan los artículos del drip. */
  publishHourUtc: 13,
} as const;

/** Artículos por página en el índice público. */
export const BLOG_PAGE_SIZE = 12;

/** Últimos N artículos en /blog/rss.xml. */
export const BLOG_RSS_LIMIT = 50;

/** Tope de URLs de blog en el sitemap. */
export const BLOG_SITEMAP_CAP = 5000;

// ── Slug ─────────────────────────────────────────────────────────────────────

export const BLOG_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Segmentos que ya existen bajo /blog como rutas propias. Un artículo con uno
 * de estos slugs sería inalcanzable (la ruta estática gana sobre [slug]), así
 * que se rechaza al crear/importar en vez de dejar un post fantasma.
 */
export const BLOG_RESERVED_SLUGS = ["categoria", "rss.xml", "page", "feed"];

export function isReservedBlogSlug(slug: unknown): boolean {
  return typeof slug === "string" && BLOG_RESERVED_SLUGS.indexOf(slug) !== -1;
}

/** Formato correcto Y no reservado — es lo que exige la BD y la ruta pública. */
export function isValidBlogSlug(slug: unknown): slug is string {
  return (
    typeof slug === "string" &&
    slug.length > 0 &&
    slug.length <= BLOG_LIMITS.slug &&
    BLOG_SLUG_REGEX.test(slug) &&
    !isReservedBlogSlug(slug)
  );
}

/** Normaliza un título a slug (ayuda del editor; el usuario puede editarlo). */
export function slugifyTitle(title: string): string {
  return (title ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos (marcas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BLOG_LIMITS.slug)
    .replace(/-+$/g, "");
}

// ── Minutos de lectura ───────────────────────────────────────────────────────

/** palabras / 200, redondeado, mínimo 1. */
export function readingMinutesFor(contentMd: string): number {
  const words = (contentMd ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 1;
  return Math.max(1, Math.round(words / 200));
}

// ── FAQ ──────────────────────────────────────────────────────────────────────

export interface BlogFaqItem {
  q: string;
  a: string;
}

/**
 * `faq` viaja como Json de Prisma (unknown en la práctica). Esto lo aterriza a
 * un array tipado y descarta cualquier forma inesperada — el render y el
 * JSON-LD nunca ven basura.
 */
export function normalizeFaq(raw: unknown): BlogFaqItem[] {
  if (!Array.isArray(raw)) return [];
  const out: BlogFaqItem[] = [];
  for (let i = 0; i < raw.length && out.length < BLOG_LIMITS.faqItems; i++) {
    const item = raw[i] as any;
    if (!item || typeof item !== "object") continue;
    const q = typeof item.q === "string" ? item.q.trim() : "";
    const a = typeof item.a === "string" ? item.a.trim() : "";
    if (q && a) out.push({ q, a });
  }
  return out;
}

// ── DTO ──────────────────────────────────────────────────────────────────────

/** Fila completa tal como la usa el admin (fechas en ISO). */
export interface BlogPostDTO {
  id: string;
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  contentMd: string;
  category: string;
  cluster: string | null;
  tags: string[];
  faq: BlogFaqItem[];
  relatedSlugs: string[];
  status: BlogStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  author: string;
  readingMinutes: number;
  createdAt: string;
  updatedAt: string;
}

/** Versión ligera para listados públicos (sin el markdown completo). */
export type BlogPostCardDTO = Omit<BlogPostDTO, "contentMd" | "faq" | "relatedSlugs">;

const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  return typeof d === "string" ? d : d.toISOString();
};

/** Prisma row → DTO. `row` es `any` porque el select varía según el caller. */
export function toBlogPostDTO(row: any): BlogPostDTO {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    excerpt: row.excerpt,
    contentMd: row.contentMd ?? "",
    category: row.category,
    cluster: row.cluster ?? null,
    tags: row.tags ?? [],
    faq: normalizeFaq(row.faq),
    relatedSlugs: row.relatedSlugs ?? [],
    status: isBlogStatus(row.status) ? row.status : "draft",
    scheduledAt: iso(row.scheduledAt),
    publishedAt: iso(row.publishedAt),
    author: row.author ?? "Equipo DaleControl",
    readingMinutes: row.readingMinutes ?? 1,
    createdAt: iso(row.createdAt) ?? "",
    updatedAt: iso(row.updatedAt) ?? "",
  };
}

// ── Formato de fecha ─────────────────────────────────────────────────────────

/** "12 de marzo de 2026" — fecha larga es-MX para la ficha del artículo. */
export function formatBlogDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
