import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Inter } from "next/font/google";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { SalesFooter } from "@/components/public/landing/sales";
import { CategoryGrid, CATEGORY_ICONS } from "@/components/directory/CategoryGrid";
import { CityClinicsList } from "@/components/directory/CityClinicsList";
import { CityCrossLinks } from "@/components/directory/CityLinks";
import { BookingPopupController } from "@/components/directory/BookingPopupController";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { getCategoryBySlug } from "@/lib/directory/types";
import { getCityPageData, getCategoryCityCombos } from "@/lib/directory/query";
import "@/components/public/landing/sales/sales.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

// SEO programático: páginas estáticas por combinación real (categoría × ciudad)
// con ISR diario. Las combinaciones SIN clínicas hacen notFound() (404) — cero
// thin content. dynamicParams=true para generar bajo demanda ciudades nuevas
// (e.g. el build local sin DB devuelve []; en Vercel se prebuilbean las reales).
export const revalidate = 86400;
export const dynamicParams = true;

interface Props {
  params: { categoria: string; ciudad: string };
}

// Una sola carga compartida por generateMetadata y la página (React cache por
// request) → evita duplicar las queries. Devuelve null si la combinación no
// existe o no tiene clínicas.
const load = cache(async (categoria: string, ciudad: string) => {
  const cat = getCategoryBySlug(categoria);
  if (!cat) return null;
  const data = await getCityPageData(cat.category, cat.slug, ciudad, 1);
  if (!data) return null;
  return { cat, data };
});

export async function generateStaticParams() {
  try {
    const combos = await getCategoryCityCombos();
    return combos.map((c) => ({ categoria: c.categoria, ciudad: c.ciudad }));
  } catch {
    return [];
  }
}

/** "clínicas dentales" → "Clínicas dentales". */
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await load(params.categoria, params.ciudad);
  if (!loaded) return { robots: { index: false, follow: false } };

  const { cat, data } = loaded;
  const pluralCap = capitalize(cat.plural);
  const opciones = data.total === 1 ? "1 opción" : `${data.total} opciones`;

  return buildMetadata({
    title: `${pluralCap} en ${data.cityLabel}: agenda en línea | DaleControl`,
    description: `Encuentra ${cat.plural} en ${data.cityLabel} con agenda en línea. Compara ${opciones}, revisa servicios y horarios y reserva tu cita sin llamadas, con confirmación por WhatsApp.`,
    path: `/descubre/${cat.slug}/${params.ciudad}`,
    keywords: [
      `${cat.plural} en ${data.cityLabel}`,
      `${cat.label.toLowerCase()} en ${data.cityLabel}`,
      `${cat.label.toLowerCase()} cerca de mí`,
      "reservar cita en línea",
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// /descubre/[categoria]/[ciudad] — landing programática categoría + ciudad.
// H1 y copy únicos, listado SERVER-RENDERED (página 1 en el HTML) con "cargar
// más", breadcrumbs visibles + BreadcrumbList, ItemList de las clínicas y
// bloques de interlinking. Estilo BLANCO + VIOLETA (.mfh). Español neutro con tú.
// ─────────────────────────────────────────────────────────────────────────────

export default async function CiudadPage({ params }: Props) {
  const loaded = await load(params.categoria, params.ciudad);
  if (!loaded) notFound();

  const { cat, data } = loaded;
  const { cityLabel } = data;
  const Icon = CATEGORY_ICONS[cat.slug];
  const pluralCap = capitalize(cat.plural);
  const countLabel = data.total === 1 ? "1 clínica" : `${data.total} clínicas`;

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Directorio", item: `${SITE_URL}/descubre` },
      { "@type": "ListItem", position: 2, name: cat.label, item: `${SITE_URL}/descubre/${cat.slug}` },
      { "@type": "ListItem", position: 3, name: cityLabel, item: `${SITE_URL}/descubre/${cat.slug}/${params.ciudad}` },
    ],
  };

  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${pluralCap} en ${cityLabel}`,
    numberOfItems: data.total,
    itemListElement: data.items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.landingActive ? { url: `${SITE_URL}/${c.slug}` } : {}),
    })),
  };

  return (
    <div className={`mfh ${inter.variable}`} style={{ minHeight: "100dvh" }}>
      <SalesNavSession />
      <main>
        {/* Hero categoría + ciudad */}
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
                <Link
                  href={`/descubre/${cat.slug}`}
                  className="text-[color:var(--muted)] no-underline transition-colors hover:text-[color:var(--b2)]"
                >
                  {cat.label}
                </Link>
                <span aria-hidden="true">/</span>
                <span className="text-[color:var(--ink)]">{cityLabel}</span>
              </nav>
              {Icon ? (
                <span
                  aria-hidden="true"
                  className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[color:var(--v200)] bg-[color:var(--v50)] text-[color:var(--b2)]"
                >
                  <Icon size={26} strokeWidth={1.9} />
                </span>
              ) : null}
              <h1 className="mfh-h1 mfh-balance">
                {pluralCap} en {cityLabel}
              </h1>
              <p className="mfh-lede max-w-2xl">
                Compara {cat.plural} en {cityLabel}, revisa sus servicios y horarios, y reserva tu
                cita en línea en minutos.{" "}
                {data.total === 1
                  ? "Hay 1 clínica con agenda disponible"
                  : `Hay ${data.total} clínicas con agenda disponible`}
                , sin llamadas y con confirmación por WhatsApp.
              </p>
              <div
                style={{ display: "flex", flexWrap: "wrap", gap: "10px 22px", paddingTop: 2 }}
              >
                <span className="mfh-pill"><span className="mfh-dot" /> Reserva sin llamadas</span>
                <span className="mfh-pill"><span className="mfh-dot" /> Confirmación por WhatsApp</span>
                <span className="mfh-pill"><span className="mfh-dot" /> Sin costo para ti</span>
              </div>
            </div>
          </div>
        </section>

        {/* Pills para saltar de especialidad sin perder el directorio */}
        <section
          aria-label="Explora otras categorías"
          className="mfh-container"
          style={{ paddingTop: 16, paddingBottom: 4 }}
        >
          <CategoryGrid variant="pills" activeSlug={cat.slug} />
        </section>

        {/* Resultados: página 1 server-rendered + cargar más */}
        <section className="mfh-section--tight" aria-label={`${pluralCap} en ${cityLabel}`}>
          <div className="mfh-container">
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                flexWrap: "wrap",
                gap: "6px 12px",
                marginBottom: 22,
              }}
            >
              <h2 className="mfh-h2" style={{ fontSize: "clamp(22px, 2.6vw, 30px)" }}>
                {pluralCap} disponibles
              </h2>
              <span style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)" }}>{countLabel}</span>
            </div>
            <CityClinicsList
              initialItems={data.items}
              total={data.total}
              categorySlug={cat.slug}
              citySlug={params.ciudad}
            />
          </div>
        </section>

        {/* Interlinking: otras ciudades de la categoría + otras especialidades en la ciudad */}
        <CityCrossLinks
          categorySlug={cat.slug}
          citySlug={params.ciudad}
          cityLabel={cityLabel}
          categoryLabel={cat.label}
        />

        {/* CTA dueños de clínica, contextualizado a la ciudad */}
        <section className="mfh-band--soft mfh-section--tight">
          <div className="mfh-container">
            <div className="mfh-head mfh-center" style={{ alignItems: "center", gap: 14 }}>
              <h2 className="mfh-h2 mfh-balance">¿Tienes una clínica en {cityLabel}?</h2>
              <p className="mfh-lede" style={{ maxWidth: 560 }}>
                Publícala gratis en el directorio de DaleControl y recibe reservas de pacientes que
                buscan {cat.plural} en {cityLabel}, con confirmación automática por WhatsApp.
              </p>
              <div style={{ paddingTop: 4 }}>
                <Link href="/signup" className="mfh-btn mfh-btn--primary">
                  Publica tu clínica gratis
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SalesFooter />
      <BookingPopupController />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
      />
    </div>
  );
}
