import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Inter } from "next/font/google";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { SalesFooter } from "@/components/public/landing/sales";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { JsonLd } from "@/components/blog/json-ld";
import { BlogMarkdown } from "@/components/blog/markdown";
import { BlogFaq } from "@/components/blog/ui";
import { getRelatedPosts } from "@/lib/blog/queries";
import type { BlogPostCardDTO } from "@/lib/blog/types";
import {
  CasoCta,
  CasoHeroMeta,
  CasoModules,
  CasoNote,
  CasoRelatedBlog,
  CasoRelatedCasos,
  CasoVisual,
} from "@/components/casos/ui";
import {
  CASOS_DE_USO,
  CASOS_PUBLISHED_AT,
  casoReadingMinutes,
  casoSpecialtyLabel,
  getCasoBySlug,
  getRelatedCasos,
} from "@/lib/casos/data";
import "@/components/public/landing/sales/sales.css";
import "../../blog/blog.css";
import "../casos.css";

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
// /casos-de-uso/[slug] — la ficha del escenario.
//
// AQUÍ SÍ hay generateStaticParams (al contrario que /blog/[slug]): el contenido
// vive en el repo, no en la BD, así que las 20 páginas se prerenderizan en build
// sin necesidad de DATABASE_URL. Lo único que toca la BD son las tarjetas de los
// artículos relacionados, en try/catch y con fallback estático.
//
// Un slug que no exista en la data devuelve 404 real.
// ─────────────────────────────────────────────────────────────────────────────
export const revalidate = 3600;

export function generateStaticParams() {
  return CASOS_DE_USO.map((c) => ({ slug: c.slug }));
}

/** URL de la OG dinámica — la misma ruta que usa el blog. */
function ogUrlFor(title: string): string {
  return `${SITE_URL}/og/blog?title=${encodeURIComponent(title.slice(0, 110))}`;
}

export function generateMetadata({ params }: Props): Metadata {
  const caso = getCasoBySlug(params.slug);
  if (!caso) {
    return { title: "Caso de uso no encontrado | DaleControl", robots: { index: false, follow: false } };
  }
  return buildMetadata({
    title: caso.metaTitle,
    description: caso.metaDescription,
    path: `/casos-de-uso/${caso.slug}`,
    ogImage: ogUrlFor(caso.title),
    keywords: [
      `software dental ${caso.city}`,
      `${casoSpecialtyLabel(caso.specialty).toLowerCase()} ${caso.city}`,
      "software para clínicas dentales",
      "casos de uso DaleControl",
    ],
  });
}

export default async function CasoPage({ params }: Props) {
  const caso = getCasoBySlug(params.slug);
  if (!caso) notFound();

  // Tarjetas de blog reales si hay BD; si no, la ficha cae a la lista con los
  // títulos del mapa estático (CasoRelatedBlog decide con `posts.length`).
  let relatedPosts: BlogPostCardDTO[] = [];
  try {
    relatedPosts = await getRelatedPosts(
      { id: caso.slug, slug: caso.slug, cluster: null, relatedSlugs: caso.relatedBlogSlugs },
      3,
    );
  } catch {
    relatedPosts = [];
  }

  const relatedCasos = getRelatedCasos(caso, 3);
  const url = `${SITE_URL}/casos-de-uso/${caso.slug}`;
  const specialtyLabel = casoSpecialtyLabel(caso.specialty);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: caso.title.slice(0, 110),
    description: caso.metaDescription,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    datePublished: CASOS_PUBLISHED_AT,
    dateModified: CASOS_PUBLISHED_AT,
    inLanguage: "es-MX",
    articleSection: specialtyLabel,
    image: [ogUrlFor(caso.title)],
    author: { "@type": "Organization", name: "DaleControl", url: SITE_URL },
    publisher: { "@type": "Organization", name: "DaleControl", url: SITE_URL },
    keywords: [specialtyLabel, caso.city, ...caso.modules].join(", "),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Casos de uso", item: `${SITE_URL}/casos-de-uso` },
      { "@type": "ListItem", position: 3, name: caso.title, item: url },
    ],
  };

  const faqLd =
    caso.faq.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: caso.faq.map((f) => ({
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
                <Link href="/casos-de-uso">Casos de uso</Link>
                <span aria-hidden="true">/</span>
                <span className="blog-breadcrumb__current">{specialtyLabel}</span>
              </nav>

              <div className="caso-hero" style={{ marginTop: 16 }}>
                <CasoVisual specialty={caso.specialty} variant="hero" />
                <div className="caso-hero__body">
                  <h1 className="blog-article__title" style={{ marginTop: 0 }}>
                    {caso.title}
                  </h1>
                  <p className="blog-article__lede">{caso.excerpt}</p>
                  <CasoHeroMeta caso={caso} />
                </div>
              </div>

              {/* La línea que deja claro que es un escenario, no un testimonio. */}
              <CasoNote />

              <div className="blog-article__meta">
                <span>Equipo DaleControl</span>
                <span className="blog-card__dot" aria-hidden="true" />
                <span>{casoReadingMinutes(caso.contentMd)} min de lectura</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mfh-section--tight">
          <div className="mfh-container">
            <div className="blog-article">
              {/* Mismo renderer que el blog: markdown puro, sin HTML crudo. */}
              <BlogMarkdown content={caso.contentMd} />

              <CasoModules modules={caso.modules} />

              {caso.faq.length > 0 && (
                <section style={{ marginTop: 48 }} aria-labelledby="caso-faq-title">
                  <h2 id="caso-faq-title" className="blog-related__title">
                    Preguntas frecuentes
                  </h2>
                  <BlogFaq items={caso.faq} />
                </section>
              )}

              <CasoCta />

              <CasoRelatedBlog posts={relatedPosts} slugs={caso.relatedBlogSlugs} />

              <CasoRelatedCasos casos={relatedCasos} />
            </div>
          </div>
        </section>
      </main>
      <SalesFooter />
      <JsonLd data={articleLd} />
      <JsonLd data={breadcrumbLd} />
      {faqLd ? <JsonLd data={faqLd} /> : null}
    </div>
  );
}
