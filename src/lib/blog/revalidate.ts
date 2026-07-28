import { revalidatePath } from "next/cache";

// ─────────────────────────────────────────────────────────────────────────────
// Invalidación de las superficies públicas del blog.
//
// Mismo espíritu que src/lib/cache/revalidate.ts (CACHE_GROUPS), pero aquí las
// rutas son dinámicas por slug/categoría, así que se pasan como argumento en
// vez de vivir en un set estático.
//
// Lo llaman: el cron de publicación y las mutaciones del admin (crear, editar,
// publicar ahora, archivar, eliminar, importar).
// ─────────────────────────────────────────────────────────────────────────────

/** Rutas fijas que cambian con CUALQUIER mutación de artículos. */
const BLOG_STATIC_PATHS = ["/blog", "/blog/rss.xml", "/sitemap.xml"];

export function revalidateBlog(opts?: {
  slugs?: (string | null | undefined)[];
  categories?: (string | null | undefined)[];
}): void {
  const seen: Record<string, true> = {};
  const paths: string[] = BLOG_STATIC_PATHS.slice();

  const cats = opts?.categories ?? [];
  for (let i = 0; i < cats.length; i++) {
    if (cats[i]) paths.push(`/blog/categoria/${cats[i]}`);
  }

  const slugs = opts?.slugs ?? [];
  for (let i = 0; i < slugs.length; i++) {
    if (slugs[i]) paths.push(`/blog/${slugs[i]}`);
  }

  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (seen[p]) continue;
    seen[p] = true;
    try {
      revalidatePath(p);
    } catch (e) {
      // revalidatePath truena fuera de un render/route handler (p.ej. si algún
      // día lo llamamos desde un script). No debe tumbar la mutación.
      console.warn(`[blog/revalidate] no se pudo revalidar ${p}:`, e);
    }
  }
}
