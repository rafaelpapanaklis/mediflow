import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Inter } from "next/font/google";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { SalesFooter } from "@/components/public/landing/sales";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { JsonLd } from "@/components/blog/json-ld";
import {
  BlogCategoryChips,
  BlogEmptyState,
  BlogGrid,
  BlogPager,
} from "@/components/blog/ui";
import { listPublishedPosts } from "@/lib/blog/queries";
import { BLOG_CATEGORIES, getBlogCategory } from "@/lib/blog/categories";
import { BLOG_PAGE_SIZE } from "@/lib/blog/types";
import "@/components/public/landing/sales/sales.css";
import "../../blog.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

interface Props {
  params: { cat: string };
  searchParams?: { page?: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// /blog/categoria/[cat] — índice filtrado.
//
// `dynamicParams = false` + generateStaticParams sobre la lista FIJA: cualquier
// categoría fuera del contrato es 404 sin tocar la BD (mismo patrón que
// /descubre/[categoria]). El notFound() de abajo es la red de seguridad para
// dev, donde dynamicParams no aplica igual.
// ─────────────────────────────────────────────────────────────────────────────
export function generateStaticParams() {
  return BLOG_CATEGORIES.map((c) => ({ cat: c.slug }));
}
export const dynamicParams = false;
export const revalidate = 3600;

export function generateMetadata({ params }: Props): Metadata {
  const cat = getBlogCategory(params.cat);
  if (!cat) return {};
  return buildMetadata({
    title: `${cat.label} para clínicas | Blog DaleControl`,
    description: `${cat.description} Guías prácticas para dueños de clínica en México.`,
    path: `/blog/categoria/${cat.slug}`,
    keywords: [cat.label.toLowerCase(), "blog para clínicas", "gestión de clínicas"],
  });
}

export default async function BlogCategoryPage({ params, searchParams }: Props) {
  const cat = getBlogCategory(params.cat);
  if (!cat) notFound();

  const pageRaw = Number.parseInt(searchParams?.page ?? "", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const { posts, total, totalPages } = await listPublishedPosts({ page, category: cat.slug });
  const basePath = `/blog/categoria/${cat.slug}`;

  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${cat.label} — Blog DaleControl`,
    description: cat.description,
    url: `${SITE_URL}${basePath}`,
    inLanguage: "es-MX",
    isPartOf: {
      "@type": "Blog",
      name: "Blog DaleControl",
      url: `${SITE_URL}/blog`,
      publisher: { "@type": "Organization", name: "DaleControl", url: SITE_URL },
    },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: posts.map((p, i) => ({
        "@type": "ListItem",
        position: (page - 1) * BLOG_PAGE_SIZE + i + 1,
        name: p.title,
        url: `${SITE_URL}/blog/${p.slug}`,
      })),
    },
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}/blog` },
      { "@type": "ListItem", position: 3, name: cat.label, item: `${SITE_URL}${basePath}` },
    ],
  };

  return (
    <div className={`mfh ${inter.variable}`} style={{ minHeight: "100dvh" }}>
      <SalesNavSession />
      <main>
        <section className="mfh-section--tight mfh-band--violet">
          <div className="mfh-container">
            <div className="flex max-w-3xl flex-col items-start gap-4">
              <nav className="blog-breadcrumb" aria-label="Migas de pan">
                <Link href="/blog">Blog</Link>
                <span aria-hidden="true">/</span>
                <span className="blog-breadcrumb__current">{cat.label}</span>
              </nav>
              <h1 className="mfh-h1 mfh-balance">{cat.label}</h1>
              <p className="mfh-lede max-w-2xl">{cat.description}</p>
            </div>
          </div>
        </section>

        <section className="mfh-section--tight" style={{ paddingTop: 0 }}>
          <div className="mfh-container">
            <div style={{ marginBottom: 28 }}>
              <BlogCategoryChips activeSlug={cat.slug} />
            </div>

            {posts.length === 0 ? (
              <BlogEmptyState
                title={page > 1 ? "No hay más artículos" : "Muy pronto"}
                text={
                  page > 1
                    ? "Llegaste al final de esta categoría."
                    : `Todavía no publicamos nada en ${cat.label.toLowerCase()}. Mientras tanto, explora el resto del blog: publicamos contenido nuevo cada semana.`
                }
              />
            ) : (
              <>
                <BlogGrid posts={posts} />
                <div style={{ marginTop: 40 }}>
                  <BlogPager page={page} totalPages={totalPages} basePath={basePath} />
                </div>
              </>
            )}

            {total > 0 && (
              <p
                style={{
                  marginTop: 26,
                  textAlign: "center",
                  fontSize: 13.5,
                  color: "var(--muted)",
                }}
              >
                {total} {total === 1 ? "artículo" : "artículos"} en {cat.label.toLowerCase()}.
              </p>
            )}
          </div>
        </section>
      </main>
      <SalesFooter />
      <JsonLd data={collectionLd} />
      <JsonLd data={breadcrumbLd} />
    </div>
  );
}
