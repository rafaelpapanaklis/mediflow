import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Newspaper } from "lucide-react";
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
import { countPublishedByCategory, listPublishedPosts } from "@/lib/blog/queries";
import { BLOG_CATEGORIES } from "@/lib/blog/categories";
import { BLOG_PAGE_SIZE } from "@/lib/blog/types";
import "@/components/public/landing/sales/sales.css";
import "./blog.css";

// Misma fuente y shell que /descubre y la home: todo vive bajo `.mfh`.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = buildMetadata({
  title: "Blog para clínicas: gestión, pacientes y tecnología | DaleControl",
  description:
    "Guías prácticas para dueños de clínica en México: agenda, pacientes, WhatsApp, facturación, normativas y tecnología. Sin humo y en español.",
  path: "/blog",
  keywords: [
    "blog para clínicas",
    "gestión de clínicas",
    "software para consultorios",
    "marketing para clínicas",
    "normativas clínicas México",
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// /blog — índice paginado (12 por página), sólo artículos publicados.
//
// Caching: el enfoque de /descubre es `export const revalidate` + revalidatePath
// al mutar. Aquí `revalidate` sólo cubre el data cache: leer `searchParams`
// (?page=) hace que Next 14 renderice esta ruta bajo demanda. Es barato — dos
// queries sobre el índice (status, publishedAt DESC) — y quien SÍ queda cacheada
// como ISR de verdad es la ficha del artículo, que es la que recibe el tráfico
// orgánico. Las mutaciones del admin y el cron llaman revalidateBlog().
// ─────────────────────────────────────────────────────────────────────────────
export const revalidate = 3600;

interface Props {
  searchParams?: { page?: string };
}

export default async function BlogIndexPage({ searchParams }: Props) {
  const pageRaw = Number.parseInt(searchParams?.page ?? "", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const [{ posts, total, totalPages }, counts] = await Promise.all([
    listPublishedPosts({ page }),
    countPublishedByCategory(),
  ]);

  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Blog DaleControl",
    description:
      "Guías prácticas de gestión, marketing, finanzas y tecnología para clínicas en México.",
    url: `${SITE_URL}/blog`,
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
    ],
  };

  return (
    <div className={`mfh ${inter.variable}`} style={{ minHeight: "100dvh" }}>
      <SalesNavSession />
      <main>
        {/* Hero */}
        <section className="mfh-section--tight mfh-band--violet">
          <div className="mfh-container">
            <div className="mfh-head mfh-center" style={{ alignItems: "center", gap: 16 }}>
              <span className="mfh-eyebrow">
                <Newspaper /> Blog DaleControl
              </span>
              <h1 className="mfh-h1 mfh-balance">
                Cómo llevar una clínica <span className="mfh-grad">sin perder el control</span>
              </h1>
              <p className="mfh-lede" style={{ maxWidth: 640 }}>
                Guías prácticas sobre agenda, pacientes, WhatsApp, finanzas, normativas y
                tecnología. Escritas para quien dirige la clínica, no para quien vende
                software.
              </p>
            </div>
          </div>
        </section>

        {/* Categorías + listado */}
        <section className="mfh-section--tight" style={{ paddingTop: 0 }}>
          <div className="mfh-container">
            <div style={{ marginBottom: 28 }}>
              <BlogCategoryChips counts={counts} />
            </div>

            {posts.length === 0 ? (
              <BlogEmptyState
                title={page > 1 ? "No hay más artículos" : "Muy pronto"}
                text={
                  page > 1
                    ? "Llegaste al final del blog. Vuelve al índice para ver los artículos publicados."
                    : "Estamos preparando las primeras guías para dueños de clínica. Vuelve en unos días: publicamos contenido nuevo cada semana."
                }
              />
            ) : (
              <>
                <BlogGrid posts={posts} />
                <div style={{ marginTop: 40 }}>
                  <BlogPager page={page} totalPages={totalPages} basePath="/blog" />
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
                {total} {total === 1 ? "artículo publicado" : "artículos publicados"} en{" "}
                {BLOG_CATEGORIES.length} categorías.
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
