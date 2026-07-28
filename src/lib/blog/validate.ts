import { isBlogCategory, BLOG_CATEGORY_SLUGS } from "./categories";
import {
  BLOG_LIMITS,
  isBlogStatus,
  isValidBlogSlug,
  normalizeFaq,
  readingMinutesFor,
  type BlogFaqItem,
  type BlogStatus,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Validación del payload del EDITOR del admin (crear / editar un artículo).
//
// Comparte límites y reglas con el importador JSON (src/lib/blog/import.ts),
// pero el contrato de entrada es distinto: aquí llega un objeto suelto desde un
// formulario, con campos opcionales en el PATCH. El importador valida lotes.
//
// Devuelve un discriminated union en vez de lanzar: el route handler traduce
// `ok:false` a un 400 con el mensaje tal cual, que ya está redactado para que
// lo lea una persona.
// ─────────────────────────────────────────────────────────────────────────────

export interface BlogPostWriteData {
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
  scheduledAt: Date | null;
  author: string;
  readingMinutes: number;
}

/**
 * Discriminante de TEXTO (`kind`), no booleano: con `strict: false` en el
 * tsconfig del repo, TypeScript no estrecha una unión por un discriminante
 * `ok: true | false` y el build falla al leer `.error`. Con literales de
 * string el narrowing por `===` funciona igual en modo no estricto.
 */
export type ValidationResult =
  | { kind: "ok"; data: BlogPostWriteData }
  | { kind: "error"; error: string };

const fail = (error: string): ValidationResult => ({ kind: "error", error });

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (let i = 0; i < v.length && out.length < maxItems; i++) {
    const s = str(v[i]).slice(0, maxLen);
    if (s && out.indexOf(s) === -1) out.push(s);
  }
  return out;
}

/**
 * Valida el objeto completo de un artículo. Para un PATCH, el caller fusiona
 * el body sobre la fila actual y pasa el resultado — así una edición parcial
 * se valida con las mismas reglas que una creación y no puede dejar la fila
 * en un estado inválido.
 */
export function validateBlogPost(body: any): ValidationResult {
  const slug = str(body?.slug);
  if (!slug) return fail("El slug es obligatorio.");
  if (!isValidBlogSlug(slug)) {
    return fail(
      `Slug inválido: sólo minúsculas, números y guiones simples, máximo ${BLOG_LIMITS.slug} caracteres (y no puede ser una ruta reservada del blog).`,
    );
  }

  const title = str(body?.title);
  if (!title) return fail("El título es obligatorio.");
  if (title.length > BLOG_LIMITS.title) {
    return fail(`El título excede ${BLOG_LIMITS.title} caracteres.`);
  }

  const metaTitle = str(body?.metaTitle);
  if (!metaTitle) return fail("El meta title es obligatorio.");
  if (metaTitle.length > BLOG_LIMITS.metaTitle) {
    return fail(
      `El meta title tiene ${metaTitle.length} caracteres (máximo ${BLOG_LIMITS.metaTitle}).`,
    );
  }

  const metaDescription = str(body?.metaDescription);
  if (!metaDescription) return fail("La meta description es obligatoria.");
  if (
    metaDescription.length < BLOG_LIMITS.metaDescriptionMin ||
    metaDescription.length > BLOG_LIMITS.metaDescriptionMax
  ) {
    return fail(
      `La meta description tiene ${metaDescription.length} caracteres (debe ser ${BLOG_LIMITS.metaDescriptionMin}–${BLOG_LIMITS.metaDescriptionMax}).`,
    );
  }

  const excerpt = str(body?.excerpt);
  if (!excerpt) return fail("El extracto es obligatorio.");
  if (excerpt.length > BLOG_LIMITS.excerpt) {
    return fail(`El extracto excede ${BLOG_LIMITS.excerpt} caracteres.`);
  }

  const contentMd = typeof body?.contentMd === "string" ? body.contentMd.trim() : "";
  if (!contentMd) return fail("El contenido en markdown es obligatorio.");
  if (contentMd.length > BLOG_LIMITS.contentMd) {
    return fail(`El contenido excede ${BLOG_LIMITS.contentMd} caracteres.`);
  }

  const category = str(body?.category);
  if (!isBlogCategory(category)) {
    return fail(`Categoría inválida. Válidas: ${BLOG_CATEGORY_SLUGS.join(", ")}.`);
  }

  const status = isBlogStatus(body?.status) ? body.status : "draft";

  let scheduledAt: Date | null = null;
  if (body?.scheduledAt) {
    const d = new Date(body.scheduledAt);
    if (isNaN(d.getTime())) return fail("La fecha de programación no es válida.");
    scheduledAt = d;
  }
  if (status === "scheduled" && !scheduledAt) {
    return fail("Un artículo programado necesita fecha de programación.");
  }

  return {
    kind: "ok",
    data: {
      slug,
      title,
      metaTitle,
      metaDescription,
      excerpt,
      contentMd,
      category,
      cluster: str(body?.cluster).slice(0, BLOG_LIMITS.cluster) || null,
      tags: strArray(body?.tags, BLOG_LIMITS.tags, BLOG_LIMITS.tagLength),
      faq: normalizeFaq(body?.faq),
      relatedSlugs: strArray(body?.relatedSlugs, BLOG_LIMITS.relatedSlugs, BLOG_LIMITS.slug),
      status,
      scheduledAt,
      author: str(body?.author).slice(0, BLOG_LIMITS.author) || "Equipo DaleControl",
      readingMinutes: readingMinutesFor(contentMd),
    },
  };
}

/**
 * publishedAt derivado del estado destino:
 *  - pasa a `published` y aún no tenía fecha → ahora;
 *  - ya la tenía → se respeta (republicar no reescribe la fecha original, que
 *    es la que ve Google en el JSON-LD);
 *  - cualquier otro estado → se conserva lo que hubiera (archivar un artículo
 *    no borra cuándo se publicó).
 */
export function resolvePublishedAt(
  status: BlogStatus,
  current: Date | null,
  now: Date,
): Date | null {
  if (status === "published") return current ?? now;
  return current;
}
