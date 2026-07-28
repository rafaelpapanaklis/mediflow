import Link from "next/link";
import { BLOG_CATEGORIES, blogCategoryLabel } from "@/lib/blog/categories";
import { formatBlogDate, type BlogFaqItem, type BlogPostCardDTO } from "@/lib/blog/types";

// ─────────────────────────────────────────────────────────────────────────────
// Piezas presentacionales del blog público. Todas son server components: no
// hay estado ni handlers (el acordeón de FAQ usa <details> nativo, que además
// deja el texto en el HTML para Google aunque esté colapsado).
//
// Los estilos viven en src/app/blog/blog.css — cada página que monte estos
// componentes debe importarlo.
// ─────────────────────────────────────────────────────────────────────────────

export function BlogPostCard({ post }: { post: BlogPostCardDTO }) {
  return (
    <Link href={`/blog/${post.slug}`} className="blog-card">
      <span className="blog-card__cat">{blogCategoryLabel(post.category)}</span>
      <h3 className="blog-card__title">{post.title}</h3>
      <p className="blog-card__excerpt">{post.excerpt}</p>
      <div className="blog-card__meta">
        <time dateTime={post.publishedAt ?? undefined}>{formatBlogDate(post.publishedAt)}</time>
        <span className="blog-card__dot" aria-hidden="true" />
        <span>{post.readingMinutes} min de lectura</span>
      </div>
    </Link>
  );
}

export function BlogGrid({ posts }: { posts: BlogPostCardDTO[] }) {
  return (
    <div className="blog-grid">
      {posts.map((p) => (
        <BlogPostCard key={p.id} post={p} />
      ))}
    </div>
  );
}

/**
 * Chips de categoría. `counts` es opcional: sin él no se muestra el número
 * (el índice de categoría no necesita recontar todo el blog).
 */
export function BlogCategoryChips({
  activeSlug,
  counts,
}: {
  activeSlug?: string | null;
  counts?: Record<string, number>;
}) {
  return (
    <nav className="blog-chips" aria-label="Categorías del blog">
      <Link href="/blog" className={`blog-chip ${!activeSlug ? "blog-chip--active" : ""}`}>
        Todos
      </Link>
      {BLOG_CATEGORIES.map((c) => {
        const n = counts ? counts[c.slug] ?? 0 : undefined;
        return (
          <Link
            key={c.slug}
            href={`/blog/categoria/${c.slug}`}
            className={`blog-chip ${activeSlug === c.slug ? "blog-chip--active" : ""}`}
          >
            {c.label}
            {typeof n === "number" && n > 0 && <span className="blog-chip__n">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Paginación por query `?page=`. `basePath` es /blog o /blog/categoria/<cat>. */
export function BlogPager({
  page,
  totalPages,
  basePath,
}: {
  page: number;
  totalPages: number;
  basePath: string;
}) {
  if (totalPages <= 1) return null;
  const href = (p: number) => (p <= 1 ? basePath : `${basePath}?page=${p}`);

  return (
    <nav className="blog-pager" aria-label="Paginación">
      {page > 1 ? (
        <Link href={href(page - 1)} className="blog-pager__link" rel="prev">
          ← Anteriores
        </Link>
      ) : null}
      <span className="blog-pager__state">
        Página {page} de {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={href(page + 1)} className="blog-pager__link" rel="next">
          Siguientes →
        </Link>
      ) : null}
    </nav>
  );
}

export function BlogEmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="blog-empty">
      <p className="blog-empty__title">{title}</p>
      <p className="blog-empty__text">{text}</p>
    </div>
  );
}

export function BlogFaq({ items }: { items: BlogFaqItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="blog-faq">
      {items.map((item, i) => (
        <details key={`${i}-${item.q.slice(0, 24)}`} className="blog-faq__item">
          <summary className="blog-faq__q">
            <span>{item.q}</span>
            <span className="blog-faq__sign" aria-hidden="true" />
          </summary>
          <div className="blog-faq__a">{item.a}</div>
        </details>
      ))}
    </div>
  );
}

/**
 * CTA de cierre. SIN CIFRAS a propósito: los precios cambian y viven en un solo
 * lugar (la landing). Un número en un artículo indexado envejece mal.
 */
export function BlogCta() {
  return (
    <aside className="blog-cta">
      <div style={{ minWidth: 0 }}>
        <p className="blog-cta__title">Lleva el control de tu clínica con DaleControl</p>
        <p className="blog-cta__text">
          Agenda, expediente, WhatsApp y facturación en un solo lugar. Descubre cómo
          funciona y pruébalo con tu equipo.
        </p>
      </div>
      <Link href="/" className="mfh-btn mfh-btn--primary" style={{ whiteSpace: "nowrap" }}>
        Conoce DaleControl
      </Link>
    </aside>
  );
}

export function BlogRelated({ posts }: { posts: BlogPostCardDTO[] }) {
  if (posts.length === 0) return null;
  return (
    <section style={{ marginTop: 48 }} aria-labelledby="blog-related-title">
      <h2 id="blog-related-title" className="blog-related__title">
        Artículos relacionados
      </h2>
      <BlogGrid posts={posts} />
    </section>
  );
}
