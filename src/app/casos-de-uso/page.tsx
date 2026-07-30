import type { Metadata } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import { Lightbulb } from "lucide-react";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { SalesFooter } from "@/components/public/landing/sales";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { JsonLd } from "@/components/blog/json-ld";
import { CasoNote, CasosGrid } from "@/components/casos/ui";
import { CASOS_DE_USO } from "@/lib/casos/data";
import "@/components/public/landing/sales/sales.css";
import "../blog/blog.css";
import "./casos.css";

// Misma fuente y shell que /blog, /descubre y la home: todo vive bajo `.mfh`.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = buildMetadata({
  title: "Casos de uso: cómo usan DaleControl clínicas como la tuya",
  description:
    "20 escenarios ilustrativos por especialidad y ciudad: ortodoncia, implantes, odontopediatría, multi-sede. Cómo se configura DaleControl para cada problema.",
  path: "/casos-de-uso",
  // Misma OG dinámica que el blog y las fichas de caso — cero imágenes propias.
  ogImage: `${SITE_URL}/og/blog?title=${encodeURIComponent(
    "Casos de uso: cómo usan DaleControl clínicas como la tuya",
  )}`,
  keywords: [
    "casos de uso software dental",
    "software para clínicas dentales México",
    "gestión de clínica dental",
    "ejemplos software dental",
    "DaleControl casos",
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// /casos-de-uso — índice de los 20 escenarios.
//
// El contenido es estático (src/lib/casos/data.ts), así que esta página se
// genera en build sin tocar la BD. `revalidate` la deja como ISR por
// consistencia con /blog: un deploy la regenera igual.
// ─────────────────────────────────────────────────────────────────────────────
export const revalidate = 3600;

export default function CasosIndexPage() {
  const collectionLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Casos de uso de DaleControl",
    description:
      "Escenarios ilustrativos de cómo distintos tipos de clínica dental en México pueden usar DaleControl para resolver un problema operativo concreto.",
    url: `${SITE_URL}/casos-de-uso`,
    inLanguage: "es-MX",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: CASOS_DE_USO.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: c.title,
        url: `${SITE_URL}/casos-de-uso/${c.slug}`,
      })),
    },
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Casos de uso", item: `${SITE_URL}/casos-de-uso` },
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
                <Lightbulb /> Casos de uso
              </span>
              <h1 className="mfh-h1 mfh-balance">
                Cómo se vería DaleControl <span className="mfh-grad">en una clínica como la tuya</span>
              </h1>
              <p className="mfh-lede" style={{ maxWidth: 660 }}>
                {CASOS_DE_USO.length} escenarios por especialidad y ciudad. Cada uno parte de un
                problema operativo real del día a día y muestra cómo se configura DaleControl
                para resolverlo, paso a paso.
              </p>
            </div>
            <div className="blog-article" style={{ marginTop: 4 }}>
              <CasoNote />
            </div>
          </div>
        </section>

        {/* Listado */}
        <section className="mfh-section--tight" style={{ paddingTop: 0 }}>
          <div className="mfh-container">
            <CasosGrid casos={CASOS_DE_USO} />

            <p
              style={{
                marginTop: 30,
                textAlign: "center",
                fontSize: 13.5,
                color: "var(--muted)",
              }}
            >
              ¿Buscas guías más largas de gestión, finanzas y marketing?{" "}
              <Link href="/blog" style={{ color: "var(--b2)", fontWeight: 600 }}>
                Pásate al blog
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
