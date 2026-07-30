import type { Metadata } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import { Wrench } from "lucide-react";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { SalesFooter } from "@/components/public/landing/sales";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { JsonLd } from "@/components/blog/json-ld";
import { ToolPrivacyNote, ToolsGrid } from "@/components/herramientas/ui";
import { HERRAMIENTAS } from "@/lib/herramientas/data";
import "@/components/public/landing/sales/sales.css";
import "../blog/blog.css";
import "./herramientas.css";

// Misma fuente y shell que /blog, /casos-de-uso y la home: todo vive bajo `.mfh`.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const TITLE = "Herramientas gratuitas para consultorios dentales";

export const metadata: Metadata = buildMetadata({
  title: TITLE,
  description:
    "Calculadoras y generadores gratis para tu consultorio dental: citas perdidas, punto de equilibrio, precios, aviso de privacidad y consentimiento informado.",
  path: "/herramientas",
  // Misma OG dinámica que el blog y los casos de uso — cero imágenes propias.
  ogImage: `${SITE_URL}/og/blog?title=${encodeURIComponent(TITLE)}`,
  keywords: [
    "herramientas gratuitas para dentistas",
    "calculadoras para consultorio dental",
    "generador de aviso de privacidad dental",
    "consentimiento informado odontología",
    "software para clínicas dentales México",
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// /herramientas — índice de las herramientas gratuitas.
//
// Todo el contenido es estático (src/lib/herramientas/data.ts): la página se
// genera en build sin tocar la BD. `revalidate` la deja como ISR por
// consistencia con /blog y /casos-de-uso: un deploy la regenera igual.
// ─────────────────────────────────────────────────────────────────────────────
export const revalidate = 3600;

export default function HerramientasIndexPage() {
  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: TITLE,
    description:
      "Calculadoras y generadores gratuitos para clínicas y consultorios dentales en México. Corren en el navegador: no piden registro y no envían datos a ningún servidor.",
    url: `${SITE_URL}/herramientas`,
    inLanguage: "es-MX",
    isAccessibleForFree: true,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: HERRAMIENTAS.map((h, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: h.name,
        url: `${SITE_URL}/herramientas/${h.slug}`,
      })),
    },
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Herramientas gratuitas",
        item: `${SITE_URL}/herramientas`,
      },
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
                <Wrench /> Herramientas gratuitas
              </span>
              <h1 className="mfh-h1 mfh-balance">
                Calculadoras y generadores <span className="mfh-grad">para tu consultorio</span>
              </h1>
              <p className="mfh-lede" style={{ maxWidth: 660 }}>
                {HERRAMIENTAS.length} herramientas gratis, sin registro y sin instalar nada.
                Pon los números de tu clínica y obtén el resultado al instante, o genera los
                formatos que te piden en papel.
              </p>
            </div>
            <div className="blog-article" style={{ marginTop: 4 }}>
              <ToolPrivacyNote />
            </div>
          </div>
        </section>

        {/* Listado */}
        <section className="mfh-section--tight" style={{ paddingTop: 0 }}>
          <div className="mfh-container">
            <ToolsGrid tools={HERRAMIENTAS} />

            <p
              style={{
                marginTop: 30,
                textAlign: "center",
                fontSize: 13.5,
                color: "var(--muted)",
              }}
            >
              ¿Quieres el método completo detrás de cada número?{" "}
              <Link href="/blog" style={{ color: "var(--b2)", fontWeight: 600 }}>
                Pásate al blog
              </Link>{" "}
              o mira los{" "}
              <Link href="/casos-de-uso" style={{ color: "var(--b2)", fontWeight: 600 }}>
                casos de uso
              </Link>
              .
            </p>
          </div>
        </section>
      </main>
      <SalesFooter />
      <JsonLd data={collectionLd} />
      <JsonLd data={breadcrumbLd} />
    </div>
  );
}
