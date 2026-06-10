import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Inter } from "next/font/google";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { SalesFooter } from "@/components/public/landing/sales";
import { DirectoryExplorer } from "@/components/directory/DirectoryExplorer";
import { CategoryGrid, CATEGORY_ICONS } from "@/components/directory/CategoryGrid";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { DIRECTORY_CATEGORIES, getCategoryBySlug } from "@/lib/directory/types";
import "@/components/public/landing/sales/sales.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

interface Props {
  params: { categoria: string };
}

// Solo las 17 categorías del contrato — cualquier otro slug es 404 (SSG).
export function generateStaticParams() {
  return DIRECTORY_CATEGORIES.map((c) => ({ categoria: c.slug }));
}
export const dynamicParams = false;

export function generateMetadata({ params }: Props): Metadata {
  const cat = getCategoryBySlug(params.categoria);
  if (!cat) return {};
  return buildMetadata({
    title: `${cat.label}: encuentra ${cat.plural} y agenda en línea | DaleControl`,
    description: `${cat.description} Reserva tu cita en línea, sin llamadas y con confirmación por WhatsApp.`,
    path: `/descubre/${cat.slug}`,
    keywords: [cat.plural, `${cat.label.toLowerCase()} cerca de mí`, "reservar cita en línea", "directorio de clínicas"],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// /descubre/[categoria] — listado del directorio filtrado por categoría:
// hero compacto (breadcrumb + badge con icono + h1 con el plural + lede),
// Explorer con pills para saltar de categoría sin volver al inicio y banda
// CTA final hacia /signup. Copy neutro con tú; 100% responsive.
// ─────────────────────────────────────────────────────────────────────────────

/** Primera letra en mayúscula: "clínicas dentales" → "Clínicas dentales". */
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function CategoriaPage({ params }: Props) {
  const cat = getCategoryBySlug(params.categoria);
  if (!cat) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Directorio", item: `${SITE_URL}/descubre` },
      { "@type": "ListItem", position: 2, name: cat.label, item: `${SITE_URL}/descubre/${cat.slug}` },
    ],
  };

  const Icon = CATEGORY_ICONS[cat.slug];

  return (
    <div className={`mfh ${inter.variable}`} style={{ minHeight: "100dvh" }}>
      <SalesNavSession />
      <main>
        {/* Hero compacto de la categoría */}
        <section className="mfh-band--violet mfh-section--tight">
          <div className="mfh-container">
            <div className="flex max-w-3xl flex-col items-start gap-5">
              <nav
                aria-label="Migas de pan"
                className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-[color:var(--muted)]"
              >
                <Link
                  href="/descubre"
                  className="text-[color:var(--muted)] no-underline transition-colors hover:text-[color:var(--b2)]"
                >
                  Directorio
                </Link>
                <span aria-hidden="true">/</span>
                <span className="text-[color:var(--ink)]">{cat.label}</span>
              </nav>
              {Icon ? (
                <span
                  aria-hidden="true"
                  className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[color:var(--v200)] bg-[color:var(--v50)] text-[color:var(--b2)]"
                >
                  <Icon size={26} strokeWidth={1.9} />
                </span>
              ) : null}
              <h1 className="mfh-h1 mfh-balance">{capitalize(cat.plural)}</h1>
              <p className="mfh-lede max-w-2xl">{cat.description}</p>
            </div>
          </div>
        </section>

        {/* Buscador + pills de categorías + resultados (client) */}
        <DirectoryExplorer initialCategory={cat.slug}>
          <section
            aria-label="Explora otras categorías"
            className="mfh-container"
            style={{ paddingTop: 8, paddingBottom: 8 }}
          >
            <CategoryGrid variant="pills" activeSlug={cat.slug} />
          </section>
        </DirectoryExplorer>

        {/* CTA para dueños de clínicas */}
        <section className="mfh-band--soft mfh-section--tight">
          <div className="mfh-container">
            <div className="mfh-head mfh-center">
              <h2 className="mfh-h2 mfh-balance">¿Tienes una clínica?</h2>
              <p className="mfh-lede">
                Cada vez más personas buscan {cat.plural} con reserva en línea. Únete al
                directorio de DaleControl y recibe citas confirmadas por WhatsApp.
              </p>
              <div className="flex justify-center">
                <Link href="/signup" className="mfh-btn mfh-btn--primary">
                  Publica tu clínica gratis
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SalesFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}
