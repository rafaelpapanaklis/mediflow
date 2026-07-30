import type { ReactNode } from "react";
import Link from "next/link";
import { Inter } from "next/font/google";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { SalesFooter } from "@/components/public/landing/sales";
import { JsonLd } from "@/components/blog/json-ld";
import { BlogFaq } from "@/components/blog/ui";
import type { BlogFaqItem } from "@/lib/blog/types";
import { getOtherHerramientas, type Herramienta } from "@/lib/herramientas/data";
import { toolBreadcrumbLd, toolFaqLd, toolWebAppLd } from "@/lib/herramientas/json-ld";
import {
  ToolCta,
  ToolPrivacyNote,
  ToolRelatedBlog,
  ToolRelatedTools,
} from "./ui";
import "@/components/public/landing/sales/sales.css";
import "@/app/blog/blog.css";
import "@/app/herramientas/herramientas.css";

// ─────────────────────────────────────────────────────────────────────────────
// Shell común de las 5 fichas de /herramientas/<slug>.
//
// Cada página aporta lo suyo —intro, la herramienta, FAQ y el copy del CTA— y
// este componente pone todo lo repetido en un solo lugar: fuente, nav, hero con
// migas, la nota de privacidad, el FAQ, el CTA, los enlaces internos, el footer
// y los tres bloques de JSON-LD (WebApplication + FAQPage + BreadcrumbList).
//
// Server component: no hay estado ni handlers. Lo único cliente de la sección es
// el tool.tsx de cada carpeta.
// ─────────────────────────────────────────────────────────────────────────────

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export function ToolPageShell({
  tool,
  lede,
  faq,
  featureList,
  ctaTitle,
  ctaText,
  children,
}: {
  tool: Herramienta;
  /** Bajada del hero: qué hace la herramienta, en una o dos frases. */
  lede: string;
  faq: BlogFaqItem[];
  /** Para el featureList del JSON-LD de WebApplication. */
  featureList: string[];
  ctaTitle: string;
  ctaText: string;
  /** Intro + la herramienta (y lo que la ficha necesite después). */
  children: ReactNode;
}) {
  const faqLd = toolFaqLd(faq);

  return (
    <div className={`mfh ${inter.variable}`} style={{ minHeight: "100dvh" }}>
      <SalesNavSession />
      <main>
        <section className="mfh-section--tight mfh-band--violet" style={{ paddingBottom: 0 }}>
          <div className="mfh-container">
            <div className="blog-article">
              <nav className="blog-breadcrumb" aria-label="Migas de pan">
                <Link href="/herramientas">Herramientas gratuitas</Link>
                <span aria-hidden="true">/</span>
                <span className="blog-breadcrumb__current">{tool.name}</span>
              </nav>

              <h1 className="blog-article__title">{tool.headline}</h1>
              <p className="blog-article__lede">{lede}</p>

              <ToolPrivacyNote />
            </div>
          </div>
        </section>

        <section className="mfh-section--tight">
          <div className="mfh-container">
            <div className="blog-article">
              {children}

              {faq.length > 0 && (
                <section style={{ marginTop: 48 }} aria-labelledby="tool-faq-title">
                  <h2 id="tool-faq-title" className="blog-related__title">
                    Preguntas frecuentes
                  </h2>
                  <BlogFaq items={faq} />
                </section>
              )}

              <ToolCta title={ctaTitle} text={ctaText} />

              <ToolRelatedBlog slugs={tool.relatedBlogSlugs} />

              <ToolRelatedTools tools={getOtherHerramientas(tool.slug)} />
            </div>
          </div>
        </section>
      </main>
      <SalesFooter />
      <JsonLd data={toolWebAppLd(tool, featureList)} />
      <JsonLd data={toolBreadcrumbLd(tool)} />
      {faqLd ? <JsonLd data={faqLd} /> : null}
    </div>
  );
}
