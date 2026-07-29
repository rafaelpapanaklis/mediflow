import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Inter } from "next/font/google";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { SalesFooter } from "@/components/public/landing/sales";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { JsonLd } from "@/components/blog/json-ld";
import { ViewTracker } from "@/components/blog/view-tracker";
import { BlogMarkdown } from "@/components/blog/markdown";
import { BlogCta, BlogFaq, BlogRelated } from "@/components/blog/ui";
import { getPublishedPostBySlug, getRelatedPosts } from "@/lib/blog/queries";
import { blogCategoryLabel, isBlogCategory } from "@/lib/blog/categories";
import { formatBlogDate } from "@/lib/blog/types";
import "@/components/public/landing/sales/sales.css";
import "../blog.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

interface Props {
  params: { slug: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// /blog/[slug] — la ficha del artículo, la superficie que recibe el tráfico
// orgánico.
//
// Sin generateStaticParams a propósito: exigiría BD en build time y el build de
// Vercel corre sin garantía de DATABASE_URL. Con `revalidate` la página se
// genera bajo demanda la primera vez y queda cacheada como ISR; publicar o
// editar la invalida al instante vía revalidateBlog().
//
// SOLO `status = 'published'`: un borrador o un programado devuelven 404 real,
// no una página vacía (getPublishedPostBySlug filtra en el where).
// ─────────────────────────────────────────────────────────────────────────────
export const revalidate = 3600;

/** URL de la OG dinámica (/og/blog?title=…) para este artículo. */
function ogUrlFor(title: string): string {
  return `${SITE_URL}/og/blog?title=${encodeURIComponent(title.slice(0, 110))}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPublishedPostBySlug(params.slug);
  if (!post) {
    // Sin metadata inventada para un 404 — y sin indexar la página de error.
    return { title: "Artículo no encontrado | DaleControl", robots: { index: false, follow: false } };
  }
  return buildMetadata({
    title: post.metaTitle || post.title,
    description: post.metaDescription,
    path: `/blog/${post.slug}`,
    ogImage: ogUrlFor(post.title),
    keywords: post.tags,
  });
}

export default async function BlogPostPage({ params }: Props) {
  const post = await getPublishedPostBySlug(params.slug);
  if (!post) notFound();

  const related = await getRelatedPosts(post, 3);
  const url = `${SITE_URL}/blog/${post.slug}`;
  const categoryLabel = blogCategoryLabel(post.category);
  const categoryHref = isBlogCategory(post.category)
    ? `/blog/categoria/${post.category}`
    : "/blog";

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title.slice(0, 110),
    description: post.metaDescription,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    datePublished: post.publishedAt,
    dateModified: post.updatedAt || post.publishedAt,
    inLanguage: "es-MX",
    articleSection: categoryLabel,
    image: [ogUrlFor(post.title)],
    author: { "@type": "Organization", name: "DaleControl", url: SITE_URL },
    publisher: { "@type": "Organization", name: "DaleControl", url: SITE_URL },
    ...(post.tags.length > 0 ? { keywords: post.tags.join(", ") } : {}),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}/blog` },
      { "@type": "ListItem", position: 3, name: categoryLabel, item: `${SITE_URL}${categoryHref}` },
      { "@type": "ListItem", position: 4, name: post.title, item: url },
    ],
  };

  // FAQPage sólo si el artículo trae preguntas — un FAQPage vacío es un
  // rich-result inválido.
  const faqLd =
    post.faq.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: post.faq.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }
      : null;

  return (
    <div className={`mfh ${inter.variable}`} style={{ minHeight: "100dvh" }}>
      <SalesNavSession />
      <main>
        <section className="mfh-section--tight mfh-band--violet" style={{ paddingBottom: 0 }}>
          <div className="mfh-container">
            <div className="blog-article">
              <nav className="blog-breadcrumb" aria-label="Migas de pan">
                <Link href="/blog">Blog</Link>
                <span aria-hidden="true">/</span>
                <Link href={categoryHref}>{categoryLabel}</Link>
              </nav>

              <h1 className="blog-article__title">{post.title}</h1>
              <p className="blog-article__lede">{post.excerpt}</p>

              <div className="blog-article__meta">
                <span>{post.author}</span>
                <span className="blog-card__dot" aria-hidden="true" />
                <time dateTime={post.publishedAt ?? undefined}>
                  {formatBlogDate(post.publishedAt)}
                </time>
                <span className="blog-card__dot" aria-hidden="true" />
                <span>{post.readingMinutes} min de lectura</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mfh-section--tight">
          <div className="mfh-container">
            <div className="blog-article">
              {/* Markdown puro: sin HTML crudo, mismo renderer que la vista
                  previa del admin. */}
              <BlogMarkdown content={post.contentMd} />

              {post.tags.length > 0 && (
                <div className="blog-tags">
                  {post.tags.map((t) => (
                    <span key={t} className="blog-tag">
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              {post.faq.length > 0 && (
                <section style={{ marginTop: 48 }} aria-labelledby="blog-faq-title">
                  <h2 id="blog-faq-title" className="blog-related__title">
                    Preguntas frecuentes
                  </h2>
                  <BlogFaq items={post.faq} />
                </section>
              )}

              <BlogCta />

              <BlogRelated posts={related} />
            </div>
          </div>
        </section>
      </main>
      <SalesFooter />
      <ViewTracker slug={post.slug} />
      <JsonLd data={articleLd} />
      <JsonLd data={breadcrumbLd} />
      {faqLd ? <JsonLd data={faqLd} /> : null}
    </div>
  );
}
