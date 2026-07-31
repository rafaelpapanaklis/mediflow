import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { SalesFooter } from "@/components/public/landing/sales";
import { JsonLd } from "@/components/blog/json-ld";
import { SITE_URL } from "@/lib/seo";
import type { ProductoModule, ProductoTheme } from "@/lib/producto/types";
import { otherModules } from "@/lib/producto/data";

/**
 * Plantilla ÚNICA de las 8 páginas de producto por módulo. Todo el contenido
 * llega por props desde src/lib/producto/data.ts; lo único que cambia entre
 * rutas es ese objeto y el acento, que baja como custom properties CSS.
 *
 * Server component puro: no toca la BD y el único cliente que monta es el nav
 * (sesión). El FAQ es <details>/<summary> nativo — cero JS.
 *
 * ── POR QUÉ NINGÚN MOCKUP VA DIFERIDO ──────────────────────────────────────
 * Se probó el patrón del commit 42506d2a (next/dynamic ssr:false +
 * IntersectionObserver reservando el hueco) para los mockups bajo el pliegue.
 * NO se puede aplicar aquí: al medir los 32 mockups en Chrome a 320/375/480/
 * 640/768/900/1024/1280/1440 px, NINGUNO conserva el mismo alto en todos los
 * anchos. Dos causas, las dos del diseño aprobado:
 *   · el padding de .pm-win__body es clamp(14px,1.8vw,20px) → depende del
 *     viewport, no del contenedor, así que ninguna container query lo replica;
 *   · la segunda línea de cada fila (.pm-list__main span) reenvuelve entre 320
 *     y 375 px — p. ej. "expediente-3" mide 350.4 px a 320 y 313.8 de 375 en
 *     adelante.
 * Sin poder reservar el alto EXACTO, diferir cambia CLS 0 por un salto real,
 * así que todos los mockups se quedan en SSR (incluido el del hero, que además
 * es el LCP y nunca se difiere). Si algún día se recortan esos textos con
 * ellipsis, vuelve a medir y el diferido se puede reactivar.
 */

function themeVars(t: ProductoTheme): CSSProperties {
  return {
    "--pm-glow-a": t.glowA,
    "--pm-glow-b": t.glowB,
    "--pm-glow-c": t.glowScene,
    "--pm-hero-base": t.heroBase,
    "--pm-pill-bg": t.pillBg,
    "--pm-pill-bd": t.pillBorder,
    "--pm-pill-tx": t.pillText,
    "--pm-accent": t.accent,
    "--pm-crumb": t.crumb,
    "--pm-band": t.band,
    "--pm-steps-bg": t.stepsBg,
    "--pm-steps-bd": t.stepsBorder,
    "--pm-steps-tx": t.stepsText,
    "--pm-dash": t.stepsDash,
    "--pm-cta": t.cta,
    "--pm-cta-ink": t.ctaInk,
    "--pm-cta-note": t.ctaNote,
    "--pm-link": t.link,
    "--pm-link-bd": t.linkBorder,
    "--pm-faq-bg": t.faqBg,
    "--pm-faq-tx": t.faqText,
  } as CSSProperties;
}

export type ProductoPageProps = {
  module: ProductoModule;
  /** Mockup del hero — se renderiza SIEMPRE en el servidor (es el LCP). */
  hero: ReactNode;
  /** Mockups de los bloques alternados, por clave (`Capability.mock`). */
  mocks: Record<string, ReactNode>;
  /** Clase `.variable` de next/font (Inter) — define --font-inter para `.pm`. */
  fontClass: string;
};

export function ProductoPage({ module: m, hero, mocks, fontClass }: ProductoPageProps) {
  const url = `${SITE_URL}/${m.slug}`;
  const others = otherModules(m.slug);

  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: m.metaTitle,
    description: m.metaDescription,
    url,
    inLanguage: "es-MX",
    isPartOf: { "@type": "WebSite", name: "DaleControl", url: SITE_URL },
    about: { "@type": "SoftwareApplication", name: `DaleControl · ${m.name}`, applicationCategory: "BusinessApplication", operatingSystem: "Web" },
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Funciones", item: `${SITE_URL}/#funciones` },
      { "@type": "ListItem", position: 3, name: m.name, item: url },
    ],
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: m.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className={`pm ${fontClass}`} style={themeVars(m.theme)}>
      <SalesNavSession />

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="pm-hero">
          <div className="pm-hero__dots" aria-hidden="true" />
          <div className="pm-wrap pm-hero__inner">
            <div className="pm-hero__col">
              <nav className="pm-crumbs" aria-label="Ruta">
                <Link href="/#funciones">Funciones</Link>
                <span aria-hidden="true">/</span>
                <span className="pm-crumbs__here">{m.name}</span>
              </nav>
              <span className="pm-badge">
                <span className="pm-badge__dot" aria-hidden="true" />
                {m.badge}
              </span>
              <h1 className="pm-h1">
                {m.h1a}
                <em>{m.h1accent}</em>
                {m.h1b ?? ""}
              </h1>
              <p className="pm-lede">{m.lede}</p>
              <div className="pm-cta-row">
                <Link href="/signup" className="pm-btn pm-btn--primary">Crear cuenta</Link>
                <Link href="/#precios" className="pm-btn pm-btn--ghost">Ver precios</Link>
              </div>
              <ul className="pm-hero__checks">
                {m.heroChecks.map((c) => (
                  <li key={c}><b aria-hidden="true">✓</b>{c}</li>
                ))}
              </ul>
            </div>
            <div className="pm-hero__art">{hero}</div>
          </div>
        </section>

        {/* ── Franja de beneficios ─────────────────────────────────────── */}
        <section className="pm-band" aria-label="Beneficios">
          <div className="pm-wrap pm-band__grid">
            {m.benefits.map((b) => (
              <div key={b.title}>
                <span className="pm-band__ico" aria-hidden="true">{b.glyph}</span>
                <h2>{b.title}</h2>
                <p>{b.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── El día a día ─────────────────────────────────────────────── */}
        <section className="pm-section">
          <div className="pm-wrap">
            <span className="pm-eyebrow pm-t-red">El día a día</span>
            <h2 className="pm-h2">{m.problem.title}</h2>
            <p className="pm-sub">{m.problem.sub}</p>
            <div className="pm-cards">
              {m.problem.cards.map((c) => (
                <article key={c.title} className={`pm-card pm-t-${c.tone}`}>
                  <span className="pm-card__ico" aria-hidden="true">{c.glyph}</span>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Capacidades (bloques alternados) ─────────────────────────── */}
        <section className="pm-section--alt" aria-label="Capacidades del módulo">
          <div className="pm-wrap pm-alts">
            {m.capabilities.map((c) => (
              <div key={c.mock} className={`pm-alt pm-t-${c.tone}${c.reverse ? " pm-alt--rev" : ""}`}>
                <div className="pm-alt__col">
                  <span className="pm-eyebrow">{c.eyebrow}</span>
                  <h2>{c.title}</h2>
                  <p>{c.body}</p>
                  <ul className="pm-ticks">
                    {c.bullets.map((b) => (
                      <li key={b}><b aria-hidden="true">✓</b>{b}</li>
                    ))}
                  </ul>
                </div>
                <div className="pm-alt__fig">{mocks[c.mock]}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Paso a paso ──────────────────────────────────────────────── */}
        <section className="pm-section pm-section--dark">
          <div className="pm-wrap">
            <span className="pm-eyebrow--dark">Paso a paso</span>
            <h2 className="pm-h2">Cómo se ve en la práctica</h2>
            <p className="pm-sub">{m.steps.sub}</p>
            <ol className="pm-steps">
              {m.steps.items.map((s, i) => (
                <li key={s.title}>
                  <div className="pm-steps__top">
                    <span className="pm-steps__n" style={{ background: m.theme.stepNums[i] }} aria-hidden="true">{i + 1}</span>
                    {i < 3 ? <span className="pm-steps__line" aria-hidden="true" /> : null}
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Del blog (slugs REALES, verificados contra el sitemap) ────── */}
        <section id="blog" className="pm-section pm-section--soft">
          <div className="pm-wrap">
            <div className="pm-blog__head">
              <div className={`pm-t-${m.theme.blogTone}`}>
                <span className="pm-eyebrow">Del blog</span>
                <h2>{m.blog.title}</h2>
              </div>
              <Link href="/blog" className="pm-blog__all">Ver todo el blog →</Link>
            </div>
            <div className="pm-blog__grid">
              {m.blog.posts.map((p) => (
                <article key={p.slug} className={`pm-post pm-t-${p.tone}`}>
                  <div className="pm-post__cover" aria-hidden="true">
                    <span>artículo del blog</span>
                  </div>
                  <div className="pm-post__body">
                    <span className="pm-post__kicker">{p.kicker}</span>
                    <h3><Link href={`/blog/${p.slug}`}>{p.title}</Link></h3>
                    <p>{p.excerpt}</p>
                    <span className="pm-post__more" aria-hidden="true">Leer el artículo →</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ — <details> nativo: accesible y sin una línea de JS ──── */}
        <section id="faq" className="pm-section">
          <div className="pm-wrap pm-wrap--narrow">
            <span className={`pm-eyebrow pm-t-${m.theme.faqTone}`}>Preguntas frecuentes</span>
            <h2 className="pm-h2">Lo que suelen preguntar antes de empezar</h2>
            <div className="pm-faq">
              {m.faq.map((f) => (
                <details key={f.q}>
                  <summary>
                    <span>{f.q}</span>
                    <span className="pm-faq__sign" aria-hidden="true">+</span>
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA final ────────────────────────────────────────────────── */}
        <section id="cta" className="pm-cta">
          <div className="pm-cta__o1" aria-hidden="true" />
          <div className="pm-cta__o2" aria-hidden="true" />
          <div className="pm-wrap pm-wrap--cta pm-cta__inner">
            <h2>{m.cta.title}</h2>
            <p className="pm-cta__lede">{m.cta.body}</p>
            <div className="pm-cta__row">
              <Link href="/signup" className="pm-btn pm-btn--light">Crear cuenta</Link>
              <Link href="/#precios" className="pm-btn pm-btn--outline">Consulta los planes</Link>
            </div>
            <p className="pm-cta__note">Sin instalar nada · Sin permanencia</p>
          </div>
        </section>

        {/* ── Otros módulos ────────────────────────────────────────────── */}
        <section className="pm-more">
          <div className="pm-wrap pm-more__inner">
            <h2>Otros módulos de DaleControl</h2>
            <ul>
              {others.map((o) => (
                <li key={o.slug}>
                  <Link href={`/${o.slug}`}>
                    <span>
                      <b>{o.name}</b>
                      <span className="pm-more__d">{o.tagline}</span>
                    </span>
                    <span className="pm-more__arrow" aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <SalesFooter />
      <JsonLd data={webPageLd} />
      <JsonLd data={breadcrumbLd} />
      <JsonLd data={faqLd} />
    </div>
  );
}
